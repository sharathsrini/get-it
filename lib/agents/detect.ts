/**
 * Concept-detection agent (one page at a time).
 *
 * Used by both the legacy `/api/analyze-pdf` route and the new
 * server-side jobs runner in lib/jobs.ts. Returns the typed
 * DetectionResult — caller is responsible for locating anchors and
 * persisting the result.
 */

import { runJson } from "../ai";
import {
  detectionBatchSchema,
  type DetectionBatchResult,
  type DetectionResult,
} from "../schemas";

const SYSTEM = `You are Get It.'s visualizer concept-extraction agent.

GOAL
You receive the text of one OR MORE pages from a textbook-style PDF. Each page
is delimited by a line "===== PAGE_INDEX n =====". Treat every page on its own
merits and identify, per page, the concepts that would benefit MOST from a
visual aid sitting next to the reader.

For each concept choose ONE renderer:
  • "3d"      — physical objects with meaningful 3D structure
                (organs, molecules, cells, anatomical regions, buildings,
                mechanical parts).
  • "2d-anim" — physical processes, simulations, mechanisms in motion
                (inclined plane, pendulum, blood flow path, chemical reaction
                progress, projectile trajectory, spring oscillation).
  • "formula" — equations, derivations, mathematical statements that benefit
                from a step-by-step LaTeX walkthrough.
  • "graph"   — function plots, scatter, bar charts, distributions, time
                series.
  • "2d-text" — citations, named statutes, articles, court rulings, named
                papers/sources, definitions where the visualizer should show
                an authoritative quote or summary.

RULES
1. Pick AT MOST 4 concepts per page. Quality over quantity. Skip pages with
   no good visualization candidates — simply emit no concepts for them.
   Judge each page independently, exactly as if it were the only page given.
2. For EVERY concept, set "page" to the integer from the "===== PAGE_INDEX n
   =====" marker of the page the concept appears on.
3. Each concept's "anchor" MUST be a verbatim copy of the LAST 30–80
   characters of the sentence that introduces it, taken EXACTLY from THAT
   page's text (no paraphrase). The tag pill will be planted right after
   this anchor — so the anchor string MUST appear once on its page, and the
   renderer anchors at its tail. Pick anchors that are unique on the page.
4. LANGUAGE: detect the language of each page's text and write BOTH "label"
   and "context" in that same language so they read naturally next to the
   source. Italian page → Italian outputs, English page → English outputs,
   etc. Never translate the source.
5. "label" is what shows on the pill (≤ 35 chars). Make it a short noun
   phrase the reader would skim and instantly recognise.
6. "context" gives the visualizer everything it needs to render the concept
   without re-reading the full page: include the concept name, key
   parameters mentioned in the text, and the field of study. 1–3 sentences.
7. Avoid trivial picks (page numbers, headings, generic phrases). Avoid
   duplicates of the same concept across a page.

OUTPUT
A single JSON object conforming to the supplied schema. No prose.`;

/**
 * Detect concepts across a small batch of pages in ONE Codex call. Each page
 * is delimited by a PAGE_INDEX marker the agent echoes back per concept, so a
 * 5-page batch costs one call instead of five while keeping per-page quality
 * (the agent is told to judge each page independently). The constant SYSTEM
 * prefix is reused across batches → prompt-cache hit on every call after the
 * first.
 */
export async function detectConceptsForPages(
  pages: Array<{ pageIndex: number; text: string }>,
  signal?: AbortSignal,
): Promise<DetectionBatchResult> {
  const body = pages
    .map((p) => `===== PAGE_INDEX ${p.pageIndex} =====\n${p.text}`)
    .join("\n\n");
  const prompt = `${SYSTEM}\n\n--- PAGES ---\n${body}\n--- END PAGES ---`;
  const { data } = await runJson<DetectionBatchResult>(prompt, detectionBatchSchema, {
    reasoning: "low",
    signal,
  });
  return data;
}

/**
 * Single-page detection — thin wrapper over the batch path that strips the
 * `page` field, preserving the original DetectionResult shape for the legacy
 * /api/analyze-pdf route.
 */
export async function detectConceptsForPage(
  pageIndex: number,
  pageText: string,
  signal?: AbortSignal,
): Promise<DetectionResult> {
  const { concepts } = await detectConceptsForPages(
    [{ pageIndex, text: pageText }],
    signal,
  );
  return {
    concepts: concepts.map(({ page: _page, ...rest }) => rest),
  };
}
