import { askClaude } from "../claude";
import { getAgentRun, getStepsForRun, getToolCallsForRun, updateAgentRun } from "../db-agent";
import { getTarget, getResearch, getThreads, getMessages } from "../db";
import { buildBrandDnaPrompt } from "../brand-dna";
import type { AgentRun, AgentStep, ToolCall, RunScratchpad } from "./types";
import { parseClaudeJson } from "./utils";

// ─── Run Quality Evaluation ───

export interface RunEvaluation {
  overallScore: number;       // 0-100
  goalAchieved: boolean;
  dataQuality: number;        // 0-100: was the data saved correctly?
  decisionQuality: number;    // 0-100: did the agent make good choices?
  completeness: number;       // 0-100: did it finish everything the goal asked for?
  issues: string[];
  suggestions: string[];
  summary: string;
}

export async function evaluateRun(runId: string): Promise<RunEvaluation> {
  const run = await getAgentRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const steps = await getStepsForRun(runId);
  const toolCalls = await getToolCallsForRun(runId);

  // Build context about what happened
  const stepSummary = steps.map((s) => `[${s.type}] ${s.reasoning || ""}`).join("\n");
  const toolSummary = toolCalls.map((t) => `${t.tool_name}: ${t.status} (${t.duration_ms || 0}ms)`).join("\n");

  // Check what data was actually created
  const ctx = run.context_json ? JSON.parse(run.context_json) : {};
  const scratchpad: RunScratchpad = ctx.scratchpad || {};
  const targetIds = scratchpad.discoveredTargets?.map((t) => t.id).filter(Boolean) || [];

  let dataReport = "";
  for (const id of targetIds.slice(0, 5)) {
    if (!id) continue;
    const target = await getTarget(id);
    if (!target) { dataReport += `Target ${id}: NOT FOUND IN DB\n`; continue; }
    const research = await getResearch(id);
    const threads = await getThreads(id);
    dataReport += `${target.name} (${target.status}): ${research.length} research fields, ${threads.length} outreach threads\n`;
  }

  const prompt = `Evaluate this agent run's quality.

GOAL: ${run.goal}
STATUS: ${run.status}
DURATION: ${run.started_at && run.completed_at ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s` : "unknown"}

STEPS TAKEN:
${stepSummary}

TOOL CALLS:
${toolSummary}

DATA CREATED:
${dataReport || "(no targets processed)"}

SCRATCHPAD STATE:
Discovered targets: ${scratchpad.discoveredTargets?.length || 0}
Target queue remaining: ${scratchpad.targetQueue?.length || 0}
Completed steps: ${scratchpad.completedSteps?.length || 0}

Evaluate:
1. goalAchieved: Did the agent actually accomplish what was asked? (true/false)
2. dataQuality: Is the saved data complete and useful? (0-100)
3. decisionQuality: Did the agent make efficient, logical decisions? (0-100)
4. completeness: Did it handle all parts of the goal? (0-100)
5. issues: What went wrong or could be better? (array of strings)
6. suggestions: What should be done differently next time? (array of strings)
7. summary: One-paragraph evaluation

Respond with JSON only.`;

  const result = await askClaude(prompt, {
    system: "You are a quality evaluator for an AI agent system. Be honest and specific. Respond with valid JSON.",
    maxTokens: 1000,
    temperature: 0,
  });

  try {
    const ev = parseClaudeJson<RunEvaluation>(result);
    const overall = Math.round(
      ((ev.dataQuality || 0) + (ev.decisionQuality || 0) + (ev.completeness || 0)) / 3
    );
    return {
      overallScore: overall,
      goalAchieved: ev.goalAchieved ?? false,
      dataQuality: ev.dataQuality ?? 0,
      decisionQuality: ev.decisionQuality ?? 0,
      completeness: ev.completeness ?? 0,
      issues: ev.issues || [],
      suggestions: ev.suggestions || [],
      summary: ev.summary || "No evaluation summary",
    };
  } catch {
    return {
      overallScore: 0,
      goalAchieved: false,
      dataQuality: 0,
      decisionQuality: 0,
      completeness: 0,
      issues: ["Failed to parse evaluation"],
      suggestions: [],
      summary: "Evaluation failed — could not parse response",
    };
  }
}

// ─── Self-Critique Before Completion ───

export async function selfCritique(
  run: AgentRun,
  scratchpad: RunScratchpad,
  proposedOutcome: string
): Promise<{ shouldComplete: boolean; reason: string; revisedOutcome?: string }> {
  const unprocessed = scratchpad.targetQueue?.length || 0;
  const discovered = scratchpad.discoveredTargets?.length || 0;
  const completed = scratchpad.completedSteps?.length || 0;

  // Hard rules — don't need Claude for these
  if (unprocessed > 0) {
    return {
      shouldComplete: false,
      reason: `${unprocessed} targets still in queue — work is not done`,
    };
  }

  if (discovered > 0 && completed <= 1) {
    return {
      shouldComplete: false,
      reason: `Discovered ${discovered} targets but only completed ${completed} step — need to research/score/draft them`,
    };
  }

  // If goal mentions "research" or "outreach", check that targets were actually processed
  const goalLower = run.goal.toLowerCase();
  if ((goalLower.includes("research") || goalLower.includes("outreach") || goalLower.includes("draft")) && discovered > 0) {
    // Check if any targets actually got researched
    let anyResearched = false;
    for (const t of scratchpad.discoveredTargets || []) {
      if (t.id) {
        const target = await getTarget(t.id);
        if (target && target.status !== "new") anyResearched = true;
      }
    }
    if (!anyResearched) {
      return {
        shouldComplete: false,
        reason: `Goal mentions research/outreach but no discovered targets have been researched yet`,
      };
    }
  }

  // Claude-based soft critique for edge cases
  const prompt = `Should this agent run be marked as complete?

GOAL: ${run.goal}
PROPOSED OUTCOME: ${proposedOutcome}
STEPS COMPLETED: ${scratchpad.completedSteps?.join("; ") || "none"}
DISCOVERED TARGETS: ${discovered}
REMAINING QUEUE: ${unprocessed}

If the goal is fully achieved, respond: {"shouldComplete": true, "reason": "..."}
If there's more work to do, respond: {"shouldComplete": false, "reason": "..."}

JSON only.`;

  try {
    const result = await askClaude(prompt, {
      system: "You are a completion reviewer. Be strict — only approve completion if the FULL goal is achieved.",
      maxTokens: 200,
      temperature: 0,
    });
    return parseClaudeJson(result);
  } catch {
    // Default to completing if Claude fails — we've already done hard checks
    return { shouldComplete: true, reason: "Critique check passed (fallback)" };
  }
}

// ─── Mid-Run Check-In ───

export async function midRunCheckIn(
  run: AgentRun,
  scratchpad: RunScratchpad,
  stepsCompleted: number
): Promise<{ onTrack: boolean; adjustment?: string }> {
  // Check every 4 steps
  if (stepsCompleted % 4 !== 0 || stepsCompleted === 0) {
    return { onTrack: true };
  }

  // Quick heuristic checks
  const failedSteps = (scratchpad.completedSteps || []).filter((s) => s.includes("FAILED")).length;
  const totalSteps = scratchpad.completedSteps?.length || 0;

  if (failedSteps > totalSteps / 2) {
    return {
      onTrack: false,
      adjustment: "More than half of steps have failed — consider stopping or trying a different approach",
    };
  }

  if (stepsCompleted > 10 && (scratchpad.discoveredTargets?.length || 0) === 0) {
    return {
      onTrack: false,
      adjustment: "10+ steps completed but no targets discovered — the search may not be finding results",
    };
  }

  return { onTrack: true };
}
