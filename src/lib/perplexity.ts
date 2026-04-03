const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export function isPerplexityConfigured(): boolean {
  return !!process.env.PERPLEXITY_API_KEY;
}

export async function searchPerplexity(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    return `[Perplexity API key not configured] Mock result for query: "${query}". Configure PERPLEXITY_API_KEY in your environment to get real search results.`;
  }

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "user",
          content: query,
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (choice?.message?.content) {
    return choice.message.content;
  }

  return "";
}
