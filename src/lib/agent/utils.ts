/**
 * Parse JSON from Claude responses, handling markdown code fences.
 * Claude sometimes wraps JSON in ```json ... ``` blocks.
 */
export function parseClaudeJson<T = unknown>(raw: string): T {
  let cleaned = raw.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Strip leading/trailing text that isn't JSON
  const jsonStart = cleaned.indexOf("{");
  const jsonArrayStart = cleaned.indexOf("[");
  const start = jsonStart >= 0 && jsonArrayStart >= 0
    ? Math.min(jsonStart, jsonArrayStart)
    : jsonStart >= 0 ? jsonStart : jsonArrayStart;

  if (start > 0) cleaned = cleaned.slice(start);

  return JSON.parse(cleaned);
}
