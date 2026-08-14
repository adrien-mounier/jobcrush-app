// #220 (labeler slice 1, spec #219, ADR-0014) — the job labeler's target-role half.
//
// One model call places a visitor's typed target role into a job family from the CLOSED published
// list, answering the existing FamilyPlacement contract: confirmed / needs_clarification (2+
// choices, the visitor picks) / unmapped. Never the nearest family — ADR-0014 decision 1.
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
import { FamilyPlacement } from "@jobcrush/contracts";
import { z } from "zod";
import { extractJson } from "./miner.js";
import type { LlmClient } from "./llm.js";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
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

export function buildFamilyLabelerInput(role: string, families: PublishedFamily[]): string {
  // Function replacers: the substituted text is published data and visitor free text, neither of
  // which this repo controls, and a string replacer would treat "$&"/"$1" in it as a pattern
  // (adReader.ts hit the same hazard with family names).
  return familyLabelerPrompt()
    .replace("{{FAMILIES}}", () => describeFamilies(families))
    .replace("{{ROLE}}", () => role.trim());
}

// What the model is asked for — ids only. Non-strict on purpose: the prompt asks for a one-sentence
// "why" to steer the answer, and any other stray key the model adds is simply dropped rather than
// failing a read that was otherwise perfectly good.
const LabelerAnswer = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("confirmed"), familyId: z.string() }),
  z.object({ outcome: z.literal("needs_clarification"), familyIds: z.array(z.string()).min(2) }),
  z.object({ outcome: z.literal("unmapped") }),
]);

// Frozen: one object is handed back by every unmapped path here AND stored in makeFamilyPlacer's
// cache, so a caller mutating it would rewrite an answer other visitors are still holding.
export const UNMAPPED: FamilyPlacement = Object.freeze({ schemaVersion: "1", outcome: "unmapped" });

/** Turns the model's ids into the contract answer, filling version + label from the published list.
 *  Throws (→ one retry, then unmapped) when the model names a family that is not published: the
 *  closed vocabulary is only closed if something enforces it outside the prompt. */
function assemble(answer: z.infer<typeof LabelerAnswer>, families: PublishedFamily[]): FamilyPlacement {
  const find = (familyId: string): PublishedFamily => {
    const found = families.find((family) => family.familyId === familyId);
    if (!found) throw new Error(`unknown family id: ${familyId}`);
    return found;
  };
  if (answer.outcome === "unmapped") return UNMAPPED;
  if (answer.outcome === "confirmed") {
    const family = find(answer.familyId);
    return {
      schemaVersion: "1",
      outcome: "confirmed",
      family: { familyId: family.familyId, version: family.version },
    };
  }
  const choices = answer.familyIds.map(find);
  return {
    schemaVersion: "1",
    outcome: "needs_clarification",
    // The contract itself rejects duplicate choices, so a model naming the same family twice fails
    // the parse below and is retried rather than shown to a visitor as a choice between one thing.
    choices: choices.map((family) => ({
      familyId: family.familyId,
      version: family.version,
      label: family.label,
    })),
  };
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
  return (await place(role, families, llm)).placement;
}

/** placeTargetRole's own body, plus whether the answer was a DEGRADATION rather than a real one.
 *  makeFamilyPlacer needs that apart: an unmapped the model actually gave is worth remembering for
 *  the rest of the visit; an unmapped produced by a bad answer or an outage must never be, or one
 *  bad minute would follow a visitor around for the whole session. */
async function place(
  role: string,
  families: PublishedFamily[],
  llm: LlmClient,
): Promise<{ placement: FamilyPlacement; degraded: boolean }> {
  // Nothing typed, or no vocabulary published at all: unmapped, with no model call to pay for.
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
        placement.outcome === "confirmed"
          ? "familyLabeler.confirmed"
          : placement.outcome === "needs_clarification"
            ? "familyLabeler.needs_clarification"
            : "familyLabeler.unmapped",
      );
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
      const { placement, degraded } = await place(role, families, llm);
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

/** The 409 body for a placement that cannot start production discovery. Lives here rather than in
 *  routes/onboarding.ts so the spine stays thin (the ratchet), and because WHAT a non-confirmed
 *  placement offers the visitor next is the labeler's business, not the route's:
 *  needs_clarification carries its choices so the visitor can pick (#220 AC2, the machine never
 *  picks); unmapped points at the family research candidate path rather than the nearest family
 *  (#220 AC3). rewardEligible stays false for both — nothing is authorized on an unconfirmed
 *  placement. */
export function placementRejection(placement: FamilyPlacement) {
  return placement.outcome === "needs_clarification"
    ? {
        error: { code: "placement_needs_clarification", message: "choose which kind of work this is" },
        choices: placement.choices,
        rewardEligible: false,
      }
    : {
        error: { code: "placement_not_confirmed", message: "confirmed family placement required" },
        // The path that already exists for a role no published family covers
        // (routes/familyLearning.ts) — offered, never a silent dead end.
        familyResearch: { path: "/family-learning/candidates" },
        rewardEligible: false,
      };
}
