import { registerTool } from "../registry";
import { getTargets, type Target } from "../../db";
import type { ToolResult } from "../types";

interface PipelineStatusInput {
  filter?: {
    status?: string;
    priority?: string;
    type?: string;
  };
}

interface PipelineStatusOutput {
  summary: string;
  totalTargets: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  overdue: Array<{ id: string; name: string; status: string; daysSinceUpdate: number }>;
  responseRate: number;
  targets: Target[];
}

registerTool<PipelineStatusInput, PipelineStatusOutput>({
  name: "get_pipeline_status",
  description: "Get a summary of the networking pipeline: target counts by status/priority/type, overdue targets, response rate, and full target list.",
  category: "status",
  permissions: ["read"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      filter: {
        type: "object",
        properties: {
          status: { type: "string" },
          priority: { type: "string" },
          type: { type: "string" },
        },
      },
    },
  },
  async execute(input): Promise<ToolResult<PipelineStatusOutput>> {
    let targets = await getTargets();

    // Apply filters
    if (input.filter) {
      if (input.filter.status) targets = targets.filter((t) => t.status === input.filter!.status);
      if (input.filter.priority) targets = targets.filter((t) => t.priority === input.filter!.priority);
      if (input.filter.type) targets = targets.filter((t) => t.type === input.filter!.type);
    }

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const t of targets) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;
    }

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const overdue = targets
      .filter((t) => !["completed", "archived"].includes(t.status) && new Date(t.updated_at).getTime() < sevenDaysAgo)
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        daysSinceUpdate: Math.floor((Date.now() - new Date(t.updated_at).getTime()) / (24 * 60 * 60 * 1000)),
      }));

    const drafted = targets.filter((t) =>
      ["drafted", "deck_sent", "in_contact", "pending_intro", "meeting_set", "completed"].includes(t.status)
    );
    const responded = targets.filter((t) =>
      ["in_contact", "pending_intro", "meeting_set", "completed"].includes(t.status)
    );
    const responseRate = drafted.length > 0 ? Math.round((responded.length / drafted.length) * 100) : 0;

    const summary = [
      `Pipeline: ${targets.length} targets`,
      `Status: ${Object.entries(byStatus).map(([s, c]) => `${s}(${c})`).join(", ")}`,
      `Overdue: ${overdue.length}`,
      `Response rate: ${responseRate}%`,
    ].join(" | ");

    return {
      success: true,
      data: {
        summary,
        totalTargets: targets.length,
        byStatus,
        byPriority,
        byType,
        overdue,
        responseRate,
        targets,
      },
    };
  },
});
