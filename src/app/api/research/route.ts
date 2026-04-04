import { NextRequest, NextResponse } from "next/server";
import {
  isDbConfigured,
  getTarget,
  updateTarget,
  getResearch,
  deleteResearch,
  insertResearchRows,
} from "@/lib/db";
import { searchPerplexity, isPerplexityConfigured } from "@/lib/perplexity";
import { askClaude } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── GET: fetch research fields for a target ───

export async function GET(request: NextRequest) {
  const targetId = request.nextUrl.searchParams.get("targetId");

  if (!targetId) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ fields: [] });
  }

  try {
    const data = await getResearch(targetId);
    return NextResponse.json({ fields: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Discovery mode mock data ───

function mockDiscoveryResults(query: string) {
  return {
    mode: "discover",
    mock: true,
    note: "API keys not fully configured. Showing mock results.",
    results: [
      {
        name: "Tiger Woods",
        description: "Golf legend with massive brand reach. Active in course design and media.",
        relevance: "high",
        golfConnection: "Professional golfer, 15x major champion",
        estimatedReach: "50M+",
      },
      {
        name: "Rick Shiels",
        description: "YouTube golf creator with equipment reviews and coaching content.",
        relevance: "high",
        golfConnection: "Golf content creator, PGA professional",
        estimatedReach: "3M+ subscribers",
      },
      {
        name: "No Laying Up",
        description: "Popular golf media brand with podcast, video, and social content.",
        relevance: "high",
        golfConnection: "Golf media company covering PGA Tour and amateur golf",
        estimatedReach: "500K+ across platforms",
      },
      {
        name: "Paige Spiranac",
        description: "Former golfer turned media personality and content creator.",
        relevance: "high",
        golfConnection: "Professional golfer, golf influencer",
        estimatedReach: "4M+ Instagram",
      },
      {
        name: "Erik Anders Lang",
        description: "Golf filmmaker and host of Adventures in Golf on Skratch.",
        relevance: "medium",
        golfConnection: "Golf content creator focused on golf culture",
        estimatedReach: "200K+ subscribers",
      },
      {
        name: "Callaway Golf Podcast",
        description: "Weekly podcast covering equipment, technique, and tour news.",
        relevance: "medium",
        golfConnection: "Golf equipment brand with large following",
        estimatedReach: "500K listeners",
      },
    ],
  };
}

// ─── Target research mock data ───

function mockResearchDossier(targetName: string) {
  return {
    mode: "research",
    mock: true,
    note: "API keys not fully configured. Showing mock dossier.",
    dossier: {
      bio: `${targetName} is a prominent figure in the golf industry. Further research with configured API keys will provide detailed background information.`,
      golfConnection:
        "UNKNOWN — manual research needed to determine specific golf connection and history.",
      reach: "UNKNOWN — configure API keys to pull social media metrics and audience data.",
      contactIntel:
        "UNKNOWN — configure API keys to search for agent/management and contact paths.",
      recentActivity:
        "UNKNOWN — configure API keys to find recent social media posts, appearances, and news.",
      sources: [],
    },
    researchFields: [
      { field: "bio", value: `Prominent figure in golf. Manual research needed for full bio.` },
      { field: "golf_connection", value: "UNKNOWN — needs manual research" },
      { field: "reach", value: "UNKNOWN — needs API keys" },
      { field: "contact_intel", value: "UNKNOWN — needs API keys" },
      { field: "recent_activity", value: "UNKNOWN — needs API keys" },
    ],
  };
}

// ─── POST handler ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targetId, query } = body;

    // ── Discovery mode ──
    if (query && !targetId) {
      return handleDiscovery(query);
    }

    // ── Target research mode ──
    if (targetId) {
      return handleTargetResearch(targetId);
    }

    return NextResponse.json(
      { error: "Provide either 'query' (discovery) or 'targetId' (research)" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Discovery: search for potential targets ───

async function handleDiscovery(query: string) {
  if (!isPerplexityConfigured()) {
    return NextResponse.json(mockDiscoveryResults(query));
  }

  // Run two parallel searches: the direct query + an expanded version for more coverage
  const directQuery = query.slice(0, 390);
  const expandedQuery = `list of specific ${query} names people shows`.slice(0, 390);

  let rawResults: string[] = [];
  try {
    const searchResults = await Promise.allSettled([
      searchPerplexity(directQuery),
      searchPerplexity(expandedQuery),
    ]);

    for (const result of searchResults) {
      if (result.status === "fulfilled" && result.value?.trim()) {
        rawResults.push(result.value);
      }
    }
  } catch (err) {
    console.error("Search API error:", err);
    return NextResponse.json(
      { error: `Search failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 502 }
    );
  }

  if (rawResults.length === 0) {
    return NextResponse.json(
      { error: "Search returned empty results. Try a different query." },
      { status: 502 }
    );
  }

  const combinedRaw = rawResults.join("\n\n---\n\n");

  // Use Claude to extract individual targets from the raw search data
  let results;
  const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasClaudeKey) {
    try {
      const structurePrompt = `The user searched for: "${query}"

Here are raw search results:
${combinedRaw}

Extract every distinct person, podcast, show, brand, or entity mentioned into a JSON array. Each entry MUST be a separate, specific item — never combine multiple into one entry, and never return a single generic "Search Results" entry.

Each item in the array:
- name: the specific name of the person, podcast, show, or brand
- description: 1-2 sentence summary of who/what they are (be specific)
- relevance: "high" | "medium" | "low" based on how well they match "${query}"
- golfConnection: their specific connection to golf (be concrete)
- estimatedReach: follower count, audience size, or "Unknown" if not found

Return at least 5 entries if the data supports it. Return ONLY a valid JSON array, no other text.`;

      const structured = await askClaude(structurePrompt, {
        system: "You extract structured data from search results. Always return a JSON array with multiple individual entries. Never lump results into a single entry.",
        maxTokens: 2048,
        temperature: 0,
      });

      results = JSON.parse(structured);
      // Validate we got an array with proper entries
      if (!Array.isArray(results) || results.length === 0) {
        results = null;
      }
    } catch (err) {
      console.error("Claude parse error:", err);
      results = null;
    }
  }

  if (!results) {
    // Fallback: try to split raw text into individual items by line patterns
    const lines = combinedRaw.split("\n").filter((l) => l.trim().length > 10);
    const namePattern = /^[-*•]\s*\*?\*?([^:*]+)\*?\*?\s*[:—–-]/;
    const extracted = lines
      .map((line) => {
        const match = line.match(namePattern);
        if (match) {
          return {
            name: match[1].trim().replace(/\*+/g, ""),
            description: line.replace(namePattern, "").trim().slice(0, 200),
            relevance: "medium" as const,
            golfConnection: "See description",
            estimatedReach: "Unknown",
          };
        }
        return null;
      })
      .filter(Boolean);

    if (extracted.length >= 2) {
      results = extracted;
    } else {
      // Last resort: split by sentences that mention names
      results = [{
        name: "Search Results",
        description: combinedRaw.slice(0, 500),
        relevance: "medium" as const,
        golfConnection: "See description",
        estimatedReach: "Unknown",
      }];
    }
  }

  return NextResponse.json({
    mode: "discover",
    mock: false,
    results,
  });
}

// ─── Target research: build a dossier ───

async function handleTargetResearch(targetId: string) {
  let targetName = "Unknown Target";
  let targetType = "celebrity";

  if (isDbConfigured()) {
    const target = await getTarget(targetId);
    if (!target) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }
    targetName = target.name;
    targetType = target.type;
  }

  if (!isPerplexityConfigured()) {
    const mock = mockResearchDossier(targetName);

    if (isDbConfigured()) {
      await saveResearchRows(targetId, mock.researchFields);
      await updateTarget(targetId, { status: "researched" } as Partial<import("@/lib/db").Target>);
    }

    return NextResponse.json(mock);
  }

  // Run multiple searches in parallel (keep queries under 400 chars for Tavily)
  const name = targetName.slice(0, 80);
  const [bioResult, golfResult, contactResult, activityResult, reachResult] =
    await Promise.all([
      searchPerplexity(
        `${name} bio career highlights current projects`
      ),
      searchPerplexity(
        `${name} golf connection partnerships golf events`
      ),
      searchPerplexity(
        `${name} agent manager management contact brand partnerships`
      ),
      searchPerplexity(
        `${name} recent news social media appearances 2025 2026`
      ),
      searchPerplexity(
        `${name} social media following Instagram Twitter YouTube TikTok`
      ),
    ]);

  // Synthesize with Claude
  const synthesisPrompt = `You are building a research dossier for a potential brand partnership target for Performance Golf.

Target: ${targetName} (type: ${targetType})

Here is the raw research:

BIO RESEARCH:
${bioResult}

GOLF CONNECTION:
${golfResult}

CONTACT/MANAGEMENT INTEL:
${contactResult}

RECENT ACTIVITY:
${activityResult}

SOCIAL REACH:
${reachResult}

Synthesize this into a structured dossier with these sections. Be concise and factual. If information is unavailable, say "UNKNOWN — [what manual research is needed]".

Return a JSON object with these fields:
- bio: string (2-3 sentences)
- golfConnection: string (their relationship to golf)
- reach: string (follower counts, audience metrics)
- contactIntel: string (agent/manager info, best contact path)
- recentActivity: string (what they've been up to lately)
- sources: string[] (any URLs or publications referenced)
- partnershipAngle: string (why this would be a good fit for Performance Golf)
- riskFlags: string[] (any concerns — controversies, refusal of brand deals, etc.)

Return ONLY valid JSON, no other text.`;

  let dossier;
  try {
    const synthesized = await askClaude(synthesisPrompt, {
      maxTokens: 2048,
      temperature: 0.3,
    });
    dossier = JSON.parse(synthesized);
  } catch {
    dossier = {
      bio: bioResult.slice(0, 300),
      golfConnection: golfResult.slice(0, 300),
      reach: reachResult.slice(0, 300),
      contactIntel: contactResult.slice(0, 300),
      recentActivity: activityResult.slice(0, 300),
      sources: [],
      partnershipAngle: "Could not synthesize — review raw research above.",
      riskFlags: [],
    };
  }

  // Save research rows
  const researchFields = [
    { field: "bio", value: dossier.bio || "" },
    { field: "golf_connection", value: dossier.golfConnection || "" },
    { field: "reach", value: dossier.reach || "" },
    { field: "contact_intel", value: dossier.contactIntel || "" },
    { field: "recent_activity", value: dossier.recentActivity || "" },
    { field: "partnership_angle", value: dossier.partnershipAngle || "" },
    {
      field: "risk_flags",
      value: Array.isArray(dossier.riskFlags)
        ? dossier.riskFlags.join("; ")
        : dossier.riskFlags || "",
    },
  ];

  if (isDbConfigured()) {
    await saveResearchRows(targetId, researchFields);
    await updateTarget(targetId, { status: "researched" } as Partial<import("@/lib/db").Target>);
  }

  return NextResponse.json({
    mode: "research",
    mock: false,
    dossier,
    researchFields,
  });
}

// ─── Save research rows ───

async function saveResearchRows(
  targetId: string,
  fields: { field: string; value: string }[]
) {
  try {
    await deleteResearch(targetId);
    await insertResearchRows(targetId, fields);
  } catch (err) {
    console.error("Failed to save research:", err);
  }
}
