import { registerTool } from "../registry";
import { getTarget, updateTarget, logActivity, type Target } from "../../db";
import type { ToolResult } from "../types";

interface UpdateTargetInput {
  targetId: string;
  updates: Partial<Target>;
}

interface UpdateTargetOutput {
  target: Target;
  changedFields: string[];
}

registerTool<UpdateTargetInput, UpdateTargetOutput>({
  name: "update_target_status",
  description: "Update a target's fields (status, priority, score, notes, etc.).",
  category: "status",
  permissions: ["write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "Target ID" },
      updates: {
        type: "object",
        description: "Fields to update",
        properties: {
          status: { type: "string" },
          priority: { type: "string" },
          score: { type: "number" },
          notes: { type: "string" },
          channel: { type: "string" },
        },
      },
    },
    required: ["targetId", "updates"],
  },
  async execute(input): Promise<ToolResult<UpdateTargetOutput>> {
    const before = await getTarget(input.targetId);
    if (!before) {
      return { success: false, error: `Target ${input.targetId} not found` };
    }

    const target = await updateTarget(input.targetId, input.updates);

    const changedFields: string[] = [];
    for (const [key, value] of Object.entries(input.updates)) {
      const oldVal = (before as unknown as Record<string, unknown>)[key];
      if (String(oldVal) !== String(value)) {
        changedFields.push(key);
      }
    }

    if (changedFields.length > 0) {
      await logActivity({
        target_id: input.targetId,
        action: "target_updated",
        details: `Agent updated: ${changedFields.map((f) => `${f} = ${(input.updates as Record<string, unknown>)[f]}`).join(", ")}`,
      });
    }

    return {
      success: true,
      data: { target, changedFields },
    };
  },
});
