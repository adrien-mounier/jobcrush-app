// #220 (labeler slice 1, spec #219, ADR-0014) — the job labeler's target-role half.
//
// One model call places a role into job families from the CLOSED published list, answering the
// FamilyPlacement contract: confirmed (one or more families + an ordinal confidence) / unmapped.
// Never the nearest family — ADR-0014 decision 1.
//
// #231 (ADR-0014 amendment 1) removed the third outcome. `needs_clarification` existed so a visitor
// could break a two-family tie; nobody is asked any more, so a job that genuinely does two kinds of
// work is ANSWERED with both. Doubt moved to the ordinal instead: it rides on the ranking, never on
// the years fact (see attenuateForConfidence below).
//
// Same LLM-call idiom as adReader.ts: a version-controlled prompt file, extractJson, a zod gate,
// one retry with the validation error appended. It differs in the last step, deliberately: adReader
// THROWS on a second bad answer, this DEGRADES TO UNMAPPED (#220 AC6). An advert that cannot be read
// just loses a card; a target role that cannot be placed must never become a guess a visitor's whole
// discovery is then pinned to — "unmapped" is a correct, honest, already-handled answer here.
//
// The model picks ids and nothing else. Versions, display labels and schemaVersion are assembled
// HERE from the published list, the same discipline ad-reader.md follows for adId/curated: a model
// must never invent a version number a visitor's numbers get pinned to.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FamilyPlacement, PLACEMENT_SCHEMA_VERSION, PlacementConfidence } from "@jobcrush/contracts";
import { z } from "zod";
import { extractJson } from "./miner.js";
import type { LlmClient } from "./llm.js";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
import type { JobBlockStore } from "./jobBlockStore.js";
import type { SessionRecord } from "./sessions.js";
import type { EligibilityStore } from "./eligibility.js";
import { refreshWorkedYears } from "./yearsWorked.js";
import { incrementCounter } from "./counters.js";
import {
  recordUnmappedLabel,
  type UnmappedLabelFeed,
  type UnmappedLabelStore,
} from "./unmappedLabels.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "family-labeler.md");

let cachedPrompt: string | null = null;
export function familyLabelerPrompt(): string {
  if (!cachedPrompt) {
    // strip the HTML comment header — it's for humans reading the repo, not the model
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

/** One published family, in the shape the prompt describes it and the contract references it.
 *  Everything here is derived from the publication itself (familyFloors.ts) — nothing is
 *  hand-maintained beside it, so a newly published family is offered to the labeler with no code
 *  change, which is the whole point of the registry being the vocabulary. */
export interface PublishedFamily {
  familyId: string;
  version: number;
  /** The visitor-facing name. Published data (floor.label), never model-authored: a clarification
   *  choice is display copy a person reads and picks from, so it must be stable and ours. */
  label: string;
  /** What the family covers and where its edge is — published data (floor.scope), the thing that
   *  makes a closed vocabulary usable rather than guessable. See familyFloors.ts's own note. */
  scope: string;
  /** Real hand-curated titles this family was published on (its posting evidence) — what the
   *  family looks like in the wild, rather than a description someone wrote about it. */
  exampleTitles: string[];
  /** The family's own essential-floor questions: the core work, in the words the product already
   *  uses to ask about it. */
  coreWork: string[];
}

/** The closed vocabulary, straight off the production registry — every ACTIVE published family. */
export function publishedFamilies(store: ProductionFamilyFloorStore): PublishedFamily[] {
  return store.activePublications().map((publication) => ({
    familyId: publication.floor.familyId,
    version: publication.floor.version,
    label: publication.floor.label,
    scope: publication.floor.scope,
    exampleTitles: [...new Set(publication.postingEvidence.map((item) => item.roleTitle))],
    coreWork: publication.floor.essentialItems.map((item) => item.question.prompt),
  }));
}

function describeFamilies(families: PublishedFamily[]): string {
  return families
    .map((family) =>
      [
        `### ${family.label}`,
        `id: ${family.familyId}`,
        `what this family covers (THIS decides the family): ${family.scope}`,
        `a few real job titles in this family, as examples only — the family is much wider than the handful shown: ${family.exampleTitles.join("; ")}`,
        "questions this family later asks people who are in it. They are illustration, NOT a checklist the role has to pass:",
        ...family.coreWork.map((line) => `- ${line}`),
      ].join("\n"),
    )
    .join("\n\n");
}

/** #231 / #232 — both labeler callers may hold several families. */
const CARDINALITY = {
  rule: `- **exactly one → confirmed**, naming that family.
- **two → confirmed, naming BOTH.** A job can genuinely be two kinds of work, and nobody will be
  asked to choose: name both, and each family counts the work in full. Name a second family ONLY
  when **both parts are substantial** — a real, standing half of the job, not a flavour of the
  first. A title that names two kinds of work ("X and Y manager", "X / Y lead") is the ordinary
  case for this. A title where one word is merely the SUBJECT of the other ("product delivery
  manager" — delivery work, done on a product) is ONE family, not two.
- **more than two → name them all**, but read that as a signal you are counting flavours as jobs:
  go back through step 1 before you answer.`,
  idsExample: `"<id from the list>","<a second id, ONLY if that second kind of work is substantial>"`,
};

export function buildFamilyLabelerInput(
  role: string,
  families: PublishedFamily[],
): string {
  // Function replacers: the substituted text is published data and visitor free text, neither of
  // which this repo controls, and a string replacer would treat "$&"/"$1" in it as a pattern
  // (adReader.ts hit the same hazard with family names).
  return familyLabelerPrompt()
    .replace("{{FAMILIES}}", () => describeFamilies(families))
    .replace("{{ROLE}}", () => role.trim())
    .replace("{{CARDINALITY}}", () => CARDINALITY.rule)
    .replace("{{IDS_EXAMPLE}}", () => CARDINALITY.idsExample);
}

// What the model is asked for — ids and one ordinal. Non-strict on purpose: the prompt asks for a
// one-sentence "why" to steer the answer, and any other stray key the model adds is simply dropped
// rather than failing a read that was otherwise perfectly good.
const LabelerAnswer = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("confirmed"),
    familyIds: z.array(z.string()).min(1),
    confidence: PlacementConfidence,
  }),
  z.object({ outcome: z.literal("unmapped") }),
]);

// Frozen: one object is handed back by every unmapped path here AND stored in makeFamilyPlacer's
// cache, so a caller mutating it would rewrite an answer other visitors are still holding.
export const UNMAPPED: FamilyPlacement = Object.freeze({
  schemaVersion: PLACEMENT_SCHEMA_VERSION,
  outcome: "unmapped",
});

/** Turns the model's ids into the contract answer, filling versions from the published list.
 *  Throws (→ one retry, then unmapped) when the model names a family that is not published. */
function assemble(
  answer: z.infer<typeof LabelerAnswer>,
  families: PublishedFamily[],
): FamilyPlacement {
  if (answer.outcome === "unmapped") return UNMAPPED;
  return {
    schemaVersion: PLACEMENT_SCHEMA_VERSION,
    outcome: "confirmed",
    // The contract itself rejects a repeated family, so a model naming the same one twice fails the
    // parse below and is retried rather than stored as a job that is two of the same thing.
    families: answer.familyIds.map((familyId) => {
      const found = families.find((family) => family.familyId === familyId);
      if (!found) throw new Error(`unknown family id: ${familyId}`);
      return { familyId: found.familyId, version: found.version };
    }),
    confidence: answer.confidence,
  };
}

/** ADR-0014 amendment 1 decision 5 — how a confidence level moves a card's SCORE, and the only
 *  thing it is ever allowed to move. Certain leaves the number alone; less-than-certain sinks the
 *  card in the deck without ever removing it (nothing is filtered — the deck's own shipped rule)
 *  and without touching the years fact, which stays a whole honest number.
 *
 *  Deliberately coarse: three steps, matching the three levels the model can actually distinguish.
 *  A finer curve would be inventing precision the ordinal does not carry, which is the same mistake
 *  decision 5 rejects a float for.
 *
 *  The production caller is buildJobCard (deck.ts, #222): when a card's score leaned on a
 *  per-family years fact, the weakest contributing placement's level sinks the card's matchPct.
 *  Both halves of #231 AC6 are now real and tested — the card sinks, and nothing about confidence
 *  ever reaches the years fact.
 *
 *  THE WEIGHTS ARE THE OWNER'S (2026-08-15), not a default to tune away. Proposed here, then
 *  confirmed against the worked case: an 80% card reads 72% at `likely` and 60% at `possible`, which
 *  in a deck clustering around 60-85% drops it out of the top handful. That is the point — "this is
 *  reflecting reality and a score that is meaningful, that's what I want as a user." Softening these
 *  so cards look better reverses a decision; it is not tuning. ADR-0014 amendment 1 decision 5
 *  carries the table and the reasoning. */
export const CONFIDENCE_WEIGHT: Record<PlacementConfidence, number> = {
  certain: 1,
  likely: 0.9,
  possible: 0.75,
};

export function attenuateForConfidence(score: number, confidence: PlacementConfidence): number {
  return Math.round(score * CONFIDENCE_WEIGHT[confidence]);
}

/**
 * Places one target role. Two attempts: a contract-violating answer is re-prompted once with its own
 * validation error, and a second bad answer degrades to unmapped (#220 AC6 — never a guess).
 * A raw driver failure (network, API error) is NOT caught here; makeFamilyPlacer below turns that
 * into unmapped too, so the two failure classes stay distinguishable in the counters.
 */
export async function placeTargetRole(
  role: string,
  families: PublishedFamily[],
  llm: LlmClient,
  feed?: UnmappedLabelFeed,
): Promise<FamilyPlacement> {
  return (await place(role, families, llm, feed)).placement;
}

/** #231 — exported for the eval grid, which measures the plural labeler. */
export async function placeJobTitle(
  title: string,
  families: PublishedFamily[],
  llm: LlmClient,
  feed?: UnmappedLabelFeed,
): Promise<FamilyPlacement> {
  return (await place(title, families, llm, feed)).placement;
}

/** placeTargetRole's own body, plus whether the answer was a DEGRADATION rather than a real one.
 *  makeFamilyPlacer needs that apart: an unmapped the model actually gave is worth remembering for
 *  the rest of the visit; an unmapped produced by a bad answer or an outage must never be, or one
 *  bad minute would follow a visitor around for the whole session. */
async function place(
  role: string,
  families: PublishedFamily[],
  llm: LlmClient,
  // #252: where an unmapped goes to be remembered — the durable vocabulary-growth feed, carrying
  // the source (target role vs past job) and the session it happened for. Optional: a caller with
  // no feed wired still places roles, it just records nothing.
  feed?: UnmappedLabelFeed,
): Promise<{ placement: FamilyPlacement; degraded: boolean }> {
  // Nothing typed, or no vocabulary published at all: unmapped, with no model call to pay for.
  // Deliberately NOT fed to the vocabulary-growth store (#252): an empty box and an empty registry
  // are our own state, not a word the vocabulary is missing — recording them would fill the growth
  // process's feed with rows nobody can research. Same for makeFamilyPlacer's driver-failure catch
  // below, which is an outage, counted as familyLabeler.call_failed. The feed records what the
  // LABELER answered, and every one of those goes through recordUnmappedLabel exactly once.
  if (!role.trim() || families.length === 0) return { placement: UNMAPPED, degraded: false };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = buildFamilyLabelerInput(role, families);
    const input =
      attempt === 0
        ? base
        : `${base}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const text = await llm.complete(input);
    try {
      const placement = FamilyPlacement.parse(
        assemble(LabelerAnswer.parse(extractJson(text)), families),
      );
      incrementCounter(
        placement.outcome === "confirmed" ? "familyLabeler.confirmed" : "familyLabeler.unmapped",
      );
      // #231 AC9 — the counter that replaced familyLabeler.needs_clarification. A labeler that
      // started calling everything two kinds of work, or quietly stopped ever naming a second
      // family, looks identical from every other surface; this is where amendment 1 decision 3's
      // "no cap, but watch the number" becomes something an operator can actually see.
      if (placement.outcome === "confirmed" && placement.families.length > 1) {
        incrementCounter("familyLabeler.multi_family");
      }
      // #220 AC7 / #218: every honest unmapped is the vocabulary's gap surfacing — recorded as feed
      // for the pilot vocabulary-growth process, not just counted.
      if (placement.outcome === "unmapped") {
        await recordUnmappedLabel(feed, role, "labeler said no family fits");
      }
      return { placement, degraded: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  incrementCounter("familyLabeler.output_invalid");
  incrementCounter("familyLabeler.unmapped");
  // #252 AC3: a validation failure stays distinguishable from an honest "no family fits" by this
  // reason text — the first is a fault to fix, the second is a word the vocabulary is missing.
  await recordUnmappedLabel(feed, role, `output failed validation twice: ${lastError.slice(0, 300)}`);
  return { placement: UNMAPPED, degraded: true };
}

/**
 * The production `placeFamily` seam (server.ts's BuildOptions). Reads the target role the visitor
 * already typed — no extra question when the answer is clear (#219 story 4) — and never throws:
 * a model outage degrades to unmapped, so discovery carries on and no reward is authorized on data
 * nothing confirmed (#220 AC4). main.ts wires this with the real LLM + the production registry;
 * tests inject their own fake at this same seam.
 */
export function makeFamilyPlacer(
  llm: LlmClient,
  families: PublishedFamily[],
  // #252 — every unmapped target role is recorded as durable vocabulary-growth feed. Optional so a
  // test that wires no store keeps today's behaviour; main.ts passes the production store.
  unmappedLabels?: UnmappedLabelStore,
): (session: Readonly<SessionRecord>) => Promise<FamilyPlacement> {
  // Nobody pays twice for the same visitor's same role. The route this backs can be called on every
  // load of the discovery screen, and without this each one is a fresh model call for an answer that
  // cannot have changed — the same "a completed call is never re-executed" rule the pipeline's
  // checkpoints enforce, at the one door that has no pipeline behind it. In-process and lost on
  // restart, like every other cache in this app that has no store yet; keyed by the role too, so a
  // visitor who CORRECTS their target role is placed again rather than answered from the old one.
  const answered = new Map<string, FamilyPlacement>();
  const MAX_ENTRIES = 1000;

  return async (session) => {
    const role = session.intent.targetRole ?? "";
    const key = `${session.id}|${role}`;
    const remembered = answered.get(key);
    if (remembered) return remembered;
    try {
      const feed = unmappedLabels
        ? ({ store: unmappedLabels, sessionId: session.id, source: "target_role" } as const)
        : undefined;
      const { placement, degraded } = await place(role, families, llm, feed);
      // A degraded answer is never remembered — see place()'s own doc.
      if (!degraded) {
        answered.set(key, placement);
        // Bounded the same way adReader.ts bounds its negative cache: insertion-order FIFO, a
        // safety net against a long-running process rather than a precise policy.
        if (answered.size > MAX_ENTRIES) {
          const oldest = answered.keys().next().value;
          if (oldest !== undefined) answered.delete(oldest);
        }
      }
      return placement;
    } catch (err) {
      incrementCounter("familyLabeler.call_failed");
      console.error(`[ops] family placement call failed: ${err instanceof Error ? err.message : String(err)}`);
      return UNMAPPED;
    }
  };
}

/**
 * #221 — the labeler's PAST-JOB half: one pipeline step that places every dated job record this
 * session has, so each one carries a family the visitor can see and correct.
 *
 * The checkpoint is the store itself, not a flag on the run: a block whose placement has landed is
 * skipped, so a pipeline retry re-executes no completed labeler call (#221 AC2) — at per-call
 * granularity, which a step-level flag could not give (a crash halfway through eight blocks would
 * re-spend all eight). A correction is a placement too, so a corrected block is skipped for the same
 * reason — a re-run never overwrites what a person told us (#221 AC5).
 *
 * One failed block is recorded and stepped over, never fatal (#221 AC3): it stays unlabeled, reads
 * as unmapped, and the next block is still placed. The step as a whole never throws into the run.
 *
 * JOBS only. A degree belongs to no job family, and paying for a call that can only ever come back
 * unmapped is waste — one per education/project/client/volunteering block, on every upload. Nothing
 * is stranded by this: a block a person later corrects INTO a job is left unlabeled, so the next
 * run of this step places it like any other unplaced job (#231: nobody is asked, so nothing sits
 * waiting on an answer that would never come).
 */
export function makeJobBlockLabeler(
  llm: LlmClient,
  families: PublishedFamily[],
  store: Pick<JobBlockStore, "list" | "label" | "summary">,
  // #222 — labeling IS a door that changes a job record (the sixth fact), so the per-family years
  // facts are re-derived after it like after any other door. Optional so pre-#222 test builds that
  // only assert placements keep working unchanged; production wiring passes it.
  eligibility?: EligibilityStore,
  // #252 — the past-job half of the vocabulary-growth feed, same optional-store rule as above.
  unmappedLabels?: UnmappedLabelStore,
): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    let labeled = false;
    for (const block of await store.list(sessionId)) {
      if (block.kind !== "job") continue; // its CORRECTED kind — see this function's own doc
      if (block.family.value) continue; // already answered (labeled or corrected) — never re-spent
      try {
        // The TITLE is what gets placed: it is the block's own statement of what the work was, and
        // it is the field the visitor can already correct if the miner read it wrong.
        // PLURAL (#231): a past job may genuinely be two kinds of work, and nobody is asked which.
        const feed = unmappedLabels
          ? ({ store: unmappedLabels, sessionId, source: "past_job" } as const)
          : undefined;
        const { placement, degraded } = await place(block.title.value, families, llm, feed);
        // A DEGRADED answer is never stored — the same rule makeFamilyPlacer's cache follows, and it
        // matters more here: a stored placement is exactly what stops this block being asked again,
        // so persisting an unmapped the model never actually gave would make one bad minute
        // permanent. Left unlabeled instead: reads as unmapped (#221 AC3) and is placed for real on
        // the next run.
        if (!degraded) {
          await store.label(sessionId, block.id, placement);
          labeled = true;
        }
      } catch (err) {
        incrementCounter("familyLabeler.call_failed");
        console.error(
          `[ops] job-block family placement call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // #222 — re-derive the per-family years facts the labels just made true. Without this, the deck
    // read between labeling and the next correction door would see no family facts at all and score
    // every advert against a "known zero" that is really an unsynced copy.
    if (labeled && eligibility) await refreshWorkedYears(store, eligibility, sessionId);
  };
}

// #235 deleted placementRejection() here: an unconfirmed placement no longer refuses production
// discovery — it takes the word-search path instead, and the family-research offer it carried is
// replaced by #236's silent background candidate screen.
