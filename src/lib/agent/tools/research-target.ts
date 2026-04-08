import { registerTool } from "../registry";
import {
  getTarget,
  updateTarget,
  deleteResearch,
  insertResearchRows,
  deleteContactPaths,
  insertContactPaths,
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

interface ResearchInput {
  targetId: string;
}

interface ResearchOutput {
  dossier: Record<string, string>;
  contactPaths: Array<Omit<ContactPath, "id" | "target_id">>;
  quality: number;
  gapsFilled: string[];
  sourcesCount: number;
}

const SEARCH_QUERIES = (name: string) => [
  `${name} biography career achievements highlights`,
  `${name} golf handicap American Century Championship golf course`,
  `${name} Instagram Twitter LinkedIn YouTube social media followers`,
  `${name} agent manager booking contact representation`,
  `${name} foundation charity board member nonprofit`,
  `${name} recent news 2025 2026 latest activity`,
  `${name} hobbies interests passions outside work`,
  `${name} brand deals sponsorships endorsements partnerships`,
  `${name} email contact website business inquiries`,
  `${name} mutual connections friends collaborators golf buddies`,
];

registerTool<ResearchInput, ResearchOutput>({
  name: "research_target",
  description: "Run deep 10-search research on a target. Produces a full dossier with bio, golf connection, reach, contact paths, and more. Updates target status to researched.",
  category: "research",
  permissions: ["read", "write"],
  gate: "none",
  inputSchema: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "Target ID to research" },
    },
    required: ["targetId"],
  },
  timeout: 55000,
  async execute(input): Promise<ToolResult<ResearchOutput>> {
    const target = await getTarget(input.targetId);
    if (!target) {
      return { success: false, error: `Target ${input.targetId} not found` };
    }

    // Tier 1: 10 parallel searches
    const queries = SEARCH_QUERIES(target.name);
    const searchResults = await Promise.allSettled(
      queries.map((q) => search(q))
    );

    const allText: string[] = [];
    const allCitations: string[] = [];

    for (const r of searchResults) {
      if (r.status === "fulfilled" && r.value) {
        const tagged = tagSource(r.value.answer, r.value.provider);
        allText.push(tagged);
        allCitations.push(...(r.value.citations || []));
      }
    }

    const combinedText = allText.join("\n\n");

    // Extract contact info via regex
    const emails = extractEmails(combinedText);
    const phones = extractPhones(combinedText);
    const socials = extractSocialHandles(combinedText);

    // Tier 1 synthesis
    const synthesisPrompt = `You are a research analyst. Synthesize the following search results about ${target.name} into a structured dossier.

SEARCH RESULTS:
${combinedText.slice(0, 12000)}

EXTRACTED CONTACTS:
Emails: ${emails.join(", ") || "none found"}
Phones: ${phones.join(", ") || "none found"}
Social handles: ${JSON.stringify(socials)}

Respond with JSON only (no markdown):
{
  "bio": "3-4 sentence bio with specific numbers",
  "golfConnection": "Handicap, tournaments, club memberships, golf deals",
  "reach": "@handle (X followers) format, total audience estimate",
  "interests": "Charities, foundations, hobbies that could build rapport",
  "bestApproach": "The #1 recommended outreach strategy",
  "contactIntel": "Primary, backup, and wildcard contact paths with names & emails",
  "recentActivity": "Last 3-6 months activity with dates",
  "partnershipAngle": "Why ${target.name} + Performance Golf fits",
  "brandHistory": "Previous deals, competitive conflicts",
  "riskFlags": ["concern1", "concern2"],
  "sources": ["url1", "url2"],
  "contactPaths": [
    { "type": "direct|agent|wildcard", "name": "...", "role": "...", "email": "...", "channel": "email|dm", "confidence": "high|medium|low", "source_url": "..." }
  ]
}

If a field is unknown, use "UNKNOWN -- [describe what's missing]".`;

    const synthesized = await askClaude(synthesisPrompt, {
      system: "You are a research analyst. Respond with valid JSON only.",
      maxTokens: 3000,
      temperature: 0,
    });

    let dossier: Record<string, unknown>;
    try {
      dossier = JSON.parse(synthesized);
    } catch {
      return { success: false, error: "Failed to parse research synthesis" };
    }

    // Gap detection
    const gaps: string[] = [];
    const CRITICAL_FIELDS = ["contactIntel", "golfConnection", "recentActivity", "interests"];
    for (const field of CRITICAL_FIELDS) {
      const val = String(dossier[field] || "");
      if (val.includes("UNKNOWN") || val.length < 20) {
        gaps.push(field);
      }
    }

    // Tier 2: fill gaps with targeted re-queries
    if (gaps.length > 0) {
      const gapQueries: Record<string, string> = {
        contactIntel: `${target.name} agent manager publicist booking email contact information`,
        golfConnection: `${target.name} golf handicap golf tournament golf charity event`,
        recentActivity: `${target.name} latest news 2025 2026 recent project`,
        interests: `${target.name} hobbies passions charity foundation board`,
      };

      const gapResults = await Promise.allSettled(
        gaps.map((g) => search(gapQueries[g] || `${target.name} ${g}`))
      );

      for (let i = 0; i < gaps.length; i++) {
        const r = gapResults[i];
        if (r.status === "fulfilled" && r.value) {
          const gapField = gaps[i];
          const reSynthesis = await askClaude(
            `Update the "${gapField}" field for ${target.name} based on this new information:\n${r.value.answer}\n\nCurrent value: ${String(dossier[gapField])}\n\nReturn the improved value as a plain string.`,
            { system: "Update a research field with new data. Return plain text, not JSON.", maxTokens: 500, temperature: 0 }
          );
          dossier[gapField] = reSynthesis;
        }
      }
    }

    // Save to DB
    const fieldEntries = Object.entries(dossier)
      .filter(([k]) => k !== "contactPaths" && k !== "sources" && k !== "riskFlags")
      .map(([field, value]) => ({
        field,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));

    // Add sources and riskFlags as fields
    if (dossier.sources) {
      fieldEntries.push({ field: "sources", value: (dossier.sources as string[]).join("\n") });
    }
    if (dossier.riskFlags) {
      fieldEntries.push({ field: "risk_flags", value: JSON.stringify(dossier.riskFlags) });
    }

    await deleteResearch(input.targetId);
    await insertResearchRows(input.targetId, fieldEntries);

    // Save contact paths
    const contactPaths = ((dossier.contactPaths || []) as Array<Omit<ContactPath, "id" | "target_id">>).map((p) => ({
      type: p.type || "direct",
      name: p.name || "",
      role: p.role || "",
      email: p.email || null,
      channel: p.channel || "email",
      confidence: (p.confidence || "medium") as "high" | "medium" | "low",
      source_url: p.source_url || null,
    }));

    await deleteContactPaths(input.targetId);
    if (contactPaths.length > 0) {
      await insertContactPaths(input.targetId, contactPaths);
    }

    // Update target status
    await updateTarget(input.targetId, { status: "researched" });

    // Quality score
    const fieldMap: Record<string, string> = {};
    for (const f of fieldEntries) fieldMap[f.field] = f.value;
    const quality = scoreResearch(fieldMap, allCitations);

    const dossierStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(dossier)) {
      dossierStrings[k] = typeof v === "string" ? v : JSON.stringify(v);
    }

    return {
      success: true,
      data: {
        dossier: dossierStrings,
        contactPaths,
        quality,
        gapsFilled: gaps,
        sourcesCount: allCitations.length,
      },
    };
  },
});
