// #281 (spec #279, ADR-0014 decision 2 as amended) — the SEVENTH fact: every dated job carries the
// industry it was in.
//
// Deliberately the family labeler's twin rather than an extension of it. The two axes run against
// different vocabularies, are gated by different grids, and (from #282) the industry half reaches
// for a web lookup the family half has never needed. Merging them would invalidate a passing grid to
// save a call that is already cheap. They share one pass over the job records; they do not share a
// call. Read familyLabeler.ts alongside this — every rule it carries is deliberate here too:
//
//   - one model call, a version-controlled prompt, a zod gate, ONE retry with the validation error
//     appended, and a second bad answer DEGRADING to unmapped rather than throwing;
//   - a degraded answer is NEVER stored, so one bad minute never becomes permanent;
//   - the model picks ids and nothing else — versions and schemaVersion are assembled HERE from the
//     published vocabulary, because a model must never invent a version a person's numbers are
//     pinned to;
//   - every honest unmapped is fed to the durable vocabulary-growth store, distinguishable from a
//     validation failure by its reason text.
//
// #282 adds the SECOND evidence source beside the person's own lines: one cached web lookup of the
// employer (employerLookup.ts). It answers a different half — the lines say what industry the WORK
// was in, the lookup says what the EMPLOYER is — and it is best-effort throughout: a lookup that
// fails, times out or finds nothing is a null, and a null places the job on the lines alone.
//
// What is deliberately NOT here: any question to a person, and any change to a number. These tickets
// make the fact exist, visible and correct. No advert score, card order or years figure moves —
// that is #283-#285.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDUSTRY_PLACEMENT_SCHEMA_VERSION,
  IndustryPlacement,
  PlacementConfidence,
} from "@jobcrush/contracts";
import { z } from "zod";
import { extractJson } from "./miner.js";
import type { LlmClient } from "./llm.js";
// The closed vocabulary reaches every caller as `vocabulary.activeIndustries()` — the publication
// IS the list, so nothing is hand-maintained beside it and a newly published industry is offered to
// the labeler with no code change.
import type { Industry } from "./industryVocabulary.js";
import type { JobBlockStore } from "./jobBlockStore.js";
import type { ClaimStore } from "./claims.js";
import type { EmployerLookup } from "./employerLookup.js";
import { incrementCounter } from "./counters.js";
import {
  recordUnmappedLabel,
  type UnmappedLabelFeed,
  type UnmappedLabelStore,
} from "./unmappedLabels.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "industry-labeler.md");

let cachedPrompt: string | null = null;
export function industryLabelerPrompt(): string {
  if (!cachedPrompt) {
    // strip the HTML comment header — it's for humans reading the repo, not the model
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

function describeIndustries(industries: Industry[]): string {
  return industries
    .map((industry) =>
      [
        `### ${industry.label}`,
        `id: ${industry.industryId}`,
        `what this industry covers, and where its edge is (THIS decides it): ${industry.scope}`,
      ].join("\n"),
    )
    .join("\n\n");
}

/** The evidence for one job — two sources answering two different halves.
 *
 *  The LINES are the person's own words, and they are the only evidence that can show the industry
 *  the work was SERVED into. The LOOKUP (#282) is one cached web search of the employer, and it is
 *  the only evidence that can say what an employer nobody has heard of actually is. A disagreement
 *  between them is not a conflict — it is the two-industry case, and industry-labeler.md resolves
 *  it. The lookup is always optional: absent, it costs nothing but a less certain answer. */
export interface JobIndustryEvidence {
  employer: string;
  title: string;
  lines: string[];
  /** What the web said about this employer, or null/absent when the lookup was never made, failed,
   *  timed out or found nothing. Every one of those degrades to the same thing: CV evidence alone. */
  lookup?: string | null;
}

/** How many of a job's own CV lines travel with the call. A bounded window rather than the whole
 *  history: the lines are evidence about the business, and the first handful of bullets under a job
 *  carry that as well as the twentieth does.
 *  ponytail: first-N, no relevance ranking — raise it if the grid shows placements missed for want
 *  of a later line. */
const MAX_LINES = 12;
const MAX_LINE_LENGTH = 300;
/** Second bound on the lookup text, on top of employerLookup.ts's own. A cached row written before
 *  that bound tightened, or by a driver that never applied it, still cannot flood this prompt. */
const MAX_LOOKUP_LENGTH = 1200;

export function buildIndustryLabelerInput(
  evidence: JobIndustryEvidence,
  industries: Industry[],
): string {
  const lines = evidence.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((line) => `- ${line.slice(0, MAX_LINE_LENGTH)}`);
  // Function replacers throughout: the substituted text is published data and a person's own CV
  // free text, neither of which this repo controls, and a string replacer would treat "$&"/"$1" in
  // it as a pattern (adReader.ts and familyLabeler.ts hit the same hazard).
  return industryLabelerPrompt()
    .replace("{{INDUSTRIES}}", () => describeIndustries(industries))
    .replace("{{EMPLOYER}}", () => evidence.employer.trim() || "(not stated)")
    .replace("{{TITLE}}", () => evidence.title.trim() || "(not stated)")
    .replace("{{LINES}}", () => (lines.length ? lines.join("\n") : "(nothing written under this job)"))
    // The bounded, deliberately unremarkable stand-in for a lookup that never happened. The prompt is
    // written to place the job on the lines alone when it reads this, so a missing lookup can never
    // become a reason to answer unmapped.
    .replace(
      "{{EMPLOYER_LOOKUP}}",
      () =>
        evidence.lookup?.trim().slice(0, MAX_LOOKUP_LENGTH) ||
        "(no web lookup was made for this employer)",
    );
}

// What the model is asked for — ids and one ordinal. Non-strict on purpose: the prompt asks for a
// one-sentence "why" to steer the answer, and any other stray key is dropped rather than failing a
// read that was otherwise perfectly good.
// #282 takes this to one entry PER INDUSTRY: the model names each industry with how sure it is of
// THAT one. The employer's own industry can be certain off a web lookup while the industry the work
// was served into, read out of the person's own lines, is only possible — and one number for both
// would let the weaker ride on the stronger all the way into #285's score.
const LabelerAnswer = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("confirmed"),
    industries: z
      .array(z.object({ industryId: z.string(), confidence: PlacementConfidence }))
      .min(1),
  }),
  z.object({ outcome: z.literal("unmapped") }),
]);

/** Frozen: one object is handed back by every unmapped path here, so a caller mutating it would
 *  rewrite an answer someone else is still holding. */
export const UNMAPPED: IndustryPlacement = Object.freeze({
  schemaVersion: INDUSTRY_PLACEMENT_SCHEMA_VERSION,
  outcome: "unmapped",
});

/** Turns the model's ids into the contract answer, filling versions from the published list.
 *  Throws (→ one retry, then unmapped) when the model names an industry that is not published. */
function assemble(
  answer: z.infer<typeof LabelerAnswer>,
  industries: Industry[],
): IndustryPlacement {
  if (answer.outcome === "unmapped") return UNMAPPED;
  return {
    schemaVersion: INDUSTRY_PLACEMENT_SCHEMA_VERSION,
    outcome: "confirmed",
    // The contract itself rejects a repeated industry, so a model naming the same one twice fails
    // the parse below and is retried rather than stored as a job that is two of the same thing.
    industries: answer.industries.map(({ industryId, confidence }) => {
      const found = industries.find((industry) => industry.industryId === industryId);
      if (!found) throw new Error(`unknown industry id: ${industryId}`);
      // The model picks the id and how sure it is; the VERSION is ours, read off the publication —
      // a model must never invent a version a person's numbers are pinned to.
      return { industryId: found.industryId, version: found.version, confidence };
    }),
  };
}

/**
 * Places one job. Two attempts: a contract-violating answer is re-prompted once with its own
 * validation error, and a second bad answer degrades to unmapped — never a guess. A raw driver
 * failure (network, API error) is NOT caught here; the step below turns that into an unlabeled job,
 * so the two failure classes stay distinguishable in the counters.
 *
 * `degraded` says whether the unmapped is one the model actually gave or one we manufactured. It
 * matters more here than in makeFamilyPlacer's cache: a STORED placement is exactly what stops this
 * job being asked again, so persisting an unmapped the model never gave would make one bad minute
 * permanent.
 */
export async function placeJobIndustry(
  evidence: JobIndustryEvidence,
  industries: Industry[],
  llm: LlmClient,
  feed?: UnmappedLabelFeed,
): Promise<{ placement: IndustryPlacement; degraded: boolean }> {
  // No vocabulary published at all, or nothing to go on: unmapped, with no model call to pay for.
  //
  // DEGRADED, not a real answer — and the distinction is load-bearing, not pedantry. A degraded
  // answer is never stored, and a stored placement is exactly what stops a job being placed again.
  // Call this one honest and an empty publication would write `unmapped` onto every job in the
  // database, permanently: the checkpoint would skip them forever, and they would still be unplaced
  // the day the vocabulary loads correctly. The same holds for a job with no employer, no title and
  // no lines — we have nothing to place it on YET, and "yet" is the whole difference.
  //
  // Deliberately NOT fed to the vocabulary-growth store either: an empty publication and an empty
  // job are our own state, not a word the vocabulary is missing, and recording them would fill the
  // growth process's feed with rows nobody can research.
  const hasEvidence =
    evidence.employer.trim().length > 0 ||
    evidence.title.trim().length > 0 ||
    evidence.lines.some((line) => line.trim().length > 0);
  if (industries.length === 0 || !hasEvidence) return { placement: UNMAPPED, degraded: true };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = buildIndustryLabelerInput(evidence, industries);
    const input =
      attempt === 0
        ? base
        : `${base}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const text = await llm.complete(input);
    try {
      const placement = IndustryPlacement.parse(
        assemble(LabelerAnswer.parse(extractJson(text)), industries),
      );
      incrementCounter(
        placement.outcome === "confirmed" ? "industryLabeler.placed" : "industryLabeler.unmapped",
      );
      // A labeler that started calling every job two industries, or quietly stopped ever naming a
      // second, looks identical from every other surface. This is where "no cap, but watch the
      // number" becomes something an operator can actually see.
      if (placement.outcome === "confirmed" && placement.industries.length > 1) {
        incrementCounter("industryLabeler.multi_industry");
      }
      // Every honest unmapped is this vocabulary's gap surfacing — recorded as feed for the
      // vocabulary-growth process, beside the family gaps, not just counted.
      if (placement.outcome === "unmapped") {
        await recordUnmappedLabel(feed, unmappedLabelFor(evidence), "labeler said no industry fits");
      }
      return { placement, degraded: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  incrementCounter("industryLabeler.output_invalid");
  incrementCounter("industryLabeler.unmapped");
  // A validation failure stays distinguishable from an honest "nothing fits" by this reason text —
  // the first is a fault to fix, the second is a word the vocabulary is missing.
  await recordUnmappedLabel(
    feed,
    unmappedLabelFor(evidence),
    `output failed validation twice: ${lastError.slice(0, 300)}`,
  );
  return { placement: UNMAPPED, degraded: true };
}

/** What the growth feed records as "the thing we have no word for". The EMPLOYER, because that is
 *  what an industry describes — with the title behind it so a researcher reading the feed can tell
 *  two identically-named small companies apart. */
function unmappedLabelFor(evidence: JobIndustryEvidence): string {
  const employer = evidence.employer.trim();
  const title = evidence.title.trim();
  if (!employer) return title;
  return title ? `${employer} — ${title}` : employer;
}

/** The person's own CV lines for one job. Claims carry `role` as "employer + title as written"
 *  (claim-miner.md rule 6), which is the only link the repo has between a mined sentence and a
 *  mined job block — there is no foreign key to match on.
 *  ponytail: matched on the EMPLOYER substring, case-insensitively, and only when the employer is
 *  long enough not to sweep the whole CV. Two jobs at the same employer therefore share their lines,
 *  which is the right failure (both were at the same business) — tighten to employer+title only if
 *  the grid shows served-industry answers bleeding between roles. */
async function linesFor(
  claims: Pick<ClaimStore, "list"> | undefined,
  sessionId: string,
  employer: string,
): Promise<string[]> {
  const needle = employer.trim().toLowerCase();
  if (!claims || needle.length < 3) return [];
  try {
    return (await claims.list(sessionId))
      .filter((claim) => claim.role.toLowerCase().includes(needle))
      .map((claim) => claim.text);
  } catch (err) {
    // Evidence, not a gate: a claims read that fails leaves the job placed on employer + title
    // alone rather than failing the labeling step.
    console.error(
      `[ops] industry labeler could not read CV lines: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * The pipeline step: places every not-yet-placed dated JOB of this session in an industry.
 *
 * The checkpoint is the store itself, not a flag on the run: a job whose placement has landed is
 * skipped, so a pipeline retry re-executes no completed call — at per-job granularity, which a
 * step-level flag could not give (a crash halfway through eight jobs would re-spend all eight). A
 * correction is a placement too, so a corrected job is skipped for the same reason, and a re-run can
 * never overwrite what a person told us.
 *
 * One failed job is recorded and stepped over, never fatal: it stays unlabeled, reads as unmapped,
 * and the next job is still placed. The step as a whole never throws into the run.
 *
 * JOBS only. A degree or a personal project belongs to no employer industry, and paying for a call
 * that can only ever come back unmapped is waste. A block a person later corrects INTO a job is left
 * unlabeled, so the next run places it like any other unplaced job.
 */
export function makeJobBlockIndustryLabeler(
  llm: LlmClient,
  industries: Industry[],
  store: Pick<JobBlockStore, "list" | "labelIndustry">,
  // The person's own CV lines. Optional: a build with no claim store still places jobs on the
  // employer name and title alone, which is exactly the "small unknown employer" degraded case.
  claims?: Pick<ClaimStore, "list">,
  unmappedLabels?: UnmappedLabelStore,
  // #282: what the employer actually IS, from one cached web lookup per company. Optional on the
  // same terms as `claims` above — a build with no Anthropic key wires none, and every job is still
  // placed on the CV evidence alone, which is exactly the degraded case this ticket is written to
  // survive.
  lookupEmployer?: EmployerLookup,
): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    for (const block of await store.list(sessionId)) {
      if (block.kind !== "job") continue; // its CORRECTED kind — see this function's own doc
      if (block.industry.value) continue; // already answered (labeled or corrected) — never re-spent
      try {
        const feed = unmappedLabels
          ? ({ store: unmappedLabels, sessionId, source: "past_job_industry" } as const)
          : undefined;
        const { placement, degraded } = await placeJobIndustry(
          {
            employer: block.employer.value,
            title: block.title.value,
            lines: await linesFor(claims, sessionId, block.employer.value),
            // Never throws and never blocks: makeEmployerLookup turns every failure into null, and a
            // null lookup is a placement on the lines alone, not a failed job. The cache is what
            // makes this affordable — two jobs at one employer, in this upload or anyone else's,
            // cost one search between them.
            lookup: lookupEmployer ? await lookupEmployer(block.employer.value) : null,
          },
          industries,
          llm,
          feed,
        );
        // A DEGRADED answer is never stored: the stored placement is what stops this job being
        // asked again. Left unlabeled instead — reads as unmapped, and is placed for real next run.
        if (!degraded) await store.labelIndustry(sessionId, block.id, placement);
      } catch (err) {
        incrementCounter("industryLabeler.call_failed");
        console.error(
          `[ops] job-block industry placement call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // No refreshWorkedYears here, deliberately: #281 moves no number. Industry years are written by
    // #285, and this step gains the same re-derivation the family labeler has the moment they are.
  };
}
