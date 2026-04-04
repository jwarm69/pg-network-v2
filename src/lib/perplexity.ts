const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const TAVILY_API_URL = "https://api.tavily.com/search";

function hasTavily(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

function hasPerplexity(): boolean {
  return !!process.env.PERPLEXITY_API_KEY;
}

export function isPerplexityConfigured(): boolean {
  return hasTavily() || hasPerplexity();
}

export async function searchPerplexity(query: string): Promise<string> {
  if (hasTavily()) {
    return searchTavily(query);
  }

  if (hasPerplexity()) {
    return searchPerplexityApi(query);
  }

  return `[Search API not configured] Mock result for query: "${query}". Configure TAVILY_API_KEY or PERPLEXITY_API_KEY in your environment to get real search results.`;
}

// ─── Tavily (primary) ───

async function searchTavily(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY!;

  const response = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_answer: true,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Tavily returns a direct answer + individual results
  const parts: string[] = [];

  if (data.answer) {
    parts.push(data.answer);
  }

  if (data.results?.length) {
    parts.push(
      "",
      "Sources:",
      ...data.results.map(
        (r: { title: string; url: string; content: string }) =>
          `- ${r.title}: ${r.content?.slice(0, 200)} (${r.url})`
      )
    );
  }

  return parts.join("\n") || "";
}

// ─── Perplexity (fallback) ───

async function searchPerplexityApi(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY!;

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  return choice?.message?.content || "";
}
