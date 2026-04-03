import Anthropic from "@anthropic-ai/sdk";
import { buildBrandDnaPrompt } from "./brand-dna";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

interface ClaudeOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export async function askClaude(
  prompt: string,
  options: ClaudeOptions = {}
): Promise<string> {
  const {
    system = buildBrandDnaPrompt(),
    maxTokens = 2048,
    temperature = 0.7,
  } = options;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (block.type === "text") return block.text;
  return "";
}

export async function classifyIntent(input: string): Promise<{
  intent: string;
  entities: Record<string, string>;
  confidence: number;
}> {
  const system = `You are a command classifier for a networking CRM.
Classify the user's input into one of these intents:
- UPDATE_FIELD: changing a target's status, priority, or other field
- STATUS_QUERY: asking about pipeline state, who's overdue, etc.
- RESEARCH_CMD: requesting research on a person/podcast
- MESSAGE_CMD: requesting message generation or outreach
- DISCOVERY: finding new targets
- GENERAL_CHAT: conversational, not a command

Respond with JSON only: {"intent": "...", "entities": {...}, "confidence": 0.0-1.0}`;

  const result = await askClaude(input, { system, maxTokens: 256, temperature: 0 });
  try {
    return JSON.parse(result);
  } catch {
    return { intent: "GENERAL_CHAT", entities: {}, confidence: 0.5 };
  }
}
