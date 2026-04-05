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
import {
  search,
  searchText,
  isSearchConfigured,
  extractEmails,
  extractPhones,
  extractSocialHandles,
  scoreResearch,
  tagSource,
} from "@/lib/search-providers";
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

    // Compute quality score
    const fieldMap: Record<string, string> = {};
    data.forEach((f) => { fieldMap[f.field] = f.value; });
    const sources = (fieldMap.sources || "").split("\n").filter(Boolean);
    const quality = scoreResearch(fieldMap, sources);

    return NextResponse.json({ fields: data, contactPaths, quality });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Discovery mock ───

function mockDiscoveryResults() {
  return {
    mode: "discover",
    mock: true,
    note: "API keys not fully configured. Showing mock results.",
    results: [
      { name: "Tiger Woods", description: "Golf legend with massive brand reach.", relevance: "high", golfConnection: "Professional golfer, 15x major champion", estimatedReach: "50M+" },
      { name: "Rick Shiels", description: "YouTube golf creator with equipment reviews.", relevance: "high", golfConnection: "Golf content creator, PGA professional", estimatedReach: "3.8M subscribers" },
      { name: "Barstool Fore Play", description: "Top golf podcast from Barstool Sports.", relevance: "high", golfConnection: "Dedicated golf podcast", estimatedReach: "500K+ listeners" },
    ],
  };
}

// ─── Research mock ───

function mockResearchDossier(targetName: string) {
  return {
    mode: "research", mock: true,
    note: "API keys not fully configured.",
    dossier: {
      bio: `${targetName} — configure API keys for real research.`,
      golfConnection: "UNKNOWN — needs API keys", reach: "UNKNOWN — needs API keys",
      interests: "UNKNOWN — needs API keys", bestApproach: "UNKNOWN — needs API keys",
      contactIntel: "UNKNOWN — needs API keys", recentActivity: "UNKNOWN — needs API keys",
      partnershipAngle: "UNKNOWN — needs API keys", brandHistory: "UNKNOWN — needs API keys",
      riskFlags: [], sources: [], contactPaths: [],
    },
    researchFields: [
      { field: "bio", value: `Configure API keys for ${targetName}.` },
    ],
    contactPaths: [], quality: 0,
  };
}

// ─── POST handler ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targetId, query } = body;

    if (query && !targetId) return handleDiscovery(query);
    if (targetId) return handleTargetResearch(targetId);

    return NextResponse.json(
      { error: "Provide either 'query' (discovery) or 'targetId' (research)" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Discovery ───

async function handleDiscovery(query: string) {
  if (!isSearchConfigured()) {
    return NextResponse.json(mockDiscoveryResults());
  }

  const result = await search(`${query} golf partnership brand`.slice(0, 390));

  if (!result.answer) {
    return NextResponse.json(
      { error: result.error || "Search returned empty results. Try a different query.", mode: "discover", results: [] },
      { status: 502 }
    );
  }

  const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;
  let results;

  if (hasClaudeKey) {
    try {
      const structured = await askClaude(
        `Extract 3-5 SPECIFIC, NAMED individuals, podcasts, or brands from these search results for a golf networking CRM.\n\nUser searched for: "${query}"\n\nRaw results:\n${result.answer}\n\nFor each: name (real name, NEVER "Search Results"), description (1-2 sentences), relevance ("high"/"medium"/"low"), golfConnection, estimatedReach.\n\nReturn ONLY a valid JSON array.`,
        { system: "Extract named entities. Return only JSON array. Never use generic names.", maxTokens: 2048, temperature: 0.2 }
      );
      const cleaned = structured.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name !== "Search Results") {
        results = parsed;
      }
    } catch (err) {
      console.error("Claude parse error:", err);
    }
  }

  if (!results) {
    return NextResponse.json({
      mode: "discover", mock: false, results: [],
      error: "Could not extract individual targets. Try a more specific query.",
    });
  }

  return NextResponse.json({ mode: "discover", mock: false, results });
}

// ─── Deep Target Research (10 searches + gap detection + re-query) ───

async function handleTargetResearch(targetId: string) {
  let targetName = "Unknown Target";
  let targetType = "celebrity";

  if (isDbConfigured()) {
    const target = await getTarget(targetId);
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    targetName = target.name;
    targetType = target.type;
  }

  if (!isSearchConfigured()) {
    const mock = mockResearchDossier(targetName);
    if (isDbConfigured()) {
      await saveResearchRows(targetId, mock.researchFields);
      await updateTarget(targetId, { status: "researched" } as Partial<import("@/lib/db").Target>);
    }
    return NextResponse.json(mock);
  }

  // ═══════════════════════════════════════════════
  // TIER 1: 10 parallel deep searches
  // ═══════════════════════════════════════════════
  const n = targetName.slice(0, 60);

  const tier1Results = await Promise.all([
    search(`${n} biography career highlights achievements background`),
    search(`${n} golf handicap American Century Championship celebrity golf tournament`),
    search(`${n} Instagram handle Twitter X LinkedIn YouTube follower count`),
    search(`${n} talent agent manager agency name booking email phone contact`),
    search(`${n} foundation charity nonprofit board member causes philanthropy`),
    search(`${n} latest news appearances projects 2025 2026`),
    search(`${n} hobbies interests personal life passions outside work`),
    search(`${n} brand deals sponsorship partnerships endorsement history`),
    search(`${n} phone number personal website official site contact page`),
    search(`${n} collaborations friends associates golf buddies mutual connections`),
  ]);

  const [bioRes, golfRes, socialRes, agentRes, charityRes, activityRes, interestsRes, brandsRes, directRes, mutualRes] = tier1Results;

  // Collect all citations across providers
  const allCitations = [...new Set(tier1Results.flatMap((r) => r.citations))];

  // Combine all raw text for regex extraction
  const allRawText = tier1Results.map((r) => r.answer).join("\n\n");

  // ═══════════════════════════════════════════════
  // REGEX EXTRACTION: emails, phones, social handles
  // ═══════════════════════════════════════════════
  const extractedEmails = extractEmails(allRawText);
  const extractedPhones = extractPhones(allRawText);
  const extractedHandles = extractSocialHandles(allRawText);

  // ═══════════════════════════════════════════════
  // TIER 1 SYNTHESIS: Claude builds initial dossier
  // ═══════════════════════════════════════════════
  const tier1Prompt = `You are a world-class research analyst for celebrity/athlete networking. Build a DEEP dossier for Brixton Marr, CEO of Performance Golf ($120M+ revenue, 800K golfers, Forbes #1 Golf Company).

TARGET: ${targetName} (type: ${targetType})

=== RAW RESEARCH (10 searches) ===
BIO: ${bioRes.answer}
GOLF + AMERICAN CENTURY: ${golfRes.answer}
SOCIAL MEDIA: ${socialRes.answer}
AGENT/MANAGEMENT: ${agentRes.answer}
FOUNDATIONS/CHARITIES: ${charityRes.answer}
RECENT ACTIVITY: ${activityRes.answer}
INTERESTS/PERSONAL: ${interestsRes.answer}
BRAND DEALS: ${brandsRes.answer}
DIRECT CONTACT: ${directRes.answer}
MUTUAL CONNECTIONS: ${mutualRes.answer}

=== PRE-EXTRACTED DATA (via regex — high confidence) ===
Emails found: ${extractedEmails.length > 0 ? extractedEmails.join(", ") : "None found"}
Phones found: ${extractedPhones.length > 0 ? extractedPhones.join(", ") : "None found"}
Social handles: ${Object.entries(extractedHandles).map(([k, v]) => `${k}: ${v}`).join(", ") || "None found"}

=== OUTPUT FORMAT ===
Return a JSON object. For any field where data isn't available, use "UNKNOWN — [what manual research is needed]". CITE SOURCES.

{
  "bio": "3-4 sentence career bio with specific achievements and numbers",
  "golfConnection": "SPECIFIC golf relationship — handicap, American Century appearances, golf club memberships, golf brand deals",
  "reach": "SPECIFIC: Instagram @handle (X followers), Twitter @handle (X followers), YouTube (X subs), LinkedIn. Total estimated audience",
  "interests": "What they care about — causes, charities, foundations, hobbies. These are rapport builders and backdoor paths in",
  "bestApproach": "The #1 recommended strategy to get in front of ${targetName}. Which angle is strongest? What should Brixton reference? Be specific and tactical — this is the MOST IMPORTANT field",
  "contactIntel": "Summary: primary path, backup path, wildcard path. Include specific names and emails",
  "recentActivity": "Last 3-6 months — appearances, posts, projects, deals with dates",
  "partnershipAngle": "Why ${targetName} + Performance Golf makes sense. Value prop for THEM",
  "brandHistory": "Previous brand deals, sponsorships. Competitive conflicts to flag",
  "riskFlags": ["concern1", "concern2"],
  "sources": ["url1", "url2"],
  "contactPaths": [
    {
      "type": "direct",
      "name": "${targetName}",
      "role": "Target",
      "email": "email if found or null",
      "phone": "phone if found or null",
      "channel": "best direct channel",
      "handle": "@handle or null",
      "confidence": "high/medium/low",
      "source_url": "url where found or null",
      "notes": "context"
    },
    {
      "type": "agent",
      "name": "Agent's FULL NAME (not just agency)",
      "role": "Title at Agency Name",
      "email": "agent email or null",
      "phone": "agent phone or null",
      "channel": "email",
      "handle": null,
      "confidence": "high/medium/low",
      "source_url": "NFLPA registry, agency site, etc.",
      "notes": "e.g. handles brand partnerships"
    },
    {
      "type": "wildcard",
      "name": "Person/org that's a backdoor path",
      "role": "Relationship description",
      "email": null,
      "phone": null,
      "channel": "context",
      "handle": null,
      "confidence": "low/medium",
      "source_url": null,
      "notes": "WHY this is viable"
    }
  ]
}

RULES: Include ALL 3 contact paths. Never fabricate — use null if not found. "CAA" alone is NOT enough — we need the specific agent's name. Return ONLY valid JSON.`;

  let dossier;
  try {
    const synthesized = await askClaude(tier1Prompt, {
      system: "You are a world-class research analyst. Extract actionable intelligence. Be specific, cite sources, never fabricate.",
      maxTokens: 4096,
      temperature: 0.2,
    });
    const cleaned = synthesized.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    dossier = JSON.parse(cleaned);
  } catch (err) {
    console.error("Tier 1 synthesis error:", err);
    dossier = buildFallbackDossier(targetName, tier1Results, extractedEmails, extractedPhones, extractedHandles);
  }

  // ═══════════════════════════════════════════════
  // TIER 2: Gap detection + targeted re-queries
  // ═══════════════════════════════════════════════
  const gaps: string[] = [];

  if (!dossier.contactPaths?.length || dossier.contactPaths.every((cp: Record<string, unknown>) => !cp.email && !cp.phone)) {
    gaps.push("agent");
  }
  if (!dossier.golfConnection || dossier.golfConnection.includes("UNKNOWN")) {
    gaps.push("golf");
  }
  if (!dossier.recentActivity || !dossier.recentActivity.includes("202")) {
    gaps.push("recent");
  }
  if (!dossier.interests || dossier.interests.includes("UNKNOWN")) {
    gaps.push("interests");
  }

  if (gaps.length > 0) {
    console.log(`Gap detection: filling ${gaps.length} gaps for ${targetName}: ${gaps.join(", ")}`);

    const gapQueries: Promise<{ gap: string; result: import("@/lib/search-providers").SearchResult }>[] = [];

    if (gaps.includes("agent")) {
      gapQueries.push(
        search(`"${n}" agent full name agency email phone booking representative brand partnerships`).then((r) => ({ gap: "agent", result: r }))
      );
    }
    if (gaps.includes("golf")) {
      gapQueries.push(
        search(`"${n}" golf handicap American Century Championship golf tournament history score`).then((r) => ({ gap: "golf", result: r }))
      );
    }
    if (gaps.includes("recent")) {
      gapQueries.push(
        search(`"${n}" news today this week April 2026 latest interview appearance`).then((r) => ({ gap: "recent", result: r }))
      );
    }
    if (gaps.includes("interests")) {
      gapQueries.push(
        search(`"${n}" charity foundation board member causes supports philanthropy interests hobbies`).then((r) => ({ gap: "interests", result: r }))
      );
    }

    const gapResults = await Promise.all(gapQueries);

    // Add gap citations
    for (const g of gapResults) {
      allCitations.push(...g.result.citations);
    }

    // Extract more emails/phones from gap results
    const gapRawText = gapResults.map((g) => g.result.answer).join("\n");
    const gapEmails = extractEmails(gapRawText);
    const gapPhones = extractPhones(gapRawText);
    extractedEmails.push(...gapEmails);
    extractedPhones.push(...gapPhones);

    // Re-synthesize gaps with Claude
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const gapContext = gapResults.map((g) => `${g.gap.toUpperCase()} (follow-up):\n${g.result.answer}`).join("\n\n");

        const gapPrompt = `You previously analyzed ${targetName}. Some fields had gaps. Here is additional research to fill them.

GAPS FOUND: ${gaps.join(", ")}

NEW RESEARCH:
${gapContext}

ADDITIONAL EXTRACTED DATA:
New emails: ${gapEmails.join(", ") || "None"}
New phones: ${gapPhones.join(", ") || "None"}

Current dossier (update only the gap fields, keep everything else):
${JSON.stringify(dossier, null, 2)}

Return the COMPLETE updated dossier as JSON. Only update fields that were UNKNOWN or incomplete. Keep all other fields unchanged. Return ONLY valid JSON.`;

        const gapSynthesized = await askClaude(gapPrompt, {
          system: "Update research gaps with new data. Return complete JSON dossier. Be specific with agent names and contact info.",
          maxTokens: 4096,
          temperature: 0.1,
        });
        const cleaned = gapSynthesized.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
        const updatedDossier = JSON.parse(cleaned);
        dossier = updatedDossier;
      } catch (err) {
        console.error("Gap synthesis error:", err);
        // Keep original dossier if gap fill fails
      }
    }
  }

  // ═══════════════════════════════════════════════
  // SOURCE ATTRIBUTION + QUALITY SCORING
  // ═══════════════════════════════════════════════

  // Determine primary provider used
  const providerUsed = tier1Results[0]?.provider || "search";

  // Build research fields with source attribution
  const researchFields = [
    { field: "bio", value: tagSource(dossier.bio || "", providerUsed) },
    { field: "golf_connection", value: tagSource(dossier.golfConnection || "", providerUsed) },
    { field: "reach", value: tagSource(dossier.reach || "", providerUsed) },
    { field: "interests", value: tagSource(dossier.interests || "", providerUsed) },
    { field: "best_approach", value: tagSource(dossier.bestApproach || "", providerUsed) },
    { field: "contact_intel", value: tagSource(dossier.contactIntel || "", providerUsed) },
    { field: "recent_activity", value: tagSource(dossier.recentActivity || "", providerUsed) },
    { field: "partnership_angle", value: tagSource(dossier.partnershipAngle || "", providerUsed) },
    { field: "brand_history", value: tagSource(dossier.brandHistory || "", providerUsed) },
    { field: "risk_flags", value: Array.isArray(dossier.riskFlags) ? dossier.riskFlags.join("; ") : dossier.riskFlags || "" },
    { field: "sources", value: [...new Set([...(dossier.sources || []), ...allCitations])].join("\n") },
  ];

  // Quality score
  const fieldMap: Record<string, string> = {};
  researchFields.forEach((f) => { fieldMap[f.field] = f.value; });
  const allSources = [...new Set([...(dossier.sources || []), ...allCitations])];
  const quality = scoreResearch(fieldMap, allSources);

  // ═══════════════════════════════════════════════
  // SAVE TO DATABASE
  // ═══════════════════════════════════════════════
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
    quality,
    gapsFilled: gaps,
    sourcesCount: allSources.length,
  });
}

// ─── Fallback dossier when Claude synthesis fails ───

function buildFallbackDossier(
  targetName: string,
  results: import("@/lib/search-providers").SearchResult[],
  emails: string[],
  phones: string[],
  handles: Record<string, string>
) {
  return {
    bio: results[0]?.answer?.slice(0, 400) || "Research failed",
    golfConnection: results[1]?.answer?.slice(0, 300) || "UNKNOWN — needs manual research",
    reach: results[2]?.answer?.slice(0, 300) || "UNKNOWN — needs manual research",
    interests: results[6]?.answer?.slice(0, 300) || "UNKNOWN — needs manual research",
    bestApproach: "Could not synthesize — review raw research data.",
    contactIntel: `Emails: ${emails.join(", ") || "none"}. Phones: ${phones.join(", ") || "none"}. Handles: ${Object.entries(handles).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}`,
    recentActivity: results[5]?.answer?.slice(0, 300) || "UNKNOWN — needs manual research",
    partnershipAngle: "Could not synthesize.",
    brandHistory: results[7]?.answer?.slice(0, 300) || "UNKNOWN — needs manual research",
    riskFlags: [],
    sources: results.flatMap((r) => r.citations).filter(Boolean).slice(0, 10),
    contactPaths: [{
      type: "direct", name: targetName, role: "Target",
      email: emails[0] || null, phone: phones[0] || null,
      channel: Object.keys(handles)[0] || "email",
      handle: Object.values(handles)[0] || null,
      confidence: "low", source_url: null, notes: "From regex extraction",
    }],
  };
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
