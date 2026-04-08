import { askClaude } from "../claude";
import { getToolsForPrompt, ensureToolsRegistered } from "./tools";
import { serializeMemoryForPrompt, buildLearningContext } from "./memory";
import type { AgentPlan, OperationalMemory, SubGoal } from "./types";

export async function createAgentPlan(
  goal: string,
  memory: OperationalMemory
): Promise<AgentPlan> {
  ensureToolsRegistered();
  const tools = getToolsForPrompt();
  const memoryContext = serializeMemoryForPrompt(memory);
  const learningContext = await buildLearningContext();

  const prompt = `You are an autonomous networking agent for Performance Golf. Plan how to achieve a goal.

GOAL: ${goal}

CURRENT STATE:
${memoryContext || "(No target-specific context)"}
${learningContext}

AVAILABLE TOOLS:
${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

KEY COMPOUND TOOLS:
- discover_and_add: Finds targets AND adds them to DB. Use for "find X type of people" goals.
- research_batch: Researches up to 3 targets in parallel. Use after discover_and_add.
- process_pipeline: Full pipeline (research→score→draft) for multiple targets. Use for "do everything" goals.

RULES:
- For goals mentioning discovery/finding people: use discover_and_add first, then research_batch or process_pipeline
- For goals about a specific known target: use research_target → score_target → generate_outreach (auto-chaining handles this)
- create_gmail_draft and send_gmail_draft require human approval
- Research before scoring. Score before drafting.
- If the target is already researched, skip research.

GOAL DECOMPOSITION:
If the goal is complex (involves discovery + processing, or multiple targets), decompose into subgoals:

{
  "reasoning": "Why this plan",
  "steps": [{ "description": "...", "toolName": "...", "estimatedInput": {...}, "gateExpected": false }],
  "maxSteps": 15,
  "subgoals": [
    { "id": "sg1", "description": "Find targets", "status": "pending", "toolSequence": ["discover_and_add"] },
    { "id": "sg2", "description": "Research all found targets", "status": "pending", "toolSequence": ["research_batch"] },
    { "id": "sg3", "description": "Score and draft outreach", "status": "pending", "toolSequence": ["process_pipeline"] }
  ]
}

For simple goals (one target, one action), omit subgoals.

Respond with JSON only.`;

  const result = await askClaude(prompt, {
    system: "You are an agent planner. Create plans with goal decomposition for complex goals. Respond with valid JSON only.",
    maxTokens: 2000,
    temperature: 0,
  });

  try {
    const plan = JSON.parse(result);
    return {
      goal,
      reasoning: plan.reasoning || "",
      steps: plan.steps || [],
      maxSteps: plan.maxSteps || 15,
      subgoals: plan.subgoals,
    };
  } catch {
    return createFallbackPlan(goal, memory);
  }
}

function createFallbackPlan(goal: string, memory: OperationalMemory): AgentPlan {
  const lower = goal.toLowerCase();
  const targetId = memory.target?.id;

  // Compound goal: discover + action
  const isDiscovery = /\b(discover|find|search for|look for)\b/.test(lower);
  const isAction = /\b(research|outreach|draft|message|score)\b/.test(lower);

  if (isDiscovery && isAction) {
    return {
      goal,
      reasoning: "Compound goal: discover targets then process them",
      steps: [
        { description: "Discover and add targets", toolName: "discover_and_add", estimatedInput: { query: goal }, gateExpected: false },
        { description: "Research discovered targets", toolName: "research_batch", estimatedInput: {}, gateExpected: false },
        { description: "Process pipeline for all targets", toolName: "process_pipeline", estimatedInput: {}, gateExpected: false },
      ],
      maxSteps: 15,
      subgoals: [
        { id: "sg1", description: "Discover targets", status: "pending", toolSequence: ["discover_and_add"] },
        { id: "sg2", description: "Research all targets", status: "pending", toolSequence: ["research_batch"] },
        { id: "sg3", description: "Score and draft", status: "pending", toolSequence: ["process_pipeline"] },
      ],
    };
  }

  if (isDiscovery) {
    return {
      goal,
      reasoning: "Discovery goal: find and add targets",
      steps: [
        { description: "Discover and add targets", toolName: "discover_and_add", estimatedInput: { query: goal }, gateExpected: false },
      ],
      maxSteps: 5,
    };
  }

  // Single-target with specific action
  if (lower.includes("research") && targetId) {
    return {
      goal,
      reasoning: "Research a specific target (auto-chains to score)",
      steps: [
        { description: "Research target", toolName: "research_target", estimatedInput: { targetId }, gateExpected: false },
      ],
      maxSteps: 8,
    };
  }

  if ((lower.includes("outreach") || lower.includes("draft") || lower.includes("message")) && targetId) {
    const steps = [];
    if (memory.target?.status === "new") {
      steps.push({ description: "Research first", toolName: "research_target", estimatedInput: { targetId }, gateExpected: false });
    }
    if (!memory.target?.score) {
      steps.push({ description: "Score target", toolName: "score_target", estimatedInput: { targetId }, gateExpected: false });
    }
    steps.push({ description: "Generate outreach", toolName: "generate_outreach", estimatedInput: { targetId }, gateExpected: false });
    return { goal, reasoning: "Outreach for specific target", steps, maxSteps: 8 };
  }

  // Multi-target action without discovery
  if (/\b(all|batch|every|each)\b/.test(lower) && isAction) {
    return {
      goal,
      reasoning: "Batch action on existing targets",
      steps: [
        { description: "Get pipeline status", toolName: "get_pipeline_status", estimatedInput: {}, gateExpected: false },
        { description: "Process matching targets", toolName: "process_pipeline", estimatedInput: {}, gateExpected: false },
      ],
      maxSteps: 15,
    };
  }

  if (lower.includes("status") || lower.includes("pipeline")) {
    return {
      goal,
      reasoning: "Pipeline status",
      steps: [{ description: "Get pipeline status", toolName: "get_pipeline_status", estimatedInput: {}, gateExpected: false }],
      maxSteps: 3,
    };
  }

  // Generic discovery-ish goals (mentions people types but no explicit "discover")
  if (/\b(golfer|podcast|celebrity|influencer|athlete)\b/.test(lower)) {
    return {
      goal,
      reasoning: "Goal mentions target types — treating as discovery + outreach",
      steps: [
        { description: "Discover and add targets", toolName: "discover_and_add", estimatedInput: { query: goal }, gateExpected: false },
      ],
      maxSteps: 15,
      subgoals: [
        { id: "sg1", description: "Discover targets", status: "pending", toolSequence: ["discover_and_add"] },
        { id: "sg2", description: "Process targets", status: "pending", toolSequence: ["process_pipeline"] },
      ],
    };
  }

  return {
    goal,
    reasoning: "Unclear goal, starting with pipeline overview",
    steps: [{ description: "Check pipeline", toolName: "get_pipeline_status", estimatedInput: {}, gateExpected: false }],
    maxSteps: 5,
  };
}
