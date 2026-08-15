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
import { incrementCounter, recordUnmappedLabel } from "./counters.js";

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

/** #231 — the ONE thing that differs between the labeler's two callers. A past job may hold several
 *  families; the target role must hold exactly one, because floor selection takes exactly one
 *  (`loadFamilyFloor(...)`) and #232 is what merges floors and lifts this. Held as prompt text plus
 *  a hard check in assemble() below, not as a truncation: silently keeping the first of two would
 *  be the machine picking, which is the one thing ADR-0014 never allows. */
export type PlacementShape = "plural" | "single";

const CARDINALITY: Record<PlacementShape, { rule: string; idsExample: string }> = {
  plural: {
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
  },
  single: {
    rule: `- **exactly one → confirmed**, naming that family.
- **two or more → unmapped.** This role is used to choose the questions we will ask, and that takes
  a single family today, so a role that is genuinely two kinds of work in equal measure cannot be
  held yet. Say unmapped rather than pick one — never guess which half was meant.`,
    idsExample: `"<one id from the list>"`,
  },
};

export function buildFamilyLabelerInput(
  role: string,
  families: PublishedFamily[],
  shape: PlacementShape,
): string {
  // Function replacers: the substituted text is published data and visitor free text, neither of
  // which this repo controls, and a string replacer would treat "$&"/"$1" in it as a pattern
  // (adReader.ts hit the same hazard with family names).
  return familyLabelerPrompt()
    .replace("{{FAMILIES}}", () => describeFamilies(families))
    .replace("{{ROLE}}", () => role.trim())
    .replace("{{CARDINALITY}}", () => CARDINALITY[shape].rule)
    .replace("{{IDS_EXAMPLE}}", () => CARDINALITY[shape].idsExample);
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
 *  Throws (→ one retry, then unmapped) when the model names a family that is not published, or
 *  names more than one where the caller can only hold one: the closed vocabulary and the
 *  single-family constraint are only real if something enforces them outside the prompt. */
function assemble(
  answer: z.infer<typeof LabelerAnswer>,
  families: PublishedFamily[],
  shape: PlacementShape,
): FamilyPlacement {
  if (answer.outcome === "unmapped") return UNMAPPED;
  if (shape === "single" && answer.familyIds.length !== 1) {
    throw new Error("this role must be placed in exactly one family, or left unmapped");
  }
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
 *  NO PRODUCTION CALLER YET, and that is a known half-delivery rather than an oversight. #231 AC6
 *  ("a lower confidence level lowers the card's score and never the years fact") asks for this rule,
 *  but the site that would apply it — scoring an advert against the visitor's years IN THAT ADVERT'S
 *  FAMILY — is #222, which this ticket unblocks and which cannot land before it. The other half of
 *  AC6 is real today and tested: nothing about confidence reaches the years fact.
 *
 *  It ships now rather than with #222 because the ordinal is STORED from today: a placement written
 *  this week is read by #222's arithmetic next week, so the curve those stored levels will be judged
 *  against has to be decided once, here, beside the thing that produces them.
 *
 *  The three weights are this ticket's own choice, not the owner's: ADR-0014 amendment 1 decision 5
 *  pins the SHAPE (an ordinal, attenuating the ranking, never the fact) and deliberately says
 *  nothing about magnitudes. Worth confirming when #222 makes them visible in a real deck. */
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
): Promise<FamilyPlacement> {
  // #231 scope boundary: SINGLE. A plural target role would reach floor selection, which takes
  // exactly one family — #232 merges the floors and lifts this.
  return (await place(role, families, llm, "single")).placement;
}

/** #231 — the same call the labeler makes, in its PLURAL shape: a job may be several kinds of work
 *  at once. Exported for the eval grid, which measures the plural labeler because that is the one
 *  a visitor's job records actually go through. */
export async function placeJobTitle(
  title: string,
  families: PublishedFamily[],
  llm: LlmClient,
): Promise<FamilyPlacement> {
  return (await place(title, families, llm, "plural")).placement;
}

/** placeTargetRole's own body, plus whether the answer was a DEGRADATION rather than a real one.
 *  makeFamilyPlacer needs that apart: an unmapped the model actually gave is worth remembering for
 *  the rest of the visit; an unmapped produced by a bad answer or an outage must never be, or one
 *  bad minute would follow a visitor around for the whole session. */
async function place(
  role: string,
  families: PublishedFamily[],
  llm: LlmClient,
  shape: PlacementShape,
): Promise<{ placement: FamilyPlacement; degraded: boolean }> {
  // Nothing typed, or no vocabulary published at all: unmapped, with no model call to pay for.
  if (!role.trim() || families.length === 0) return { placement: UNMAPPED, degraded: false };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = buildFamilyLabelerInput(role, families, shape);
    const input =
      attempt === 0
        ? base
        : `${base}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const text = await llm.complete(input);
    try {
      const placement = FamilyPlacement.parse(
        assemble(LabelerAnswer.parse(extractJson(text)), families, shape),
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
      if (placement.outcome === "unmapped") recordUnmappedLabel(role, "labeler said no family fits");
      return { placement, degraded: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  incrementCounter("familyLabeler.output_invalid");
  incrementCounter("familyLabeler.unmapped");
  recordUnmappedLabel(role, `output failed validation twice: ${lastError.slice(0, 300)}`);
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
      const { placement, degraded } = await place(role, families, llm, "single");
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
  store: Pick<JobBlockStore, "list" | "label">,
): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    for (const block of await store.list(sessionId)) {
      if (block.kind !== "job") continue; // its CORRECTED kind — see this function's own doc
      if (block.family.value) continue; // already answered (labeled or corrected) — never re-spent
      try {
        // The TITLE is what gets placed: it is the block's own statement of what the work was, and
        // it is the field the visitor can already correct if the miner read it wrong.
        // PLURAL (#231): a past job may genuinely be two kinds of work, and nobody is asked which.
        const { placement, degraded } = await place(block.title.value, families, llm, "plural");
        // A DEGRADED answer is never stored — the same rule makeFamilyPlacer's cache follows, and it
        // matters more here: a stored placement is exactly what stops this block being asked again,
        // so persisting an unmapped the model never actually gave would make one bad minute
        // permanent. Left unlabeled instead: reads as unmapped (#221 AC3) and is placed for real on
        // the next run.
        if (!degraded) await store.label(sessionId, block.id, placement);
      } catch (err) {
        incrementCounter("familyLabeler.call_failed");
        console.error(
          `[ops] job-block family placement call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };
}

/** The 409 body for a placement that cannot start production discovery. Lives here rather than in
 *  routes/onboarding.ts so the spine stays thin (the ratchet), and because WHAT a non-confirmed
 *  placement offers the visitor next is the labeler's business, not the route's: it points at the
 *  family research candidate path rather than the nearest family (#220 AC3). rewardEligible stays
 *  false — nothing is authorized on an unconfirmed placement.
 *
 *  #231 collapsed this to one branch. It used to have a second, handing back the labeler's own two
 *  choices for the visitor to pick between; with `needs_clarification` gone there is nothing to
 *  pick between. It is also reached by a NEW case until #232: a target role the labeler reads as
 *  two kinds of work is now unmapped rather than a question, so a genuinely dual-craft visitor
 *  lands on family research. Named as the cost of the sequencing, not hidden. */
export function placementRejection() {
  return {
    error: { code: "placement_not_confirmed", message: "confirmed family placement required" },
    // The path that already exists for a role no published family covers
    // (routes/familyLearning.ts) — offered, never a silent dead end.
    familyResearch: { path: "/family-learning/candidates" },
    rewardEligible: false,
  };
}
