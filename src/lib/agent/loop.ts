import { askClaude } from "../claude";
import {
  createAgentRun,
  getAgentRun,
  updateAgentRun,
  createAgentStep,
  getStepsForRun,
  getMaxStepIndex,
  createToolCall,
  updateToolCall,
  createApprovalGate,
} from "../db-agent";
import { buildOperationalMemory, serializeMemoryForPrompt, buildLearningContext } from "./memory";
import { createAgentPlan } from "./planner";
import { executeTool, getTool, getToolsForPrompt, ensureToolsRegistered } from "./tools";
import { emitSignal } from "./signals";
import { resolveGate } from "./gates";
import type {
  AgentRun,
  AgentDecision,
  AgentPlan,
  OperationalMemory,
  ToolContext,
  LearnedPreference,
} from "./types";
import { getAllLearnedPreferences } from "../db-agent";

// ─── Start a new agent run ───

export async function executeAgentRun(params: {
  goal: string;
  targetId?: string;
  trigger?: string;
  parentRunId?: string;
}): Promise<{ runId: string; status: string; gateId?: string }> {
  ensureToolsRegistered();
  const run = await createAgentRun(params);

  await updateAgentRun(run.id, {
    status: "planning",
    started_at: new Date().toISOString(),
  });

  // Build memory and plan
  const memory = await buildOperationalMemory(params.targetId);
  const plan = await createAgentPlan(params.goal, memory);

  await updateAgentRun(run.id, {
    status: "executing",
    plan_json: JSON.stringify(plan),
    context_json: JSON.stringify({ targetId: params.targetId }),
  });

  // Save plan step
  await createAgentStep({
    runId: run.id,
    stepIndex: 0,
    type: "plan",
    outputJson: JSON.stringify(plan),
    reasoning: plan.reasoning,
  });

  // Execute first step
  return executeNextStep(run.id);
}

// ─── Execute the next step in a run ───

export async function executeNextStep(runId: string): Promise<{ runId: string; status: string; gateId?: string }> {
  ensureToolsRegistered();
  const run = await getAgentRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  if (run.status !== "executing") {
    return { runId, status: run.status };
  }

  const plan: AgentPlan = run.plan_json ? JSON.parse(run.plan_json) : null;
  if (!plan) {
    await updateAgentRun(runId, { status: "failed", error: "No plan found" });
    return { runId, status: "failed" };
  }

  const currentStepIndex = (await getMaxStepIndex(runId)) + 1;

  if (currentStepIndex > plan.maxSteps) {
    return completeRun(run);
  }

  // Build context
  const context = run.context_json ? JSON.parse(run.context_json) : {};
  const memory = await buildOperationalMemory(context.targetId || run.target_id || undefined);
  const preferences = await getAllLearnedPreferences();
  const steps = await getStepsForRun(runId);

  // THINK: decide what to do next
  const decision = await think(run, plan, memory, preferences, steps);

  // Save think step
  await createAgentStep({
    runId,
    stepIndex: currentStepIndex,
    type: "think",
    outputJson: JSON.stringify(decision),
    reasoning: decision.reasoning,
  });

  // Check if done
  if (decision.action === "complete") {
    return completeRun(run, decision.outcome);
  }

  if (!decision.toolName) {
    await updateAgentRun(runId, { status: "failed", error: "No tool specified in decision" });
    return { runId, status: "failed" };
  }

  // GATE CHECK: does this tool need approval?
  const tool = getTool(decision.toolName);
  if (tool?.gate === "approval_required") {
    const gateStep = await createAgentStep({
      runId,
      stepIndex: currentStepIndex + 1,
      type: "gate_check",
      inputJson: JSON.stringify({ toolName: decision.toolName, input: decision.input }),
      reasoning: `Tool ${decision.toolName} requires human approval`,
    });

    const gate = await createApprovalGate({
      runId,
      stepId: gateStep.id,
      gateType: decision.toolName === "send_gmail_draft" ? "send_email" : "send_email",
      payloadJson: JSON.stringify({
        toolName: decision.toolName,
        input: decision.input,
        reasoning: decision.reasoning,
        targetName: memory.target?.name,
      }),
    });

    await updateAgentRun(runId, { status: "awaiting_approval" });
    return { runId, status: "awaiting_approval", gateId: gate.id };
  }

  // ACT: execute the tool
  const toolCallRecord = await createToolCall({
    runId,
    toolName: decision.toolName,
    inputJson: JSON.stringify(decision.input || {}),
  });

  const toolContext: ToolContext = {
    runId,
    stepId: toolCallRecord.id,
    targetId: context.targetId || run.target_id || undefined,
    operationalMemory: memory,
    learnedPreferences: preferences,
  };

  const start = Date.now();
  const result = await executeTool(decision.toolName, decision.input || {}, toolContext);
  const durationMs = Date.now() - start;

  await updateToolCall(toolCallRecord.id, {
    outputJson: JSON.stringify(result.data || result.error),
    status: result.success ? "success" : "error",
    error: result.error,
    durationMs,
  });

  // OBSERVE: save observation
  await createAgentStep({
    runId,
    stepIndex: currentStepIndex + 2,
    type: "observe",
    inputJson: JSON.stringify({ toolName: decision.toolName }),
    outputJson: JSON.stringify(result),
    tokensUsed: result.metadata?.tokensUsed || 0,
  });

  // Update token count
  await updateAgentRun(runId, {
    tokens_used: run.tokens_used + (result.metadata?.tokensUsed || 0),
  });

  // Return status for continuation
  return { runId, status: "executing" };
}

// ─── Resume after approval gate ───

export async function resumeAfterApproval(gateId: string, action: "approved" | "rejected" | "edited", edits?: Record<string, unknown>): Promise<{ runId: string; status: string }> {
  const resolved = await resolveGate(gateId, action, edits);
  const run = await getAgentRun(resolved.runId);
  if (!run) throw new Error(`Run ${resolved.runId} not found`);

  if (action === "rejected") {
    await emitSignal({
      signalType: "draft_rejected",
      targetId: run.target_id || undefined,
      runId: run.id,
      value: resolved.payload,
    });
    await updateAgentRun(run.id, { status: "cancelled" });
    return { runId: run.id, status: "cancelled" };
  }

  // Emit learning signal
  if (action === "edited") {
    await emitSignal({
      signalType: "draft_edited_heavily",
      targetId: run.target_id || undefined,
      runId: run.id,
      value: JSON.stringify({ original: resolved.payload, edited: edits }),
    });
  } else {
    await emitSignal({
      signalType: "draft_accepted_clean",
      targetId: run.target_id || undefined,
      runId: run.id,
      value: resolved.payload,
    });
  }

  // Execute the gated tool with (possibly edited) input
  const payload = JSON.parse(resolved.payload);
  const toolInput = edits || payload.input;

  await updateAgentRun(run.id, { status: "executing" });

  // Execute the gated tool
  const memory = await buildOperationalMemory(run.target_id || undefined);
  const preferences = await getAllLearnedPreferences();

  const toolCallRecord = await createToolCall({
    runId: run.id,
    toolName: payload.toolName,
    inputJson: JSON.stringify(toolInput),
  });

  const toolContext: ToolContext = {
    runId: run.id,
    stepId: toolCallRecord.id,
    targetId: run.target_id || undefined,
    operationalMemory: memory,
    learnedPreferences: preferences,
  };

  const result = await executeTool(payload.toolName, toolInput, toolContext);

  await updateToolCall(toolCallRecord.id, {
    outputJson: JSON.stringify(result.data || result.error),
    status: result.success ? "success" : "error",
    error: result.error,
    durationMs: result.metadata?.durationMs,
  });

  // Continue the run
  return executeNextStep(run.id);
}

// ─── Think step: decide next action ───

async function think(
  run: AgentRun,
  plan: AgentPlan,
  memory: OperationalMemory,
  preferences: LearnedPreference[],
  previousSteps: Array<{ type: string; output_json: string | null; reasoning: string | null }>
): Promise<AgentDecision> {
  const tools = getToolsForPrompt();
  const memoryStr = serializeMemoryForPrompt(memory);
  const learningStr = await buildLearningContext();

  // Summarize observations so far
  const observations = previousSteps
    .filter((s) => s.type === "observe" || s.type === "think")
    .map((s) => {
      const output = s.output_json ? JSON.parse(s.output_json) : {};
      return `[${s.type}] ${s.reasoning || ""} ${output.success !== undefined ? (output.success ? "SUCCESS" : "FAILED: " + output.error) : ""}`;
    })
    .join("\n");

  const prompt = `You are an autonomous networking agent executing a plan.

GOAL: ${run.goal}

PLAN:
${plan.steps.map((s, i) => `${i + 1}. ${s.description} (${s.toolName})`).join("\n")}

CURRENT STATE:
${memoryStr}
${learningStr}

OBSERVATIONS SO FAR:
${observations || "(none yet)"}

Steps completed: ${previousSteps.length}
Max steps: ${plan.maxSteps}

AVAILABLE TOOLS:
${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

Decide what to do next. If the goal is achieved or no more useful steps exist, set action to "complete".

Respond with JSON only:
{
  "action": "tool_call" or "complete",
  "toolName": "tool_name" (if tool_call),
  "input": {...} (if tool_call),
  "reasoning": "Why this is the right next step",
  "outcome": "Summary of what was accomplished" (if complete)
}`;

  const result = await askClaude(prompt, {
    system: "You are an agent decision-maker. Decide the next action. Respond with valid JSON only.",
    maxTokens: 800,
    temperature: 0,
  });

  try {
    return JSON.parse(result);
  } catch {
    return { action: "complete", reasoning: "Failed to parse decision", outcome: "Agent stopped due to decision parse error" };
  }
}

// ─── Complete a run ───

async function completeRun(run: AgentRun, outcome?: string): Promise<{ runId: string; status: string }> {
  await updateAgentRun(run.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    result_json: JSON.stringify({ outcome: outcome || "Run completed" }),
  });
  return { runId: run.id, status: "completed" };
}

// ─── Self-continuation for Vercel ───

export async function triggerContinuation(runId: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const secret = process.env.AGENT_INTERNAL_SECRET;

  try {
    await fetch(`${appUrl}/api/agent/continue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ runId }),
    });
  } catch (err) {
    console.error("Failed to trigger continuation:", err);
  }
}
