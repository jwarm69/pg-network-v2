import { registerTool } from "../registry";
import { getTarget, updateTarget, getResearch } from "../../db";
import { calculateScore, type ScoreResult } from "../../scoring";
import { askClaude } from "../../claude";
import type { ToolResult, ToolContext } from "../types";

interface ScoreInput {
  targetId: string;
  dimensions?: Record<string, number>;
}

interface ScoreOutput extends ScoreResult {
  dimensions: Record<string, number>;
  adjustments: string[];
}

registerTool<ScoreInput, ScoreOutput>({
  name: "score_target",
  description: "Calculate a fit score for a target based on research data. Uses 6 weighted dimensions (reach, relevance, reachability, angleStrength, timing, meetingLikelihood). Optionally accepts pre-scored dimensions or auto-scores from research.",
  category: "scoring",
  permissions: ["read", "write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "Target ID to score" },
      dimensions: { type: "object", description: "Optional pre-scored dimensions (0-100 each)" },
    },
    required: ["targetId"],
  },
  async execute(input, context): Promise<ToolResult<ScoreOutput>> {
    const target = await getTarget(input.targetId);
    if (!target) {
      return { success: false, error: `Target ${input.targetId} not found` };
    }

    let dimensions = input.dimensions;

    // Auto-score from research if no dimensions provided
    if (!dimensions) {
      const research = await getResearch(input.targetId);
      const fieldMap: Record<string, string> = {};
      for (const r of research) fieldMap[r.field] = r.value;

      const prompt = `Score this networking target on 6 dimensions (0-100 each) based on the research data.

Target: ${target.name} (${target.type})
Research:
${Object.entries(fieldMap).map(([k, v]) => `${k}: ${v}`).join("\n")}

Dimensions to score:
- reach: How large is their audience/following?
- relevance: How relevant are they to a golf technology company?
- reachability: How easy would it be to actually reach them?
- angleStrength: How strong is the partnership angle?
- timing: Is the timing good based on recent activity?
- meetingLikelihood: How likely is a meeting to actually happen?

Respond with JSON only: { "reach": N, "relevance": N, "reachability": N, "angleStrength": N, "timing": N, "meetingLikelihood": N }`;

      const result = await askClaude(prompt, {
        system: "You score networking targets. Respond with valid JSON only.",
        maxTokens: 256,
        temperature: 0,
      });

      try {
        dimensions = JSON.parse(result);
      } catch {
        dimensions = { reach: 50, relevance: 50, reachability: 50, angleStrength: 50, timing: 50, meetingLikelihood: 50 };
      }
    }

    // Apply learned preference adjustments
    const adjustments: string[] = [];
    const scoringBias = context.learnedPreferences.filter((p) => p.category === "scoring_bias");
    for (const pref of scoringBias) {
      try {
        const bias = JSON.parse(pref.value_json) as { dimension: string; adjustment: number };
        if (dimensions![bias.dimension] !== undefined) {
          const old = dimensions![bias.dimension];
          dimensions![bias.dimension] = Math.max(0, Math.min(100, old + bias.adjustment));
          adjustments.push(`${bias.dimension}: ${old} -> ${dimensions![bias.dimension]} (learned bias)`);
        }
      } catch { /* skip invalid */ }
    }

    const scoreResult = calculateScore(target.type, dimensions!);

    // Save score to target
    await updateTarget(input.targetId, { score: scoreResult.score });

    return {
      success: true,
      data: {
        ...scoreResult,
        dimensions: dimensions!,
        adjustments,
      },
    };
  },
});
