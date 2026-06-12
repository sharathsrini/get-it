/**
 * Server-side runners for the knowledge-graph agents.
 *
 * - buildKG(docId): one-shot creation of the concept graph from the PDF text.
 *   Idempotent — if a non-error KG already exists, returns it without
 *   touching codex.
 * - scheduleEvaluation(docId): debounced re-scoring of the existing graph
 *   based on the latest work context. Per-doc queue — at most one eval in
 *   flight, at most one pending after that — so chatty tools don't pile up
 *   redundant codex calls.
 *
 * Both runners are fire-and-forget from the caller's perspective; state is
 * committed to disk so the client polls /api/kg/[docId]/state to observe.
 */

import { runJson } from "./ai";
import { getDoc } from "./store";
import {
  emptyKG,
  loadKG,
  saveKG,
  type KGEvaluation,
  type KGNode,
  type KnowledgeGraph,
} from "./kg";
import {
  kgBuildSchema,
  kgEvaluateSchema,
  type KGBuildResult,
  type KGEvaluateResult,
} from "./schemas-kg";
import {
  loadWorkContext,
  summariseForEvaluator,
  hasInteractionsSince,
} from "./work-context";

// ── Build prompt ──────────────────────────────────────────────────────

const BUILD_SYSTEM = `You are Get It.'s knowledge-graph architect.

GOAL
You receive the full text of a textbook-style PDF. Build the BEST possible
concept graph for a learner working through this material.

NODES — each node is one CONCEPT. Pick:
  • the concepts a student would actually need to master (not minor asides)
  • a useful granularity: not so coarse that two distinct ideas share a node,
    not so fine that the graph turns into a glossary
  • 6–25 nodes is the typical sweet spot. Up to 30 only if the material
    genuinely demands it.
  • For each node provide: a stable lowercase-kebab id (\`circulatory-system\`),
    a short human label in the SOURCE LANGUAGE, a 1–2 sentence summary, and
    the page numbers (1-indexed) where the concept is treated.

EDGES — directed from source -> target — capture HOW concepts connect:
  • prerequisite ("you need X before Y" → Y depends on X, so source=X, target=Y)
  • composition / part-of
  • causal ("X causes Y")
  • specialisation ("X is a kind of Y")
  • parallel / contrast (use sparingly)
  Use the "relation" field to phrase the link in one short clause, in the
  source language. Skip trivial or duplicate edges.

GLOBAL NOTE — one short paragraph the student will read first: what this
document is about, what the spine of the learning path is, and where the
hardest / most central concepts are. SOURCE LANGUAGE.

LANGUAGE: detect the source language and write every label, summary,
relation, and the global note in that language. ids stay lowercase-kebab
(ASCII).

Return ONE JSON object matching the schema. No prose.`;

function buildPrompt(filename: string, pageBlobs: string[]): string {
  const text = pageBlobs.join("\n\n");
  // Stable instruction prefix first, variable document body last — keeps the
  // prompt prefix-cacheable and lets the model anchor on the rubric before it
  // reads the source.
  return `${BUILD_SYSTEM}

--- DOCUMENT (filename: ${filename}) ---
${text}
--- END DOCUMENT ---`;
}

/**
 * Pack every page in full — no per-page or total character cap. The upload
 * gate (MAX_PDF_PAGES) is what bounds document size now; truncating here would
 * mean the graph silently ignores later chapters, which is exactly the
 * long-document failure we're fixing. The whole text goes to the model so the
 * concept graph covers the document end to end.
 */
function packPages(pages: { pageIndex: number; text: string }[]): string[] {
  return pages
    .map((p) => `[page ${p.pageIndex + 1}]\n${p.text.trim()}`)
    .filter((blob) => blob.length > 0);
}

// ── Public: build ────────────────────────────────────────────────────

const buildInFlight = new Map<string, Promise<KnowledgeGraph>>();

export async function buildKG(docId: string): Promise<KnowledgeGraph> {
  // Reuse a result that's already on disk (idempotent at the API layer).
  const existing = loadKG(docId);
  if (existing && (existing.status === "ready" || existing.status === "building")) {
    if (existing.status === "ready") return existing;
  }
  const inFlight = buildInFlight.get(docId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const doc = getDoc(docId);
    if (!doc) throw new Error("doc not found");

    // Mark as building so the client UI can show a placeholder.
    const placeholder: KnowledgeGraph = {
      ...emptyKG(docId),
      status: "building",
    };
    saveKG(placeholder);

    try {
      const blobs = packPages(doc.extracted.pages);
      const prompt = buildPrompt(doc.filename, blobs);
      const { data } = await runJson<KGBuildResult>(prompt, kgBuildSchema, {
        reasoning: "medium",
      });

      // Drop edges referencing unknown ids — the model occasionally invents one.
      const ids = new Set(data.nodes.map((n) => n.id));
      const cleanEdges = data.edges.filter(
        (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
      );
      // Dedup by (source,target).
      const seen = new Set<string>();
      const dedupedEdges = cleanEdges.filter((e) => {
        const k = `${e.source}→${e.target}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const nodes: KGNode[] = data.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        summary: n.summary,
        pageHints: n.pageHints,
        evaluation: { memory: 0, comprehension: 0, structure: 0, application: 0 },
        evaluatorNote: "",
      }));

      const kg: KnowledgeGraph = {
        v: 1,
        docId,
        status: "ready",
        buildAt: Date.now(),
        lastEvaluatedAt: null,
        evaluationCount: 0,
        nodes,
        edges: dedupedEdges,
        globalNote: data.globalNote,
      };
      saveKG(kg);
      return kg;
    } catch (e) {
      // Any failure — an account-level Codex error (rate-limit / auth / binary
      // / unsupported model) or a one-off — moves the graph to an `error`
      // state carrying the reason, so the KG view drops its spinner and shows
      // its Retry button. We never auto-retry: the user rebuilds on demand and
      // the health banner explains an account-level failure in the meantime.
      const errored: KnowledgeGraph = {
        ...placeholder,
        status: "error",
        buildError: (e as Error).message,
      };
      saveKG(errored);
      throw e;
    }
  })();

  buildInFlight.set(docId, promise);
  promise.finally(() => {
    buildInFlight.delete(docId);
  });
  return promise;
}

// ── Evaluation ────────────────────────────────────────────────────────

const EVALUATE_SYSTEM = `You are Get It.'s evaluator agent. You score how
well a student has mastered each concept in a knowledge graph based on
their actual interactions with four learning tools (chat, flashcards,
quizzes, Feynman).

You must score, per concept, four 0–100 parameters:

  MEMORY — does the student RECALL the concept?
    • Use flashcard self-ratings (1=again, 4=easy), quiz correctness on
      definitional / fact-recall questions, recall in chat, references
      across days. Recall over time > recall in the moment.

  COMPREHENSION — does the student understand it in their OWN WORDS?
    • Look at chat paraphrases, Feynman explanations. Verbatim repetition
      of the source = low. Original metaphors / lay-language re-explanations
      that match the substance = high. The Feynman "explain it to a child"
      step is the strongest signal here. A correct quiz answer where the
      student would have been fooled by a plausible distractor is also a
      comprehension signal — it shows they can tell siblings apart, not
      just recognise the right word.

  STRUCTURE — does the student grasp how this concept CONNECTS to others?
    • Look for cause-effect chains, references to prerequisites, comparisons
      with sibling concepts. Isolated factoids = low. Multi-step reasoning
      that bridges concepts = high. Quizzes that pit a concept against its
      sibling and the student picks the right one are mild structure
      evidence.

  APPLICATION — does the student TRANSFER the concept to new cases?
    • Look for original examples, edge cases the student invented, problem
      solving on novel scenarios. Solving textbook-clone problems alone =
      moderate. Spontaneously generating new cases = high. Quiz questions
      that pose a fresh scenario (not a definition) and the student answers
      correctly are real application evidence.

HOW THE INPUT IS FRAMED
You are given each concept's CURRENT four scores (the baseline, in parens) and
ONLY the interactions that happened SINCE the last evaluation. The baseline
already encodes everything the student proved earlier, so you never need the
older transcript — just decide, from the new evidence, where a score should
rise. Treat the current scores as the floor.

CRITICAL RULES
1. Scores are MONOTONE NON-DECREASING across evaluations — a student can
   only progress, never regress. Engine-side we will clamp any decrease,
   so your job is to NEVER decrease, only raise scores when there is fresh
   evidence. A concept with no new evidence keeps its current score.
2. Be RIGOROUS. Quantity of interactions does NOT entitle a high score —
   only quality of evidence does. A student who has done 50 flashcards but
   rates them all "again", or who has scored 1/8 on every quiz, should sit
   very low on memory; a student who has given a single brilliant Feynman
   explanation can earn a strong jump on comprehension for that concept.
3. Only emit updates for concepts that have observable evidence in the
   work context. Concepts with no evidence are silently kept at 0 / their
   previous level.
4. evaluatorNote per concept: one or two short sentences in the source
   language saying what to focus on next for this concept. Empty if
   nothing to add yet.
5. globalNote: one paragraph in the source language summarising overall
   state and the single most leveraged next move (e.g. "Reinforce the
   structure dimension on X — comprehension is solid but you haven't
   connected it to Y yet").

OUTPUT
Single JSON object matching the schema. No prose.`;

function evaluatePrompt(kg: KnowledgeGraph, workCtxText: string): string {
  const kgSummary = kg.nodes
    .map(
      (n) =>
        `- ${n.id} :: ${n.label} (M${n.evaluation.memory} C${n.evaluation.comprehension} S${n.evaluation.structure} A${n.evaluation.application})\n  ${n.summary}`,
    )
    .join("\n");
  const edgesSummary =
    kg.edges
      .slice(0, 80)
      .map((e) => `${e.source} -[${e.relation}]-> ${e.target}`)
      .join("\n") || "(no edges)";
  return `${EVALUATE_SYSTEM}

--- KNOWLEDGE GRAPH (current scores in parens) ---
${kgSummary}

EDGES:
${edgesSummary}

GLOBAL NOTE (previous): ${kg.globalNote}

--- NEW INTERACTIONS SINCE LAST EVALUATION (chronological) ---
${workCtxText}
--- END NEW INTERACTIONS ---

Score now. Only emit nodes with new evidence. Never decrease.`;
}

function clampMonotone(prev: KGEvaluation, next: KGEvaluation): KGEvaluation {
  return {
    memory: Math.max(prev.memory, Math.min(100, Math.max(0, Math.round(next.memory)))),
    comprehension: Math.max(prev.comprehension, Math.min(100, Math.max(0, Math.round(next.comprehension)))),
    structure: Math.max(prev.structure, Math.min(100, Math.max(0, Math.round(next.structure)))),
    application: Math.max(prev.application, Math.min(100, Math.max(0, Math.round(next.application)))),
  };
}

const evalInFlight = new Map<string, Promise<void>>();
const evalPending = new Map<string, boolean>();

/** Whether an evaluation pass is currently running for this doc. Used by
 *  the state route so the client can render a live "evaluating" indicator
 *  without polling a separate endpoint. */
export function isEvaluating(docId: string): boolean {
  return evalInFlight.has(docId);
}

/**
 * Schedule an evaluation pass for a doc. Coalesces back-to-back calls into
 * at most one in-flight + one pending so a chatty tool can't queue dozens
 * of redundant codex turns.
 */
export function scheduleEvaluation(docId: string): void {
  if (evalInFlight.has(docId)) {
    evalPending.set(docId, true);
    return;
  }
  const run = (async () => {
    try {
      await runEvaluation(docId);
    } catch (e) {
      // Evaluation is best-effort background scoring. On any error (including
      // an account-level Codex error) we stop — no auto-retry. The next
      // genuine tool interaction schedules a fresh pass, and the health banner
      // explains an account-level failure in the meantime.
      console.warn("[kg-eval]", docId, (e as Error).message);
    } finally {
      evalInFlight.delete(docId);
      // Re-run only if a *new* interaction asked for one while we were busy.
      if (evalPending.get(docId)) {
        evalPending.delete(docId);
        scheduleEvaluation(docId);
      }
    }
  })();
  evalInFlight.set(docId, run);
}

async function runEvaluation(docId: string): Promise<void> {
  const kg = loadKG(docId);
  if (!kg || kg.status !== "ready") return;
  const workCtx = loadWorkContext(docId);

  // Only the interactions since the last pass matter — the baseline scores
  // carry everything earlier. If nothing is new, don't spend a Codex call.
  const sinceTs = kg.lastEvaluatedAt;
  if (!hasInteractionsSince(workCtx, sinceTs)) return;

  const promptText = evaluatePrompt(kg, summariseForEvaluator(workCtx, sinceTs));
  const { data } = await runJson<KGEvaluateResult>(promptText, kgEvaluateSchema, {
    reasoning: "medium",
  });

  // Apply updates with monotone clamping.
  const byId = new Map(kg.nodes.map((n) => [n.id, n]));
  for (const u of data.updates) {
    const node = byId.get(u.id);
    if (!node) continue;
    node.evaluation = clampMonotone(node.evaluation, u.evaluation);
    if (u.evaluatorNote && u.evaluatorNote.trim()) {
      node.evaluatorNote = u.evaluatorNote.trim();
    }
  }

  kg.lastEvaluatedAt = Date.now();
  kg.evaluationCount += 1;
  if (data.globalNote && data.globalNote.trim()) {
    kg.globalNote = data.globalNote.trim();
  }
  saveKG(kg);
}
