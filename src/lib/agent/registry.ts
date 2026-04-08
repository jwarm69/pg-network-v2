import type { ToolDefinition } from "./types";

// ─── Singleton Registry ───

const TOOL_REGISTRY = new Map<string, ToolDefinition>();

export function registerTool<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
  TOOL_REGISTRY.set(tool.name, tool as ToolDefinition);
}

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.get(name);
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(TOOL_REGISTRY.values());
}

export function getToolsForPrompt(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return Array.from(TOOL_REGISTRY.values()).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}
