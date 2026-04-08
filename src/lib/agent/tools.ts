import type { ToolContext, ToolResult } from "./types";
import { getTool as _getTool, getAllTools, getToolsForPrompt } from "./registry";

export { registerTool, getTool, getAllTools, getToolsForPrompt } from "./registry";

// ─── Lazy Tool Registration ───

let _toolsRegistered = false;

export function ensureToolsRegistered(): void {
  if (_toolsRegistered) return;
  _toolsRegistered = true;

  // Dynamic imports to avoid circular dependency
  require("./tools/discover-targets");
  require("./tools/research-target");
  require("./tools/score-target");
  require("./tools/generate-outreach");
  require("./tools/create-gmail-draft");
  require("./tools/send-gmail-draft");
  require("./tools/check-replies");
  require("./tools/update-target");
  require("./tools/get-pipeline-status");
  require("./tools/discover-and-add");
  require("./tools/research-batch");
  require("./tools/process-pipeline");
}

// ─── Tool Executor ───

export async function executeTool(
  toolName: string,
  input: unknown,
  context: ToolContext
): Promise<ToolResult> {
  ensureToolsRegistered();

  const tool = _getTool(toolName);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  const timeout = tool.timeout || 55000;
  const start = Date.now();

  try {
    const result = await Promise.race([
      tool.execute(input, context),
      new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${timeout}ms`)), timeout)
      ),
    ]);

    return {
      ...result,
      metadata: {
        ...result.metadata,
        durationMs: Date.now() - start,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      metadata: { durationMs: Date.now() - start },
    };
  }
}
