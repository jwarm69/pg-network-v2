import { registerTool } from "../registry";
import { getTarget, updateTarget } from "../../db";
import { executeTool } from "../tools";
import type { ToolResult, ToolContext } from "../types";

interface ProcessPipelineInput {
  targetIds: string[];
  stopAfter?: "research" | "score" | "draft";
}

interface TargetResult {
  targetId: string;
  name: string;
  researched: boolean;
  score: number | null;
  drafted: boolean;
  error?: string;
}

interface ProcessPipelineOutput {
  results: TargetResult[];
  processed: number;
  failed: number;
}

registerTool<ProcessPipelineInput, ProcessPipelineOutput>({
  name: "process_pipeline",
  description: "Process multiple targets through the full pipeline: research -> score -> generate outreach. Stops at the specified stage or runs the full pipeline. Processes targets sequentially to stay within time budget.",
  category: "outreach",
  permissions: ["read", "write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      targetIds: { type: "array", items: { type: "string" }, description: "Target IDs to process" },
      stopAfter: { type: "string", enum: ["research", "score", "draft"], description: "Stop after this stage (default: draft)" },
    },
    required: ["targetIds"],
  },
  timeout: 55000,
  async execute(input, context): Promise<ToolResult<ProcessPipelineOutput>> {
    const stopAfter = input.stopAfter || "draft";
    const results: TargetResult[] = [];
    const startTime = Date.now();

    for (const targetId of input.targetIds) {
      // Time check: stop if less than 15s remaining
      if (Date.now() - startTime > 40000) break;

      const target = await getTarget(targetId);
      if (!target) {
        results.push({ targetId, name: "unknown", researched: false, score: null, drafted: false, error: "Not found" });
        continue;
      }

      const result: TargetResult = { targetId, name: target.name, researched: false, score: null, drafted: false };

      try {
        // Research (if needed)
        if (target.status === "new") {
          const researchResult = await executeTool("research_target", { targetId }, context);
          result.researched = researchResult.success;
          if (!researchResult.success) {
            result.error = researchResult.error;
            results.push(result);
            continue;
          }
        } else {
          result.researched = true;
        }

        if (stopAfter === "research") { results.push(result); continue; }

        // Score
        const scoreResult = await executeTool("score_target", { targetId }, context);
        if (scoreResult.success && scoreResult.data) {
          result.score = (scoreResult.data as { score: number }).score;
        }

        if (stopAfter === "score") { results.push(result); continue; }

        // Draft outreach (only if score is decent)
        if (result.score !== null && result.score >= 40) {
          const outreachResult = await executeTool("generate_outreach", { targetId }, context);
          result.drafted = outreachResult.success;
        }

        results.push(result);
      } catch (err) {
        result.error = err instanceof Error ? err.message : "Unknown";
        results.push(result);
      }
    }

    const processed = results.filter((r) => !r.error).length;

    return {
      success: true,
      data: {
        results,
        processed,
        failed: results.length - processed,
      },
    };
  },
});
