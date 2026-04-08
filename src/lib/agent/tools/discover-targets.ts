import { registerTool } from "../registry";
import { searchText } from "../../search-providers";
import { askClaude } from "../../claude";
import type { ToolResult } from "../types";

interface DiscoverInput {
  query: string;
  targetType?: "celebrity" | "podcast" | "organic";
}

interface DiscoverResult {
  results: Array<{
    name: string;
    description: string;
    relevance: string;
    golfConnection: string;
    estimatedReach: string;
  }>;
  rawSearch: string;
}

registerTool<DiscoverInput, DiscoverResult>({
  name: "discover_targets",
  description: "Search the web for potential networking targets matching a query. Returns named prospects with relevance, golf connection, and estimated reach.",
  category: "discovery",
  permissions: ["read"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query for finding targets" },
      targetType: { type: "string", enum: ["celebrity", "podcast", "organic"] },
    },
    required: ["query"],
  },
  timeout: 30000,
  async execute(input): Promise<ToolResult<DiscoverResult>> {
    const typeHint = input.targetType ? ` (focus on ${input.targetType} targets)` : "";
    const searchQuery = `Find golf influencers, celebrities, or podcast hosts matching: ${input.query}${typeHint}. Include their name, relevance to golf, social following, and why they'd be a good networking target for a golf technology company.`;

    const rawSearch = await searchText(searchQuery);
    if (!rawSearch) {
      return { success: true, data: { results: [], rawSearch: "" } };
    }

    const extractPrompt = `Extract structured targets from this search result. Return JSON array with objects having: name, description (1 sentence), relevance (why good for golf company), golfConnection (any golf ties), estimatedReach (followers/audience). Max 5 targets.

Search results:
${rawSearch}

Respond with JSON array only.`;

    const extracted = await askClaude(extractPrompt, {
      system: "You extract structured data from search results. Respond with valid JSON only.",
      maxTokens: 1024,
      temperature: 0,
    });

    try {
      const results = JSON.parse(extracted);
      return { success: true, data: { results: Array.isArray(results) ? results : [], rawSearch } };
    } catch {
      return { success: true, data: { results: [], rawSearch } };
    }
  },
});
