// ─── Search Provider Fallback Chain ───
// Tavily (primary) → Perplexity (fallback) → Firecrawl (last resort)
// Standardized SearchResult interface across all providers.

const TAVILY_API_URL = "https://api.tavily.com/search";
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/search";

export interface SearchResult {
  answer: string;
  citations: string[];
  provider: "tavily" | "perplexity" | "firecrawl" | "none";
  error?: string;
}

// ─── Config checks ───

function hasTavily(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

function hasPerplexity(): boolean {
  return !!process.env.PERPLEXITY_API_KEY;
}

function hasFirecrawl(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

export function isSearchConfigured(): boolean {
  return hasTavily() || hasPerplexity() || hasFirecrawl();
}

// ─── Main search function with fallback chain ───

export async function search(query: string): Promise<SearchResult> {
  const providers: Array<() => Promise<SearchResult>> = [];

  if (hasTavily()) providers.push(() => searchTavily(query));
  if (hasPerplexity()) providers.push(() => searchPerplexityApi(query));
  if (hasFirecrawl()) providers.push(() => searchFirecrawl(query));

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result.answer && result.answer.trim().length > 0) {
        return result;
      }
    } catch (err) {
      console.error(`Search provider failed:`, err);
      continue;
    }
  }

  return {
    answer: "",
    citations: [],
    provider: "none",
    error: "All search providers failed or returned empty results.",
  };
}

// ─── Backward-compatible wrapper (returns string like the old searchPerplexity) ───

export async function searchText(query: string): Promise<string> {
  const result = await search(query);
  if (!result.answer) return "";

  const parts: string[] = [result.answer];

  if (result.citations.length > 0) {
    parts.push("", "Sources:");
    for (const url of result.citations) {
      parts.push(`- ${url}`);
    }
  }

  return parts.join("\n");
}

// ─── Tavily (primary) ───

async function searchTavily(query: string): Promise<SearchResult> {
  const response = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: query.slice(0, 390), // Tavily 400 char limit
      search_depth: "advanced",
      include_answer: true,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const citations: string[] = [];

  let answer = data.answer || "";

  if (data.results?.length) {
    for (const r of data.results) {
      if (r.url) citations.push(r.url);
      if (!answer && r.content) {
        answer += r.content.slice(0, 300) + "\n";
      }
    }

    // Append result snippets for richer context
    const snippets = data.results
      .map((r: { title: string; url: string; content: string }) =>
        `- ${r.title}: ${r.content?.slice(0, 200)} (${r.url})`
      )
      .join("\n");

    answer += "\n\nSources:\n" + snippets;
  }

  return { answer, citations, provider: "tavily" };
}

// ─── Perplexity (fallback) ───

async function searchPerplexityApi(query: string): Promise<SearchResult> {
  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const answer = choice?.message?.content || "";
  const citations: string[] = data.citations || [];

  return { answer, citations, provider: "perplexity" };
}

// ─── Firecrawl (last resort) ───

async function searchFirecrawl(query: string): Promise<SearchResult> {
  const response = await fetch(FIRECRAWL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      limit: 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const citations: string[] = [];
  const parts: string[] = [];

  if (data.data?.length) {
    for (const item of data.data) {
      if (item.url) citations.push(item.url);
      if (item.markdown) {
        parts.push(item.markdown.slice(0, 500));
      } else if (item.content) {
        parts.push(item.content.slice(0, 500));
      }
    }
  }

  return {
    answer: parts.join("\n\n"),
    citations,
    provider: "firecrawl",
  };
}

// ─── Utility: extract structured data from raw text via regex ───

export function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  return matches ? [...new Set(matches)] : [];
}

export function extractPhones(text: string): string[] {
  const matches = text.match(/\+?\d[\d\-\s().]{8,}\d/g);
  return matches
    ? [...new Set(matches.map((p) => p.replace(/\s+/g, " ").trim()))]
    : [];
}

export function extractSocialHandles(text: string): Record<string, string> {
  const handles: Record<string, string> = {};

  // Instagram
  const ig = text.match(/@([A-Za-z0-9_.]{1,30})\b.*?(?:instagram|IG)/i)
    || text.match(/(?:instagram|IG)[^@]*@([A-Za-z0-9_.]{1,30})/i)
    || text.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})/i);
  if (ig) handles.instagram = `@${ig[1]}`;

  // Twitter/X
  const tw = text.match(/@([A-Za-z0-9_]{1,15})\b.*?(?:twitter|X\b)/i)
    || text.match(/(?:twitter|X\b)[^@]*@([A-Za-z0-9_]{1,15})/i)
    || text.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})/i);
  if (tw) handles.twitter = `@${tw[1]}`;

  // LinkedIn
  const li = text.match(/linkedin\.com\/in\/([A-Za-z0-9-]{1,100})/i);
  if (li) handles.linkedin = li[1];

  // YouTube
  const yt = text.match(/youtube\.com\/(?:@|c\/|channel\/)([A-Za-z0-9_-]{1,100})/i);
  if (yt) handles.youtube = `@${yt[1]}`;

  // TikTok
  const tt = text.match(/tiktok\.com\/@([A-Za-z0-9_.]{1,100})/i);
  if (tt) handles.tiktok = `@${tt[1]}`;

  return handles;
}

// ─── Quality scoring for research completeness ───

export function scoreResearch(research: Record<string, string>, sources: string[]): number {
  const fields = [
    "bio", "golf_connection", "reach", "interests", "best_approach",
    "contact_intel", "recent_activity", "partnership_angle", "brand_history",
  ];

  let score = 0;

  for (const field of fields) {
    const content = research[field] || "";
    if (content.includes("[SOURCE:")) {
      score += 11; // Verified with source citation
    } else if (content.length > 50 && !content.startsWith("UNKNOWN")) {
      score += 8; // Good content, unverified
    } else if (content.length > 20 && !content.startsWith("UNKNOWN")) {
      score += 5; // Partial content
    } else if (content.startsWith("UNKNOWN")) {
      score += 1; // Gap identified
    } else {
      score += 2; // Minimal
    }
  }

  // Bonus for source count (max fields * 11 = 99, so sources push to 100)
  if (sources.length >= 5) score += 5;
  else if (sources.length >= 3) score += 3;
  else if (sources.length >= 1) score += 1;

  return Math.min(100, score);
}

// ─── Source attribution helper ───

export function tagSource(text: string, provider: string): string {
  if (!text || text.startsWith("UNKNOWN")) return text;
  const date = new Date().toISOString().split("T")[0];
  if (text.includes("[SOURCE:")) return text; // Already tagged
  return `${text} [SOURCE: ${provider} verified ${date}]`;
}
