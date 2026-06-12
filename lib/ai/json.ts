/**
 * Shared JSON-from-LLM parsing.
 *
 * Both the Codex and Claude providers ask the model for a single JSON object
 * conforming to an output schema. Models occasionally wrap that object in a
 * markdown code fence (```json … ```), so we strip a leading/trailing fence
 * before parsing. Kept provider-agnostic and side-effect-free so it stays
 * trivially unit-testable.
 */

/** Strip markdown code fences the model sometimes wraps JSON in, then parse. */
export function parseModelJson<T>(finalResponse: string | undefined): T {
  const text = finalResponse?.trim();
  if (!text) throw new Error("Empty response from model");
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
