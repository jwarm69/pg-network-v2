import { registerTool } from "../registry";
import {
  getTarget,
  getResearch,
  getContactPaths,
  updateTarget,
  createThread,
  insertMessages,
  type Lane,
} from "../../db";
import { askClaude } from "../../claude";
import { buildBrandDnaPrompt, ANGLE_ARCHETYPES, PROGRESSIVE_CONCISION } from "../../brand-dna";
import { validateMessage } from "../../validate";
import type { ToolResult, ToolContext } from "../types";

interface OutreachInput {
  targetId: string;
  angle?: string;
  contactPathType?: string;
  lanes?: Lane[];
}

interface GeneratedLane {
  lane: string;
  channel: string;
  threadId: string;
  messages: Array<{ sequence: number; subject: string; body: string }>;
  warnings: string[];
}

interface OutreachOutput {
  threads: GeneratedLane[];
  warnings: string[];
}

registerTool<OutreachInput, OutreachOutput>({
  name: "generate_outreach",
  description: "Generate 3-lane outreach message sequences for a target (direct, agent, wildcard). Each lane has up to 5 messages with progressive concision. Validates all messages against brand DNA voice rules.",
  category: "outreach",
  permissions: ["read", "write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "Target ID to generate outreach for" },
      angle: { type: "string", description: "Outreach angle archetype name" },
      contactPathType: { type: "string", enum: ["direct", "agent", "wildcard"] },
      lanes: { type: "array", items: { type: "string", enum: ["direct", "agent", "wildcard"] } },
    },
    required: ["targetId"],
  },
  timeout: 55000,
  async execute(input, context): Promise<ToolResult<OutreachOutput>> {
    const target = await getTarget(input.targetId);
    if (!target) {
      return { success: false, error: `Target ${input.targetId} not found` };
    }

    const research = await getResearch(input.targetId);
    const contactPaths = await getContactPaths(input.targetId);

    const fieldMap: Record<string, string> = {};
    for (const r of research) fieldMap[r.field] = r.value;

    // Select angle
    let angle = input.angle;
    if (!angle) {
      // Use learned preferences if available
      const anglePrefs = context.learnedPreferences.filter((p) => p.category === "angle_effectiveness");
      if (anglePrefs.length > 0) {
        const best = anglePrefs.sort((a, b) => {
          const aData = JSON.parse(a.value_json);
          const bData = JSON.parse(b.value_json);
          return (bData.replyRate || 0) - (aData.replyRate || 0);
        })[0];
        angle = best.key;
      } else {
        angle = ANGLE_ARCHETYPES[0]?.name || "The Founder Parallel";
      }
    }

    const lanes = input.lanes || ["direct", "agent", "wildcard"] as Lane[];
    const results: GeneratedLane[] = [];
    const allWarnings: string[] = [];

    for (const lane of lanes) {
      const lanePrompt = buildLanePrompt(target.name, lane, fieldMap, contactPaths, angle);

      const generated = await askClaude(lanePrompt, {
        system: buildBrandDnaPrompt(),
        maxTokens: 2500,
        temperature: 0.7,
      });

      let messages: Array<{ sequence: number; subject: string; body: string }>;
      try {
        messages = JSON.parse(generated);
        if (!Array.isArray(messages)) messages = [];
      } catch {
        // Try to extract from fenced code block
        const match = generated.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          try { messages = JSON.parse(match[1]); } catch { messages = []; }
        } else {
          messages = [];
        }
      }

      // Validate each message
      const warnings: string[] = [];
      for (const msg of messages) {
        const validation = validateMessage(msg.body, lane === "direct" ? "email" : "dm");
        if (!validation.valid) {
          for (const v of validation.violations) {
            warnings.push(`M${msg.sequence}: ${v.rule} - ${v.detail}`);
          }
        }
      }

      // Find appropriate contact path
      const path = contactPaths.find((p) => p.type === lane) || contactPaths[0];

      // Create thread in DB
      const thread = await createThread({
        target_id: input.targetId,
        lane,
        channel: path?.channel || "email",
        status: "draft",
        recipient_name: path?.name || null,
        recipient_email: path?.email || null,
      });

      // Insert messages
      if (messages.length > 0) {
        await insertMessages(
          messages.map((m) => ({
            thread_id: thread.id,
            sequence: m.sequence,
            subject: m.subject || "",
            body: m.body,
          }))
        );
      }

      results.push({
        lane,
        channel: path?.channel || "email",
        threadId: thread.id,
        messages,
        warnings,
      });

      allWarnings.push(...warnings);
    }

    // Update target status
    await updateTarget(input.targetId, { status: "drafted" });

    return {
      success: true,
      data: { threads: results, warnings: allWarnings },
    };
  },
});

function buildLanePrompt(
  targetName: string,
  lane: string,
  research: Record<string, string>,
  contactPaths: Array<{ type: string; name: string; role: string; email: string | null }>,
  angle: string
): string {
  const path = contactPaths.find((p) => p.type === lane);
  const concision = PROGRESSIVE_CONCISION.email;

  const laneInstructions: Record<string, string> = {
    direct: `Lane: DIRECT (peer-to-peer from Brixton to ${targetName})
Tone: Casual, peer-level. Reference their work, not their fame. Sign off as "Brixton".`,
    agent: `Lane: AGENT (to ${path?.name || "their representative"}, ${path?.role || "agent/manager"})
Tone: Business formal but warm. Lead with Performance Golf credentials. Sign off as "Team Performance Golf".`,
    wildcard: `Lane: WILDCARD (creative/unconventional approach)
Tone: Pattern interrupt. Use a mutual connection, shared experience, or creative hook. Be memorable.`,
  };

  return `Generate a 5-message outreach sequence for ${targetName}.

${laneInstructions[lane] || laneInstructions.direct}

Angle: ${angle}

Research context:
${Object.entries(research).map(([k, v]) => `${k}: ${v}`).join("\n")}

${path ? `Recipient: ${path.name} (${path.role})${path.email ? `, ${path.email}` : ""}` : ""}

Progressive concision:
M1: ${concision.M1}
M2: ${concision.M2}
M3: ${concision.M3}
M4: ${concision.M4}
M5: ${concision.M5}

Respond with JSON array only:
[
  { "sequence": 1, "subject": "...", "body": "..." },
  { "sequence": 2, "subject": "...", "body": "..." },
  ...
]`;
}
