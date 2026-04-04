import { NextResponse } from "next/server";
import { classifyIntent, askClaude } from "@/lib/claude";
import {
  isDbConfigured,
  getTargets,
  updateTarget,
  saveCommandEntry,
  type Target,
} from "@/lib/db";
import { searchPerplexity } from "@/lib/perplexity";

// ─── Rate limiter (1 req/sec) ───

let lastRequestTime = 0;

// ─── Keyword-based fallback when Claude API key is missing ───

function classifyByKeyword(input: string): {
  intent: string;
  entities: Record<string, string>;
  confidence: number;
} {
  const lower = input.toLowerCase().trim();

  if (/^(status|pipeline|overview|dashboard|summary|how many|who.s overdue|overdue|response rate)/i.test(lower)) {
    return { intent: "STATUS_QUERY", entities: {}, confidence: 0.6 };
  }

  // "set <name> status to <value>" or "update <name> <field> <value>" or "mark <name> as <value>"
  const updateMatch = lower.match(
    /(?:set|update|change|mark)\s+(.+?)\s+(?:status|priority|type|channel)\s+(?:to|as)\s+(.+)/
  );
  if (updateMatch) {
    const fieldMatch = lower.match(/\b(status|priority|type|channel)\b/);
    return {
      intent: "UPDATE_FIELD",
      entities: {
        name: updateMatch[1].trim(),
        field: fieldMatch?.[1] || "status",
        value: updateMatch[2].trim(),
      },
      confidence: 0.6,
    };
  }

  const markMatch = lower.match(/(?:mark)\s+(.+?)\s+(?:as)\s+(.+)/);
  if (markMatch) {
    return {
      intent: "UPDATE_FIELD",
      entities: {
        name: markMatch[1].trim(),
        field: "status",
        value: markMatch[2].trim(),
      },
      confidence: 0.5,
    };
  }

  if (/^(research|look up|look into|find info|dig into)\b/.test(lower)) {
    const name = lower.replace(/^(research|look up|look into|find info|dig into)\s+/i, "").trim();
    return { intent: "RESEARCH_CMD", entities: { name }, confidence: 0.6 };
  }

  if (/^(message|draft|write|outreach|compose)\b/.test(lower)) {
    const name = lower.replace(/^(message|draft|write|outreach|compose)\s+(for|to)?\s*/i, "").trim();
    return { intent: "MESSAGE_CMD", entities: { name }, confidence: 0.6 };
  }

  if (/^(discover|find|search|who|suggest)\b/.test(lower) && /\b(golfer|podcast|celebrity|influencer|target|prospect|person)\b/.test(lower)) {
    return { intent: "DISCOVERY", entities: { query: input }, confidence: 0.5 };
  }

  return { intent: "GENERAL_CHAT", entities: {}, confidence: 0.3 };
}

// ─── Fuzzy name match ───

function fuzzyMatch(targets: Target[], name: string): Target | null {
  const lower = name.toLowerCase().trim();

  // Exact match
  const exact = targets.find((t) => t.name.toLowerCase() === lower);
  if (exact) return exact;

  // Includes match
  const includes = targets.find((t) => t.name.toLowerCase().includes(lower));
  if (includes) return includes;

  // Reverse includes
  const reverse = targets.find((t) => lower.includes(t.name.toLowerCase()));
  if (reverse) return reverse;

  // Word overlap scoring
  const inputWords = lower.split(/\s+/);
  let bestMatch: Target | null = null;
  let bestScore = 0;
  for (const t of targets) {
    const targetWords = t.name.toLowerCase().split(/\s+/);
    const overlap = inputWords.filter((w) => targetWords.some((tw) => tw.includes(w) || w.includes(tw))).length;
    const score = overlap / Math.max(inputWords.length, targetWords.length);
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = t;
    }
  }

  return bestMatch;
}

// ─── Pipeline status summary ───

async function buildStatusSummary(): Promise<string> {
  const targets = await getTargets();

  if (targets.length === 0) {
    return "Pipeline is empty. No targets added yet.";
  }

  // Count by status
  const statusCounts: Record<string, number> = {};
  for (const t of targets) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  // Count by priority
  const priorityCounts: Record<string, number> = {};
  for (const t of targets) {
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
  }

  // Overdue: targets not updated in 7+ days that aren't archived/completed
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const overdue = targets.filter(
    (t) =>
      !["completed", "archived"].includes(t.status) &&
      new Date(t.updated_at) < sevenDaysAgo
  );

  // Response rate: targets that have moved past "drafted" out of those that reached "drafted"
  const drafted = targets.filter((t) =>
    ["drafted", "deck_sent", "in_contact", "pending_intro", "meeting_set", "completed"].includes(t.status)
  );
  const responded = targets.filter((t) =>
    ["in_contact", "pending_intro", "meeting_set", "completed"].includes(t.status)
  );
  const responseRate = drafted.length > 0 ? Math.round((responded.length / drafted.length) * 100) : 0;

  const lines: string[] = [
    `Pipeline: ${targets.length} total targets`,
    "",
    "By status:",
    ...Object.entries(statusCounts).map(([s, c]) => `  ${s}: ${c}`),
    "",
    "By priority:",
    ...Object.entries(priorityCounts).map(([p, c]) => `  ${p}: ${c}`),
    "",
    `Overdue (no update in 7+ days): ${overdue.length}`,
  ];

  if (overdue.length > 0) {
    lines.push(...overdue.slice(0, 5).map((t) => `  - ${t.name} (${t.status})`));
    if (overdue.length > 5) lines.push(`  ... and ${overdue.length - 5} more`);
  }

  lines.push("", `Response rate: ${responseRate}% (${responded.length}/${drafted.length} past drafting)`);

  return lines.join("\n");
}

// ─── Main handler ───

export async function POST(request: Request) {
  // Rate limiting
  const now = Date.now();
  if (now - lastRequestTime < 1000) {
    return NextResponse.json(
      { error: "Rate limited. Please wait a moment.", response: "Too many requests. Try again in a second.", intent: "RATE_LIMITED", confidence: 1.0 },
      { status: 429 }
    );
  }
  lastRequestTime = now;

  let input: string;
  try {
    const body = await request.json();
    input = body.input;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!input || typeof input !== "string") {
    return NextResponse.json({ error: "No input provided" }, { status: 400 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({
      response: "Database is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your environment variables to enable full Command Center functionality.",
      intent: "ERROR",
      confidence: 1.0,
    });
  }

  // Classify intent
  let classification: { intent: string; entities: Record<string, string>; confidence: number };
  const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;

  try {
    if (hasClaudeKey) {
      classification = await classifyIntent(input);
    } else {
      classification = classifyByKeyword(input);
    }
  } catch {
    classification = classifyByKeyword(input);
  }

  const { intent, entities, confidence } = classification;
  let response = "";
  let action: Record<string, unknown> | undefined;

  try {
    switch (intent) {
      case "STATUS_QUERY": {
        response = await buildStatusSummary();
        break;
      }

      case "UPDATE_FIELD": {
        const targetName = entities.name || entities.target || "";
        const field = entities.field || "status";
        const value = entities.value || "";

        if (!targetName) {
          response = "Could not determine which target to update. Try: \"set [name] status to [value]\"";
          break;
        }
        if (!value) {
          response = `Could not determine the new value for ${field}. Try: "set ${targetName} ${field} to [value]"`;
          break;
        }

        const targets = await getTargets();
        const match = fuzzyMatch(targets, targetName);

        if (!match) {
          response = `No target found matching "${targetName}". Available targets: ${targets.slice(0, 5).map((t) => t.name).join(", ")}${targets.length > 5 ? ` (and ${targets.length - 5} more)` : ""}`;
          break;
        }

        const oldValue = (match as unknown as Record<string, unknown>)[field];
        const updated = await updateTarget(match.id, { [field]: value } as Partial<Target>);
        response = `Updated ${updated.name}: ${field} changed from "${oldValue}" to "${value}"`;
        action = {
          type: "UPDATE_FIELD",
          targetId: match.id,
          field,
          oldValue: String(oldValue ?? ""),
          newValue: value,
        };
        break;
      }

      case "RESEARCH_CMD": {
        const name = entities.name || entities.target || input.replace(/^(research|look up|look into|find info|dig into)\s+/i, "").trim();

        // Actually trigger discovery search
        const researchQuery = `${name} golf partnership brand`;
        let discoveryResults = null;

        try {
          const { searchPerplexity: search, isPerplexityConfigured } = await import("@/lib/perplexity");
          if (isPerplexityConfigured()) {
            const rawResult = await search(researchQuery.slice(0, 390));
            if (rawResult && rawResult.trim().length > 0) {
              // Try to structure with Claude
              const hasKey = !!process.env.ANTHROPIC_API_KEY;
              if (hasKey) {
                try {
                  const structurePrompt = `Parse the following search results about "${name}" into a JSON array. Each item should have: name (string), description (string), relevance ("high"|"medium"|"low"), golfConnection (string), estimatedReach (string).

Search results:
${rawResult}

Return ONLY valid JSON array, no other text.`;
                  const structured = await askClaude(structurePrompt, {
                    system: "You are a JSON parser. Return only valid JSON arrays.",
                    maxTokens: 1024,
                    temperature: 0,
                  });
                  discoveryResults = JSON.parse(structured);
                } catch {
                  discoveryResults = null;
                }
              }

              if (!discoveryResults) {
                discoveryResults = [{
                  name: "Search Results",
                  description: rawResult.slice(0, 500),
                  relevance: "medium" as const,
                  golfConnection: "See description",
                  estimatedReach: "Unknown",
                }];
              }
            }
          }
        } catch {
          // Fall through to text-only response
        }

        if (discoveryResults && discoveryResults.length > 0) {
          const resultsSummary = discoveryResults
            .slice(0, 5)
            .map((r: { name: string; description: string; relevance: string }, i: number) =>
              `${i + 1}. ${r.name} (${r.relevance}) — ${r.description.slice(0, 100)}`
            )
            .join("\n");
          response = `Found ${discoveryResults.length} result(s) for "${name}":\n\n${resultsSummary}\n\nResults have been loaded into the Research Hub. Switch to the Research tab to add targets to your pipeline.`;
          action = { type: "RESEARCH_CMD", target: name, discoveryResults };
        } else {
          response = `Searched for "${name}" but no structured results found. Try searching directly in the Research Hub search bar.`;
          action = { type: "RESEARCH_CMD", target: name };
        }
        break;
      }

      case "MESSAGE_CMD": {
        const name = entities.name || entities.target || input.replace(/^(message|draft|write|outreach|compose)\s+(for|to)?\s*/i, "").trim();
        response = `Outreach generation will be triggered for "${name}". Check the Outreach panel for drafted messages.`;
        action = { type: "MESSAGE_CMD", target: name };
        break;
      }

      case "DISCOVERY": {
        const query = entities.query || input;
        const searchQuery = `Find golf influencers, celebrities, or podcast hosts matching: ${query}. Include their name, relevance to golf, social following, and why they'd be a good networking target for a golf technology company.`;

        const results = await searchPerplexity(searchQuery);
        response = results || "No discovery results found. Try a more specific query.";
        action = { type: "DISCOVERY", query };
        break;
      }

      case "GENERAL_CHAT":
      default: {
        // Check if this looks like a research/discovery query the keyword classifier missed
        const lower = input.toLowerCase();
        const looksLikeResearch = /\b(research|find|search|discover|look up|who are|golfers?|players?|committed|recruits?|prospects?)\b/.test(lower) &&
          lower.length > 10;

        if (looksLikeResearch) {
          // Re-route to research handler
          let discoveryResults = null;
          try {
            const searchQuery = `${input} golf partnership brand`.slice(0, 390);
            const rawResult = await searchPerplexity(searchQuery);
            if (rawResult && rawResult.trim().length > 0) {
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
                  discoveryResults = JSON.parse(structured);
                } catch {
                  discoveryResults = null;
                }
              }
              if (!discoveryResults) {
                discoveryResults = [{
                  name: "Search Results",
                  description: rawResult.slice(0, 500),
                  relevance: "medium" as const,
                  golfConnection: "See description",
                  estimatedReach: "Unknown",
                }];
              }
            }
          } catch {
            // Fall through to chat
          }

          if (discoveryResults && discoveryResults.length > 0) {
            const resultsSummary = discoveryResults
              .slice(0, 5)
              .map((r: { name: string; description: string; relevance: string }, i: number) =>
                `${i + 1}. ${r.name} (${r.relevance}) — ${r.description.slice(0, 100)}`
              )
              .join("\n");
            response = `Found ${discoveryResults.length} result(s):\n\n${resultsSummary}\n\nResults loaded into Research Hub — switch to the Research tab to add targets to your pipeline.`;
            action = { type: "RESEARCH_CMD", target: input, discoveryResults };
            break;
          }
        }

        if (hasClaudeKey) {
          // Build context with pipeline state
          let pipelineContext = "";
          try {
            const targets = await getTargets();
            const statusCounts: Record<string, number> = {};
            for (const t of targets) {
              statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
            }
            pipelineContext = `\n\nCurrent pipeline: ${targets.length} total targets. ${Object.entries(statusCounts).map(([s, c]) => `${s}: ${c}`).join(", ")}.`;
            if (targets.length > 0) {
              pipelineContext += `\nRecent targets: ${targets.slice(0, 10).map((t) => `${t.name} (${t.status}, ${t.priority})`).join("; ")}`;
            }
          } catch {
            pipelineContext = "\n\n(Pipeline data unavailable)";
          }

          const system = `You are the AI assistant for PG Network, a networking CRM for Performance Golf. You help manage a pipeline of celebrity, podcast, and organic networking targets for Brixton, the CEO.

You can answer questions about the pipeline, suggest strategies, and help with networking outreach.${pipelineContext}

IMPORTANT: Keep responses SHORT and actionable (2-4 sentences max). Do NOT write long lists or suggestions — just tell the user what actions you're taking or what they should do next. If the query involves finding people or research, say you'll search for them. Use plain text, not markdown.`;

          response = await askClaude(input, { system, maxTokens: 300, temperature: 0.7 });
        } else {
          response = `I understood your message but the AI assistant isn't configured yet. Set ANTHROPIC_API_KEY to enable conversational responses.\n\nTip: Try commands like "status", "research [name]", "set [name] status to [value]", or "discover golf podcasts".`;
        }
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response = `Error processing command: ${message}`;
  }

  // Save to command history (fire and forget)
  saveCommandEntry(input, response, intent).catch(() => {});

  return NextResponse.json({
    response,
    intent,
    confidence,
    action,
  });
}
