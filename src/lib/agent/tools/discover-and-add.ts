import { registerTool } from "../registry";
import { searchText } from "../../search-providers";
import { askClaude } from "../../claude";
import { createTarget, logActivity } from "../../db";
import type { ToolResult, ToolContext } from "../types";

interface DiscoverAndAddInput {
  query: string;
  targetType?: "celebrity" | "podcast" | "organic";
  maxTargets?: number;
}

interface AddedTarget {
  id: string;
  name: string;
  type: string;
  description: string;
}

interface DiscoverAndAddOutput {
  addedTargets: AddedTarget[];
  rawSearch: string;
}

registerTool<DiscoverAndAddInput, DiscoverAndAddOutput>({
  name: "discover_and_add",
  description: "Discover potential networking targets matching a query AND automatically add them to the database. Returns the added targets with their IDs, ready for research. Use this instead of discover_targets when you want to act on the results.",
  category: "discovery",
  permissions: ["read", "write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query for finding targets" },
      targetType: { type: "string", enum: ["celebrity", "podcast", "organic"] },
      maxTargets: { type: "number", description: "Max targets to add (default 5)" },
    },
    required: ["query"],
  },
  timeout: 40000,
  async execute(input, context): Promise<ToolResult<DiscoverAndAddOutput>> {
    const maxTargets = input.maxTargets || 5;
    const targetType = input.targetType || "celebrity";
    const searchQuery = `Find golf influencers, celebrities, or podcast hosts matching: ${input.query}. Include their name, a one-line description, and why they'd be a good networking target for a $120M golf technology company. List up to ${maxTargets} people.`;

    const rawSearch = await searchText(searchQuery);
    if (!rawSearch) {
      return { success: true, data: { addedTargets: [], rawSearch: "" } };
    }

    const extractPrompt = `Extract up to ${maxTargets} real people from this search result. Return JSON array:
[{"name": "Full Name", "description": "One-line description", "type": "${targetType}"}]

Only include real, identifiable people. No fictional or generic entries.

Search results:
${rawSearch}

Respond with JSON array only.`;

    const extracted = await askClaude(extractPrompt, {
      system: "Extract structured data. Respond with valid JSON only.",
      maxTokens: 1024,
      temperature: 0,
    });

    let parsed: Array<{ name: string; description: string; type?: string }>;
    try {
      parsed = JSON.parse(extracted);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      return { success: true, data: { addedTargets: [], rawSearch } };
    }

    // Add each target to the database
    const addedTargets: AddedTarget[] = [];
    for (const p of parsed.slice(0, maxTargets)) {
      if (!p.name) continue;
      try {
        const target = await createTarget({
          name: p.name,
          type: (p.type as "celebrity" | "podcast" | "organic") || targetType,
          status: "new",
          priority: "medium",
          channel: "",
          score: null,
          notes: p.description || "",
          source: "agent_discovered",
          created_by_run_id: context.runId || null,
        });
        addedTargets.push({
          id: target.id,
          name: target.name,
          type: target.type,
          description: p.description || "",
        });
        logActivity({
          target_id: target.id,
          action: "target_created",
          details: `Agent discovered via "${input.query}" (run: ${context.runId})`,
        }).catch(() => {});
      } catch { /* skip duplicates or errors */ }
    }

    return {
      success: true,
      data: { addedTargets, rawSearch },
      // Hint: next step is to research these targets
      ...(addedTargets.length > 0 ? {
        nextStepHint: "research_batch",
        nextStepInput: { targetIds: addedTargets.map((t) => t.id) },
      } : {}),
    };
  },
});
