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
  getAllLearnedPreferences,
} from "../db-agent";
import { buildOperationalMemory, serializeMemoryForPrompt, buildLearningContext, serializeScratchpad, createEmptyScratchpad } from "./memory";
import { createAgentPlan } from "./planner";
import { executeTool, getTool, getToolsForPrompt, ensureToolsRegistered } from "./tools";
import { emitSignal } from "./signals";
import { parseClaudeJson } from "./utils";
import { resolveGate } from "./gates";
import { selfCritique, evaluateRun, midRunCheckIn } from "./evaluator";
import type {
  AgentRun,
  AgentDecision,
  AgentPlan,
  OperationalMemory,
  ToolContext,
  LearnedPreference,
  RunScratchpad,
} from "./types";

const TIME_BUDGET_MS = 50_000;

// ─── Start a new agent run ───

export async function executeAgentRun(params: {
  goal: string;
  targetId?: string;
  trigger?: string;
  parentRunId?: string;
}): Promise<{ runId: string; status: string; gateId?: string }> {
  ensureToolsRegistered();
  const startTime = Date.now();

  const scratchpad = createEmptyScratchpad();
  const run = await createAgentRun(params);

  await updateAgentRun(run.id, {
    status: "planning",
    started_at: new Date().toISOString(),
    context_json: JSON.stringify({ targetId: params.targetId, scratchpad }),
  });

  // Build memory and plan
  const memory = await buildOperationalMemory(params.targetId);
  const plan = await createAgentPlan(params.goal, memory);

  await updateAgentRun(run.id, {
    status: "executing",
    plan_json: JSON.stringify(plan),
  });

  // Save plan step
  await createAgentStep({
    runId: run.id,
    stepIndex: 0,
    type: "plan",
    outputJson: JSON.stringify(plan),
    reasoning: plan.reasoning,
  });

  const result = await runLoop(run.id, startTime);

  // If the time budget ran out but the run isn't done, schedule continuation
  if (result.status === "executing") {
    triggerContinuation(run.id).catch(() => {});
  }

  return result;
}

// ─── In-process loop with time budget ───

async function runLoop(
  runId: string,
  startTime: number
): Promise<{ runId: string; status: string; gateId?: string }> {
  while (true) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      return { runId, status: "executing" };
    }

    const result = await executeOneStep(runId);
    if (result.status !== "executing") {
      return result;
    }
  }
}

// ─── Load scratchpad from run context ───

function loadScratchpad(run: AgentRun): RunScratchpad {
  try {
    const ctx = run.context_json ? JSON.parse(run.context_json) : {};
    return ctx.scratchpad || createEmptyScratchpad();
  } catch {
    return createEmptyScratchpad();
  }
}

async function saveScratchpad(runId: string, run: AgentRun, scratchpad: RunScratchpad): Promise<void> {
  const ctx = run.context_json ? JSON.parse(run.context_json) : {};
  ctx.scratchpad = scratchpad;
  await updateAgentRun(runId, { context_json: JSON.stringify(ctx) });
}

// ─── Execute a single step ───

async function executeOneStep(runId: string): Promise<{ runId: string; status: string; gateId?: string }> {
  const run = await getAgentRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "executing") return { runId, status: run.status };

  const plan: AgentPlan = run.plan_json ? JSON.parse(run.plan_json) : null;
  if (!plan) {
    await updateAgentRun(runId, { status: "failed", error: "No plan found" });
    return { runId, status: "failed" };
  }

  const currentStepIndex = (await getMaxStepIndex(runId)) + 1;
  if (currentStepIndex > plan.maxSteps) return completeRun(run);

  const ctx = run.context_json ? JSON.parse(run.context_json) : {};
  const scratchpad = loadScratchpad(run);
  const memory = await buildOperationalMemory(ctx.targetId || run.target_id || undefined);
  const preferences = await getAllLearnedPreferences();

  // ─── MID-RUN CHECK-IN ───
  const checkIn = await midRunCheckIn(run, scratchpad, currentStepIndex);
  if (!checkIn.onTrack) {
    await createAgentStep({
      runId,
      stepIndex: currentStepIndex,
      type: "think",
      reasoning: `[manager check-in] ${checkIn.adjustment}`,
    });
    scratchpad.workingNotes = `Manager check-in: ${checkIn.adjustment}`;
    await saveScratchpad(runId, run, scratchpad);
    return completeRun(run, `Stopped by manager: ${checkIn.adjustment}`);
  }

  // ─── AUTO-CHAIN: check if last tool provided a hint ───
  let decision: AgentDecision;

  if (scratchpad.lastToolResult && typeof scratchpad.lastToolResult === "object") {
    const lastResult = scratchpad.lastToolResult as { nextStepHint?: string; nextStepInput?: Record<string, unknown> };

    if (lastResult.nextStepHint && getTool(lastResult.nextStepHint)) {
      // Auto-chain: skip think(), use the hint directly
      const hintInput = lastResult.nextStepInput || { targetId: ctx.targetId || run.target_id };

      decision = {
        action: "tool_call",
        toolName: lastResult.nextStepHint,
        input: hintInput,
        reasoning: `Auto-chained from previous tool hint: ${lastResult.nextStepHint}`,
      };

      await createAgentStep({
        runId,
        stepIndex: currentStepIndex,
        type: "think",
        outputJson: JSON.stringify(decision),
        reasoning: `[auto-chain] ${decision.reasoning}`,
      });
    } else {
      decision = await thinkWithScratchpad(run, plan, memory, preferences, scratchpad);
      await createAgentStep({
        runId,
        stepIndex: currentStepIndex,
        type: "think",
        outputJson: JSON.stringify(decision),
        reasoning: decision.reasoning,
      });
    }
  } else {
    const steps = await getStepsForRun(runId);
    decision = await thinkWithScratchpad(run, plan, memory, preferences, scratchpad);
    await createAgentStep({
      runId,
      stepIndex: currentStepIndex,
      type: "think",
      outputJson: JSON.stringify(decision),
      reasoning: decision.reasoning,
    });
  }

  // Update working notes if the agent set them
  if (decision.workingNotes) {
    scratchpad.workingNotes = decision.workingNotes;
  }

  // Check if done — with self-critique
  if (decision.action === "complete") {
    const critique = await selfCritique(run, scratchpad, decision.outcome || "");
    if (!critique.shouldComplete) {
      // Override: agent tried to complete but manager says no
      await createAgentStep({
        runId,
        stepIndex: currentStepIndex + 1,
        type: "think",
        reasoning: `[manager override] Completion denied: ${critique.reason}. Continuing execution.`,
      });
      // Don't complete — let the loop continue with a fresh think()
      scratchpad.workingNotes = `Manager override: ${critique.reason}. Need to continue.`;
      scratchpad.lastToolResult = null; // Clear hint so we get a fresh think()
      await saveScratchpad(runId, run, scratchpad);
      return { runId, status: "executing" };
    }
    await saveScratchpad(runId, run, scratchpad);
    return completeRun(run, decision.outcome);
  }

  if (!decision.toolName) {
    await updateAgentRun(runId, { status: "failed", error: "No tool specified" });
    return { runId, status: "failed" };
  }

  // GATE CHECK
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
      gateType: "send_email",
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
    targetId: ctx.targetId || run.target_id || undefined,
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

  // OBSERVE
  await createAgentStep({
    runId,
    stepIndex: currentStepIndex + 2,
    type: "observe",
    inputJson: JSON.stringify({ toolName: decision.toolName }),
    outputJson: JSON.stringify({ success: result.success, error: result.error }),
    reasoning: result.success
      ? `Tool ${decision.toolName} succeeded`
      : `Tool ${decision.toolName} failed: ${result.error}`,
    tokensUsed: result.metadata?.tokensUsed || 0,
    durationMs,
  });

  // ─── UPDATE SCRATCHPAD ───
  scratchpad.completedSteps.push(
    `${decision.toolName}: ${result.success ? "OK" : "FAILED"} — ${decision.reasoning.slice(0, 100)}`
  );
  scratchpad.lastToolResult = {
    success: result.success,
    data: result.data,
    error: result.error,
    nextStepHint: result.nextStepHint,
    nextStepInput: result.nextStepInput,
  };

  // Track discovered targets
  if (decision.toolName === "discover_targets" && result.success && result.data) {
    const data = result.data as { results?: Array<{ name: string }> };
    if (data.results) {
      scratchpad.discoveredTargets = data.results.map((r) => ({ name: r.name }));
    }
  }
  if (decision.toolName === "discover_and_add" && result.success && result.data) {
    const data = result.data as { addedTargets?: Array<{ name: string; id: string }> };
    if (data.addedTargets) {
      scratchpad.discoveredTargets = data.addedTargets;
      scratchpad.targetQueue = data.addedTargets.map((t) => t.id);
    }
  }

  await saveScratchpad(runId, run, scratchpad);

  // Update token count
  await updateAgentRun(runId, {
    tokens_used: run.tokens_used + (result.metadata?.tokensUsed || 0),
  });

  return { runId, status: "executing" };
}

// ─── Continue a paused/stalled run ───

export async function executeNextStep(runId: string): Promise<{ runId: string; status: string; gateId?: string }> {
  ensureToolsRegistered();
  return runLoop(runId, Date.now());
}

// ─── Resume after approval gate ───

export async function resumeAfterApproval(gateId: string, action: "approved" | "rejected" | "edited", edits?: Record<string, unknown>): Promise<{ runId: string; status: string }> {
  ensureToolsRegistered();
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

  const payload = JSON.parse(resolved.payload);
  const toolInput = edits || payload.input;

  await updateAgentRun(run.id, { status: "executing" });

  const memory = await buildOperationalMemory(run.target_id || undefined);
  const preferences = await getAllLearnedPreferences();

  const toolCallRecord = await createToolCall({
    runId: run.id,
    toolName: payload.toolName,
    inputJson: JSON.stringify(toolInput),
  });

  const result = await executeTool(payload.toolName, toolInput, {
    runId: run.id,
    stepId: toolCallRecord.id,
    targetId: run.target_id || undefined,
    operationalMemory: memory,
    learnedPreferences: preferences,
  });

  await updateToolCall(toolCallRecord.id, {
    outputJson: JSON.stringify(result.data || result.error),
    status: result.success ? "success" : "error",
    error: result.error,
    durationMs: result.metadata?.durationMs,
  });

  return runLoop(run.id, Date.now());
}

// ─── Think with scratchpad context ───

async function thinkWithScratchpad(
  run: AgentRun,
  plan: AgentPlan,
  memory: OperationalMemory,
  preferences: LearnedPreference[],
  scratchpad: RunScratchpad
): Promise<AgentDecision> {
  const tools = getToolsForPrompt();
  const memoryStr = serializeMemoryForPrompt(memory);
  const learningStr = await buildLearningContext();
  const scratchpadStr = serializeScratchpad(scratchpad);

  const prompt = `You are an autonomous networking agent for Performance Golf.

GOAL: ${run.goal}

PLAN:
${plan.steps.map((s, i) => `${i + 1}. ${s.description} (${s.toolName})`).join("\n")}

CURRENT STATE:
${memoryStr}
${scratchpadStr}
${learningStr}

AVAILABLE TOOLS:
${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

CRITICAL RULES:
- Do NOT complete if there are targets in the targetQueue that haven't been researched/scored/drafted
- Do NOT complete if the goal mentions "research" or "outreach" but no targets have been researched or drafted yet
- After discover_and_add: use research_batch on the discovered target IDs
- After research_batch: use process_pipeline to score and draft outreach for the researched targets
- Only set action to "complete" when the FULL goal is achieved (discovery + research + outreach if the goal asked for all of those)
- Use workingNotes to track what you've done and what's left
- If you discovered targets but they haven't been researched yet, call research_batch with their IDs
- If targets are researched but not scored/drafted, call process_pipeline

Respond with JSON only:
{
  "action": "tool_call" or "complete",
  "toolName": "tool_name" (if tool_call),
  "input": {...} (if tool_call),
  "reasoning": "Why this is the right next step",
  "outcome": "Summary of what was accomplished" (if complete),
  "workingNotes": "Optional notes to carry forward to next step"
}`;

  const result = await askClaude(prompt, {
    system: "You are an agent decision-maker. Decide the next action. Respond with valid JSON only.",
    maxTokens: 800,
    temperature: 0,
  });

  try {
    return parseClaudeJson(result);
  } catch {
    return { action: "complete", reasoning: "Failed to parse decision", outcome: "Agent stopped due to decision parse error" };
  }
}

// ─── Complete a run ───

async function completeRun(run: AgentRun, outcome?: string): Promise<{ runId: string; status: string }> {
  // Run post-completion evaluation (fire-and-forget to not block response)
  const evaluationPromise = evaluateRun(run.id).then(async (evaluation) => {
    await updateAgentRun(run.id, {
      result_json: JSON.stringify({
        outcome: outcome || "Run completed",
        evaluation,
      }),
    });
  }).catch(() => {});

  await updateAgentRun(run.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    result_json: JSON.stringify({ outcome: outcome || "Run completed" }),
  });

  // Wait for evaluation but don't block for more than 10s
  await Promise.race([evaluationPromise, new Promise((r) => setTimeout(r, 10000))]);

  return { runId: run.id, status: "completed" };
}

// ─── Self-continuation fallback ───

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
