import { askClaude } from "../claude";
import { getToolsForPrompt, ensureToolsRegistered } from "./tools";
import { serializeMemoryForPrompt, buildLearningContext } from "./memory";
import type { AgentPlan, OperationalMemory } from "./types";

export async function createAgentPlan(
  goal: string,
  memory: OperationalMemory
): Promise<AgentPlan> {
  ensureToolsRegistered();
  const tools = getToolsForPrompt();
  const memoryContext = serializeMemoryForPrompt(memory);
  const learningContext = await buildLearningContext();

  const prompt = `You are an autonomous networking agent for Performance Golf. Your job is to plan how to achieve a goal using the available tools.

GOAL: ${goal}

CURRENT STATE:
${memoryContext || "(No target-specific context)"}
${learningContext}

AVAILABLE TOOLS:
${tools.map((t) => `- ${t.name}: ${t.description}\n  Input: ${JSON.stringify(t.inputSchema)}`).join("\n\n")}

RULES:
- create_gmail_draft and send_gmail_draft require human approval (the system will pause for this automatically)
- Research before scoring. Score before generating outreach.
- If the target is already researched, don't re-research unless the goal specifically asks for fresh data.
- If outreach already exists, don't regenerate unless asked.
- Keep plans concise: 2-6 steps max.

Create a plan as JSON:
{
  "reasoning": "Why this plan makes sense given the current state",
  "steps": [
    { "description": "What this step does", "toolName": "tool_name", "estimatedInput": {...}, "gateExpected": false }
  ],
  "maxSteps": 10
}

Respond with JSON only.`;

  const result = await askClaude(prompt, {
    system: "You are an agent planner. Create concise, actionable plans. Respond with valid JSON only.",
    maxTokens: 1500,
    temperature: 0,
  });

  try {
    const plan = JSON.parse(result);
    return {
      goal,
      reasoning: plan.reasoning || "",
      steps: plan.steps || [],
      maxSteps: plan.maxSteps || 10,
    };
  } catch {
    // Fallback plan based on goal keywords
    return createFallbackPlan(goal, memory);
  }
}

function createFallbackPlan(goal: string, memory: OperationalMemory): AgentPlan {
  const lower = goal.toLowerCase();
  const targetId = memory.target?.id;

  if (lower.includes("research") && targetId) {
    return {
      goal,
      reasoning: "Goal mentions research, creating a research plan",
      steps: [
        { description: "Research the target", toolName: "research_target", estimatedInput: { targetId }, gateExpected: false },
        { description: "Score the target", toolName: "score_target", estimatedInput: { targetId }, gateExpected: false },
      ],
      maxSteps: 5,
    };
  }

  if (lower.includes("outreach") || lower.includes("message") || lower.includes("draft")) {
    const steps = [];
    if (memory.target?.status === "new") {
      steps.push({ description: "Research first", toolName: "research_target", estimatedInput: { targetId }, gateExpected: false });
      steps.push({ description: "Score target", toolName: "score_target", estimatedInput: { targetId }, gateExpected: false });
    }
    steps.push({ description: "Generate outreach", toolName: "generate_outreach", estimatedInput: { targetId }, gateExpected: false });
    return { goal, reasoning: "Goal mentions outreach", steps, maxSteps: 8 };
  }

  if (lower.includes("status") || lower.includes("pipeline")) {
    return {
      goal,
      reasoning: "Goal mentions pipeline status",
      steps: [{ description: "Get pipeline status", toolName: "get_pipeline_status", estimatedInput: {}, gateExpected: false }],
      maxSteps: 3,
    };
  }

  // Generic: just check status
  return {
    goal,
    reasoning: "Unclear goal, starting with pipeline overview",
    steps: [{ description: "Check pipeline", toolName: "get_pipeline_status", estimatedInput: {}, gateExpected: false }],
    maxSteps: 5,
  };
}
