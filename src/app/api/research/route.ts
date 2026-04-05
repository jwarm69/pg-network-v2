import { NextRequest, NextResponse } from "next/server";
import {
  isDbConfigured,
  getTarget,
  updateTarget,
  getResearch,
  getContactPaths,
  deleteResearch,
  insertResearchRows,
  deleteContactPaths,
  insertContactPaths,
  type ContactPath,
} from "@/lib/db";
import { searchPerplexity, isPerplexityConfigured } from "@/lib/perplexity";
import { askClaude } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── GET: fetch research fields + contact paths for a target ───

export async function GET(request: NextRequest) {
  const targetId = request.nextUrl.searchParams.get("targetId");

  if (!targetId) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ fields: [], contactPaths: [] });
  }

  try {
    const data = await getResearch(targetId);
    const contactPaths = await getContactPaths(targetId);
    return NextResponse.json({ fields: data, contactPaths });
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
      () => !query || true
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
      bio: `${targetName} is a prominent figure. Configure API keys for real research.`,
      golfConnection: "UNKNOWN — needs API keys",
      reach: "UNKNOWN — needs API keys",
      interests: "UNKNOWN — needs API keys",
      contactIntel: "UNKNOWN — needs API keys",
      bestApproach: "UNKNOWN — needs API keys",
      recentActivity: "UNKNOWN — needs API keys",
      sources: [],
      partnershipAngle: "UNKNOWN — needs API keys",
      riskFlags: [],
      contactPaths: [],
    },
    researchFields: [
      { field: "bio", value: `Configure API keys for real research on ${targetName}.` },
      { field: "golf_connection", value: "UNKNOWN — needs API keys" },
      { field: "reach", value: "UNKNOWN — needs API keys" },
      { field: "interests", value: "UNKNOWN — needs API keys" },
      { field: "contact_intel", value: "UNKNOWN — needs API keys" },
      { field: "best_approach", value: "UNKNOWN — needs API keys" },
      { field: "recent_activity", value: "UNKNOWN — needs API keys" },
    ],
    contactPaths: [],
  };
}

// ─── POST handler ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targetId, query } = body;

    if (query && !targetId) {
      return handleDiscovery(query);
    }

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

  let results;
  const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasClaudeKey) {
    try {
      const structurePrompt = `You are extracting individual people, podcasts, or brands from search results for a golf networking CRM.

The user searched for: "${query}"

Here are the raw search results:
${rawResult}

Extract 3-5 SPECIFIC, NAMED individuals, podcasts, or brands mentioned in these results. For each one, provide:
- name: Their actual name (a real person, podcast, or brand — NEVER "Search Results" or generic labels)
- description: 1-2 sentence description based on the search data
- relevance: "high", "medium", or "low" for a golf brand partnership
- golfConnection: Their specific connection to golf
- estimatedReach: Social media following or audience size if mentioned, otherwise "Unknown"

If the search results don't mention specific names, infer the most likely matches based on the query.

Return ONLY a valid JSON array, no markdown, no code fences, no other text.`;

      const structured = await askClaude(structurePrompt, {
        system: "Extract named entities from search results. Return only a JSON array. Never use generic names like 'Search Results'.",
        maxTokens: 2048,
        temperature: 0.2,
      });

      const cleaned = structured.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name && parsed[0].name !== "Search Results") {
        results = parsed;
      }
    } catch (err) {
      console.error("Claude parse error:", err);
    }
  }

  if (!results) {
    return NextResponse.json({
      mode: "discover",
      mock: false,
      results: [],
      rawPreview: rawResult.slice(0, 800),
      error: "Could not extract individual targets from search results. Try a more specific query like a person's name or podcast name.",
    });
  }

  return NextResponse.json({
    mode: "discover",
    mock: false,
    results,
  });
}

// ─── Target research: build a deep dossier ───

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

  // ─── 10 parallel deep searches (each under 400 chars for Tavily) ───
  const n = targetName.slice(0, 60);
  const searches = await Promise.all([
    // 1. Bio + career
    searchPerplexity(`${n} biography career highlights achievements background`),
    // 2. Golf connection + American Century
    searchPerplexity(`${n} golf handicap American Century Championship celebrity golf`),
    // 3. Social media handles + follower counts
    searchPerplexity(`${n} Instagram handle Twitter X LinkedIn YouTube follower count`),
    // 4. Agent + management + booking email + phone
    searchPerplexity(`${n} talent agent manager agency name booking email contact`),
    // 5. Foundations, charities, causes (backdoor paths)
    searchPerplexity(`${n} foundation charity nonprofit board member causes philanthropy`),
    // 6. Recent news + activity (last 3 months)
    searchPerplexity(`${n} latest news appearances projects 2025 2026`),
    // 7. Interests outside golf (rapport builders)
    searchPerplexity(`${n} hobbies interests personal life passions outside work`),
    // 8. Brand deals + partnership history
    searchPerplexity(`${n} brand deals sponsorship partnerships endorsement history`),
    // 9. Phone + direct contact paths
    searchPerplexity(`${n} phone number personal website official site contact page`),
    // 10. Mutual connections + collaborations
    searchPerplexity(`${n} collaborations friends associates golf buddies mutual connections`),
  ]);

  const [bioRaw, golfRaw, socialRaw, agentRaw, charityRaw, activityRaw, interestsRaw, brandsRaw, directRaw, mutualRaw] = searches;

  // ─── Claude synthesis: deep dossier + structured contacts ───
  const synthesisPrompt = `You are building a DEEP research dossier for Brixton Marr, CEO of Performance Golf ($120M+ revenue, 800K golfers, Forbes #1 Golf Company).

He needs to get in front of ${targetName} for a potential partnership. Your job: extract EVERY actionable detail from the research below. Be SPECIFIC — real names, real emails, real handles, real phone numbers. Never fabricate, but if found, include them.

TARGET: ${targetName} (type: ${targetType})

=== RAW RESEARCH DATA ===

BIO & CAREER:
${bioRaw}

GOLF CONNECTION & AMERICAN CENTURY:
${golfRaw}

SOCIAL MEDIA HANDLES & FOLLOWERS:
${socialRaw}

AGENT / MANAGEMENT / BOOKING:
${agentRaw}

FOUNDATIONS / CHARITIES / CAUSES:
${charityRaw}

RECENT ACTIVITY (2025-2026):
${activityRaw}

INTERESTS & PERSONAL:
${interestsRaw}

BRAND DEALS & PARTNERSHIP HISTORY:
${brandsRaw}

DIRECT CONTACT / PHONE / WEBSITE:
${directRaw}

MUTUAL CONNECTIONS / COLLABORATIONS:
${mutualRaw}

=== OUTPUT FORMAT ===

Return a JSON object. For any field where data isn't available, use "UNKNOWN — [what manual research is needed]". Include source URLs wherever possible.

{
  "bio": "3-4 sentence career bio with specific achievements, numbers, dates",
  "golfConnection": "Their SPECIFIC golf relationship — handicap if known, American Century appearances, golf course memberships, golf brand deals. If they don't play golf, say how they're adjacent",
  "reach": "SPECIFIC numbers: Instagram @handle (X followers), Twitter @handle (X followers), YouTube (X subs), TikTok, LinkedIn. Total estimated audience",
  "interests": "What they care about outside work — causes, charities, foundations, hobbies. These are rapport builders and backdoor paths",
  "bestApproach": "The recommended strategy to get in front of ${targetName}. Which of these 3-4 angles is strongest? What would make them actually respond? What should Brixton reference in the first message? Be specific and tactical",
  "contactIntel": "Summary: primary path (agent email), backup path (social DM), wildcard path (charity/mutual connection). One paragraph",
  "recentActivity": "What they've done in the last 3-6 months — appearances, posts, projects, deals. Reference dates if available",
  "partnershipAngle": "Why ${targetName} + Performance Golf makes sense. What's the value prop for THEM, not just PG?",
  "brandHistory": "Previous brand deals, sponsorships, endorsements. Competitive conflicts to flag",
  "riskFlags": ["list", "of", "concerns"],
  "sources": ["url1", "url2", "url3"],
  "contactPaths": [
    {
      "type": "direct",
      "name": "${targetName}",
      "role": "Target",
      "email": "personal/business email if found, or null",
      "phone": "phone if found, or null",
      "channel": "best direct channel (instagram/linkedin/email/phone)",
      "handle": "@handle if applicable",
      "confidence": "high/medium/low",
      "source_url": "where this info was found",
      "notes": "any context — e.g. 'responds to DMs', 'verified account'"
    },
    {
      "type": "agent",
      "name": "Agent's ACTUAL NAME (not just 'their agent')",
      "role": "Title at Agency Name",
      "email": "agent's email if found",
      "phone": "agent's phone if found",
      "channel": "email",
      "handle": null,
      "confidence": "high/medium/low",
      "source_url": "where this was found (NFLPA registry, agency website, etc.)",
      "notes": "e.g. 'handles brand partnerships', 'primary booking contact'"
    },
    {
      "type": "wildcard",
      "name": "Name of person/org that's a backdoor path",
      "role": "Their relationship — e.g. 'Foundation director', 'Golf buddy', 'Podcast they appeared on'",
      "email": null,
      "phone": null,
      "channel": "the channel/context for this path",
      "handle": null,
      "confidence": "low/medium",
      "source_url": null,
      "notes": "WHY this is a viable path — e.g. 'They co-hosted a charity tournament in 2025'"
    }
  ]
}

CRITICAL RULES:
- Include ALL 3 contact path types even if confidence is low
- NEVER fabricate contacts — if not found, set to null and explain in notes
- Cite sources for every claim
- Be brutally specific — "CAA" is not enough, we need "John Smith at CAA, john.smith@caa.com"
- For social handles, always include the @ symbol
- The "bestApproach" field is the MOST IMPORTANT — this is what Brixton reads first

Return ONLY valid JSON, no markdown, no code fences.`;

  let dossier;
  try {
    const synthesized = await askClaude(synthesisPrompt, {
      system: "You are a world-class research analyst for celebrity/athlete networking. You extract actionable intelligence from raw search data. Be specific, cite sources, never fabricate.",
      maxTokens: 4096,
      temperature: 0.2,
    });

    const cleaned = synthesized.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    dossier = JSON.parse(cleaned);
  } catch (err) {
    console.error("Claude synthesis error:", err);
    dossier = {
      bio: bioRaw.slice(0, 400),
      golfConnection: golfRaw.slice(0, 300),
      reach: socialRaw.slice(0, 300),
      interests: interestsRaw.slice(0, 300),
      bestApproach: "Could not synthesize — review raw research below.",
      contactIntel: `Agent: ${agentRaw.slice(0, 200)} | Direct: ${directRaw.slice(0, 200)}`,
      recentActivity: activityRaw.slice(0, 300),
      partnershipAngle: "Could not synthesize — review raw research.",
      brandHistory: brandsRaw.slice(0, 300),
      riskFlags: [],
      sources: [],
      contactPaths: [],
    };
  }

  // ─── Save to database ───
  const researchFields = [
    { field: "bio", value: dossier.bio || "" },
    { field: "golf_connection", value: dossier.golfConnection || "" },
    { field: "reach", value: dossier.reach || "" },
    { field: "interests", value: dossier.interests || "" },
    { field: "best_approach", value: dossier.bestApproach || "" },
    { field: "contact_intel", value: dossier.contactIntel || "" },
    { field: "recent_activity", value: dossier.recentActivity || "" },
    { field: "partnership_angle", value: dossier.partnershipAngle || "" },
    { field: "brand_history", value: dossier.brandHistory || "" },
    {
      field: "risk_flags",
      value: Array.isArray(dossier.riskFlags) ? dossier.riskFlags.join("; ") : dossier.riskFlags || "",
    },
    {
      field: "sources",
      value: Array.isArray(dossier.sources) ? dossier.sources.join("\n") : "",
    },
  ];

  if (isDbConfigured()) {
    await saveResearchRows(targetId, researchFields);

    // Save structured contact paths
    if (Array.isArray(dossier.contactPaths) && dossier.contactPaths.length > 0) {
      await deleteContactPaths(targetId);
      const paths: Omit<ContactPath, "id" | "target_id">[] = dossier.contactPaths.map(
        (cp: Record<string, unknown>) => ({
          type: (cp.type as string) || "direct",
          name: (cp.name as string) || "Unknown",
          role: (cp.role as string) || "",
          email: (cp.email as string) || null,
          channel: (cp.channel as string) || "",
          confidence: ((cp.confidence as string) || "low") as "high" | "medium" | "low",
          source_url: (cp.source_url as string) || null,
        })
      );
      await insertContactPaths(targetId, paths);
    }

    await updateTarget(targetId, { status: "researched" } as Partial<import("@/lib/db").Target>);
  }

  return NextResponse.json({
    mode: "research",
    mock: false,
    dossier,
    researchFields,
    contactPaths: dossier.contactPaths || [],
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
