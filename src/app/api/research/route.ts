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
        name: "Callaway Golf Podcast",
        description: "Weekly podcast covering equipment, technique, and tour news.",
        relevance: "medium",
        golfConnection: "Golf equipment brand with large following",
        estimatedReach: "500K listeners",
      },
      {
        name: "Rick Shiels",
        description: "YouTube golf creator with equipment reviews and coaching content.",
        relevance: "high",
        golfConnection: "Golf content creator, PGA professional",
        estimatedReach: "3M+ subscribers",
      },
    ].filter(
      (r) =>
        !query ||
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        r.description.toLowerCase().includes(query.toLowerCase()) ||
        true
    ),
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

  // Keep query short for Tavily (400 char limit). Context goes to Claude later.
  const searchQuery = `${query} golf partnership brand`.slice(0, 390);

  let rawResult: string;
  try {
    rawResult = await searchPerplexity(searchQuery);
  } catch (err) {
    console.error("Search API error:", err);
    return NextResponse.json(
      { error: `Search failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 502 }
    );
  }

  if (!rawResult || rawResult.trim().length === 0) {
    return NextResponse.json(
      { error: "Search returned empty results. Try a different query." },
      { status: 502 }
    );
  }

  // Use Claude to structure the raw search results
  let results;
  const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasClaudeKey) {
    try {
      const structurePrompt = `Parse the following search results into a JSON array. Each item should have: name (string), description (string), relevance ("high"|"medium"|"low"), golfConnection (string), estimatedReach (string).

Search results:
${rawResult}

Return ONLY valid JSON array, no other text.`;

      const structured = await askClaude(structurePrompt, {
        system: "You are a JSON parser. Return only valid JSON arrays.",
        maxTokens: 1024,
        temperature: 0,
      });

      results = JSON.parse(structured);
    } catch (err) {
      console.error("Claude parse error:", err);
      // Fall through to raw result fallback
      results = null;
    }
  }

  if (!results) {
    // Fallback: return raw search as a single result
    results = [
      {
        name: "Search Results",
        description: rawResult.slice(0, 500),
        relevance: "medium" as const,
        golfConnection: "See description",
        estimatedReach: "Unknown",
      },
    ];
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
