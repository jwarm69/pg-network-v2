import { registerTool } from "../registry";
import {
  getTarget,
  updateTarget,
  deleteResearch,
  insertResearchRows,
  deleteContactPaths,
  insertContactPaths,
  logActivity,
  type ContactPath,
} from "../../db";
import {
  search,
  extractEmails,
  extractPhones,
  extractSocialHandles,
  scoreResearch,
  tagSource,
} from "../../search-providers";
import { askClaude } from "../../claude";
import type { ToolResult } from "../types";
import { parseClaudeJson } from "../utils";

interface ResearchBatchInput {
  targetIds: string[];
}

interface ResearchBatchResult {
  name: string;
  targetId: string;
  quality: number;
  status: "researched" | "failed";
  error?: string;
}

interface ResearchBatchOutput {
  results: ResearchBatchResult[];
  totalResearched: number;
  totalFailed: number;
}

async function researchOneTarget(targetId: string): Promise<ResearchBatchResult> {
  const target = await getTarget(targetId);
  if (!target) return { name: "unknown", targetId, quality: 0, status: "failed", error: "Not found" };

  try {
    const queries = [
      `${target.name} biography career achievements golf`,
      `${target.name} social media followers Instagram Twitter`,
      `${target.name} agent manager contact email`,
      `${target.name} recent news 2025 2026`,
      `${target.name} golf handicap tournament charity`,
    ];

    const searchResults = await Promise.allSettled(queries.map((q) => search(q)));
    const allText: string[] = [];
    const allCitations: string[] = [];

    for (const r of searchResults) {
      if (r.status === "fulfilled" && r.value) {
        allText.push(tagSource(r.value.answer, r.value.provider));
        allCitations.push(...(r.value.citations || []));
      }
    }

    const combinedText = allText.join("\n\n");
    const emails = extractEmails(combinedText);
    const socials = extractSocialHandles(combinedText);

    const synthesis = await askClaude(
      `Synthesize research on ${target.name} into JSON:
{
  "bio": "2-3 sentence bio",
  "golfConnection": "Golf ties",
  "reach": "Social following",
  "bestApproach": "Recommended outreach strategy",
  "contactIntel": "Contact paths",
  "recentActivity": "Recent activity",
  "partnershipAngle": "Why PG + them fits",
  "contactPaths": [{"type":"direct|agent|wildcard","name":"...","role":"...","email":"...","channel":"email|dm","confidence":"high|medium|low"}]
}

Data:\n${combinedText.slice(0, 8000)}\nEmails: ${emails.join(", ")}\nSocials: ${JSON.stringify(socials)}`,
      { system: "Research analyst. Valid JSON only.", maxTokens: 1500, temperature: 0 }
    );

    let dossier: Record<string, unknown>;
    try { dossier = parseClaudeJson(synthesis); } catch { dossier = { bio: "Research synthesis failed" }; }

    // Extract and save contact paths
    const contactPaths = ((dossier.contactPaths || []) as Array<Record<string, string>>).map((p) => ({
      type: p.type || "direct",
      name: p.name || "",
      role: p.role || "",
      email: p.email || null,
      channel: p.channel || "email",
      confidence: (p.confidence || "medium") as "high" | "medium" | "low",
      source_url: null,
    }));

    const fieldEntries = Object.entries(dossier)
      .filter(([k]) => k !== "contactPaths")
      .map(([field, value]) => ({
        field,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));

    await deleteResearch(targetId);
    await insertResearchRows(targetId, fieldEntries);
    await deleteContactPaths(targetId);
    if (contactPaths.length > 0) {
      await insertContactPaths(targetId, contactPaths);
    }
    await updateTarget(targetId, { status: "researched" });
    logActivity({ target_id: targetId, action: "research_completed", details: `Batch research completed for ${target.name}` }).catch(() => {});

    const fieldMap: Record<string, string> = {};
    for (const f of fieldEntries) fieldMap[f.field] = f.value;
    const quality = scoreResearch(fieldMap, allCitations);

    return { name: target.name, targetId, quality, status: "researched" };
  } catch (err) {
    return { name: target.name, targetId, quality: 0, status: "failed", error: err instanceof Error ? err.message : "Unknown" };
  }
}

registerTool<ResearchBatchInput, ResearchBatchOutput>({
  name: "research_batch",
  description: "Research multiple targets in parallel (up to 3 at a time). Lighter than full research — 5 searches per target instead of 10. Good for quickly processing a batch of newly discovered targets.",
  category: "research",
  permissions: ["read", "write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      targetIds: { type: "array", items: { type: "string" }, description: "Array of target IDs to research" },
    },
    required: ["targetIds"],
  },
  timeout: 55000,
  async execute(input): Promise<ToolResult<ResearchBatchOutput>> {
    const ids = input.targetIds.slice(0, 3); // Max 3 in parallel to stay in time budget

    const results = await Promise.allSettled(ids.map((id) => researchOneTarget(id)));

    const batchResults: ResearchBatchResult[] = results.map((r, i) =>
      r.status === "fulfilled" ? r.value : { name: "unknown", targetId: ids[i], quality: 0, status: "failed" as const, error: "Promise rejected" }
    );

    const researched = batchResults.filter((r) => r.status === "researched").length;

    return {
      success: true,
      data: {
        results: batchResults,
        totalResearched: researched,
        totalFailed: batchResults.length - researched,
      },
    };
  },
});
