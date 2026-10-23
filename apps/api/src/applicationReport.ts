// #315 — the application report: the five-section email that travels with the approved CV
// (#293 verdict, spec #301 "The application report"). The job in short with the apply link on top
// · where you are strong · where you are not, each with a sentence to say · be ready to explain ·
// salary, or plainly that the advert does not state one. Nothing else — the cut is the substance
// of the ruling: no audit, no checklist, no keyword coverage. The disclosure panel and the lint
// stay as capabilities feeding the screen and the export gate, never this email.
//
// Content comes from three places only: the CARD (which requirement is met, open, denied or
// unchecked — decided HERE, deterministically, from the judged verdicts and the person's own
// answers), ONE model call (the prose, the sentences, the bridges — application-report.md), and
// the ADVERT (the salary as stated, the apply link). The model writes sentences; it never grades.
//
// Two hard rules the shape enforces rather than asks for: an UNCHECKED requirement has no field
// the model can write a sentence into (#292 c15 — for an unknown there is no line to hand him),
// and a gap's sentence is nullable, so "nothing adjacent" is an honest null that the email turns
// into "expect it to come up" (#287 c12) rather than a bridge the model felt obliged to invent.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AdRequirementsV1, CandidateClaims, JobCardV1 } from "@jobcrush/contracts";
import { completeWithCost } from "./adReader.js";
import type { BroughtJob } from "./broughtJobs.js";
import type { ClaimRecord } from "./claims.js";
import type { EligibilityFact } from "./eligibility.js";
import { COVERAGE_THRESHOLD, type JudgeVerdict } from "./judge.js";
import { levelOf } from "./languageLevel.js";
import type { LlmClient } from "./llm.js";
import { extractJson } from "./miner.js";
import { marketForLocationText } from "./postingRetrieval.js";
import { conservationIssues, draftDisclosure, type Draft, type Posting, type TailorInputOpts } from "./preview.js";
import { usedStretches, type StretchCheckpoint } from "./stretchSuggestions.js";
import { advertDeniedRows } from "./tailor.js";
import type { ExportRefusal } from "./tailorExport.js";
import { findWorkRightsFact } from "./withdrawal.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "application-report.md");

let cachedPrompt: string | null = null;
export function reportPrompt(): string {
  if (!cachedPrompt) cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  return cachedPrompt;
}

/** The hard precondition (#293 finding 1): the report may not ship on an unjudged card. Measured
 *  on the same advert, the keyword-scored card opened eight gaps — "excellent international
 *  English" among them — against the judged card's one, while claiming a HIGHER percentage. A
 *  report built on that tells a fluent English speaker he cannot speak English. */
export function reportGate(card: JobCardV1): ExportRefusal | null {
  if (card.scored === "judged") return null;
  return {
    status: 409,
    code: "card_unjudged",
    message:
      "we could not score this job against your facts, so the report cannot be written — press the button again in a moment",
  };
}

/** #418: `stretched` is met by a stretch the person used for this job (ADR-0020 clause 4) — the
 *  model writes nothing for it; the app puts its line and interview line under *Be ready to explain*. */
export type RequirementState = "met" | "stretched" | "open" | "denied" | "unchecked";

export interface ReportRequirement {
  id: string;
  requirement: string;
  state: RequirementState;
  /** The fact the grader named (met: the support; open: the adjacent fact a bridge may use). */
  evidence: string | null;
  reason: string | null;
}

/**
 * The state of every advert requirement, decided by the app from what it already knows:
 *   - denied: he told us "No" (the card's askedClosed rows — nothing about it printed);
 *   - unchecked: nobody asked him either way — a years bar the card could not test, or a
 *     profile question (work rights, a language) still open on this advert (#292 c15);
 *   - met: the judged fit clears the coverage bar the card itself uses;
 *   - open: everything else.
 * Pure, in advert order; the model is handed these states and writes nothing it was not given.
 */
export function requirementStates(
  adReq: AdRequirementsV1,
  verdicts: JudgeVerdict[],
  claims: { id: string; text: string }[],
  deniedIds: ReadonlySet<string>,
  uncheckedIds: ReadonlySet<string>,
): ReportRequirement[] {
  const byId = new Map(verdicts.map((v) => [v.requirementId, v]));
  const factText = new Map(claims.map((c) => [c.id, c.text]));
  return adReq.requirements.map((r) => {
    const verdict = byId.get(r.id);
    const evidence = verdict?.supportingFactId ? (factText.get(verdict.supportingFactId) ?? null) : null;
    const state: RequirementState = deniedIds.has(r.id)
      ? "denied"
      : uncheckedIds.has(r.id)
        ? "unchecked"
        : verdict?.stretched
          ? "stretched"
          : (verdict?.fit ?? 0) >= COVERAGE_THRESHOLD
            ? "met"
            : "open";
    return { id: r.id, requirement: r.requirement, state, evidence, reason: verdict?.reason ?? null };
  });
}

/** What the route resolves BEFORE the slow press starts and hands the export job: the states, and
 *  the advert's own facts the report prints without a model (#306's link, #305's ageing line,
 *  #292 r9's market to check). The printed lines are read from the SHIPPED draft at report time
 *  (tailorExport.ts), because #314 may shorten it after the press. */
export interface ReportContext {
  requirements: ReportRequirement[];
  applicationUrl: string | null;
  ageing: string | null;
  /** #292 r9: a market he has no work-rights fact for, on an advert that does not ask — named as
   *  something to check, in prose, never scored. null when the market is known or unplaceable. */
  marketToCheck: string | null;
  /** #401: the lookup could not place the job's location, so nothing about work rights was
   *  checked — said plainly, unless the advert asks about work rights itself (then the requirement
   *  row already says "check it"). */
  locationUnplaced: boolean;
  /** #418: the stretches the person used for this job — each line as it prints and what to say if
   *  asked, exactly as stored (ADR-0005 clause 6). Printed under *Be ready to explain* by the app;
   *  the model never sees or rewrites them. Absent on a context built before #418 — read as none. */
  stretches?: { line: string; say: string }[];
}

/**
 * The context from what the route already holds. Denied = the card's own "You told me you don't
 * have this" rows (advertDeniedRows, the same mapping). Unchecked = the years bars the card could
 * not test, plus every work-rights requirement with no work-rights fact for this posting's place
 * and every language requirement whose level is still unknown — PER REQUIREMENT, not "the queue
 * still has a question": the queue asks one language per advert and asks nothing on a market it
 * cannot place, and a requirement nobody can answer is still unchecked (a "not sure yet" is not
 * a fact either). The lookups are the queue's own (findWorkRightsFact, levelOf), so "unchecked"
 * here and "still asked" there can never disagree on a fact. The market to check is #292 r9's
 * case exactly: the advert does not ask about work rights, the market is placeable, and he holds
 * no fact for it.
 */
export function reportContext(args: {
  posting: Posting;
  adReq: AdRequirementsV1;
  card: JobCardV1;
  verdicts: JudgeVerdict[];
  confirmed: ClaimRecord[];
  negatives: ClaimRecord[];
  facts: EligibilityFact[];
  broughtJob: BroughtJob | undefined;
  /** #418: the record beside this job's draft — its used suggestions feed `stretches`. */
  stretch?: StretchCheckpoint;
}): ReportContext {
  const { posting, adReq, card, confirmed, negatives, facts } = args;
  const deniedIds = new Set(advertDeniedRows(adReq, confirmed, negatives).map((d) => d.requirement.id));
  const norm = (text: string) => text.trim().toLowerCase();
  const languageKnown = (subject: string) =>
    levelOf(facts.find((f) => f.dimension === "language" && norm(f.familyId) === norm(subject))?.value) !== null;
  const workRightsKnown = findWorkRightsFact(facts, posting.location) !== null;
  const uncheckedIds = new Set([
    ...(card.notTested ?? []).map((r) => r.id),
    ...adReq.requirements
      .filter(
        (r) =>
          (r.eligibilityDimension === "work-rights" && !workRightsKnown) ||
          (r.eligibilityDimension === "language" && r.eligibilitySubject && !languageKnown(r.eligibilitySubject)),
      )
      .map((r) => r.id),
  ]);
  const market = marketForLocationText(posting.location ?? "");
  const advertAsksWorkRights = adReq.requirements.some((r) => r.eligibilityDimension === "work-rights");
  return {
    requirements: requirementStates(adReq, args.verdicts, confirmed, deniedIds, uncheckedIds),
    applicationUrl: args.broughtJob?.applicationUrl ?? null,
    ageing: args.broughtJob?.ageing ?? null,
    marketToCheck:
      market && !advertAsksWorkRights && !findWorkRightsFact(facts, posting.location) ? market : null,
    locationUnplaced: market === null && !advertAsksWorkRights,
    stretches: usedStretches(args.stretch).map((s) => ({ line: s.claimText, say: s.interviewNarrative })),
  };
}

/** The stored, emailed report. Checkpointed on the draft record (tailorDraftStore.ts) so a
 *  re-press after a failed send re-spends nothing. */
export interface ApplicationReport {
  applicationUrl: string | null;
  ageing: string | null;
  marketToCheck: string | null;
  /** Absent on a report checkpointed before #401 — read as false; the next draft writes it. */
  locationUnplaced?: boolean;
  jobInShort: string;
  salary: string | null;
  strong: { requirement: string; say: string }[];
  /** say null ⇒ nothing adjacent exists — the email says to expect it to come up, no bridge. */
  gaps: { requirement: string; say: string | null }[];
  /** Named, never scored, no prepared sentence (#292 c15). */
  unchecked: string[];
  explain: string[];
}

// A user-authored fact is free text interpolated beside this prompt's own markers — same guard
// judge.ts's sanitizeFactText applies, for the same reason: a forged marker can only ever be plain
// text INSIDE its own line, never a structurally new block. The advert keeps its lines (the model
// reads it as a document), so there a line that OPENS like a block marker loses its leading "=".
const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const noBlockMarkers = (text: string) => text.replace(/^=+/gm, "");

/** The shape of one requirement in the input — the fakes read states back off it, so the product
 *  owns the regex (CODING_STANDARDS "tests read product-owned ids and vocabulary"). */
export const REPORT_STATE_LINE = /^- id: (.+)\n  state: (\w+)/gm;

/** The one call's whole input: the advert, the requirements with their decided states, every
 *  printed line with its source facts, the held-back facts, the over-packed lines, the lint
 *  findings. Exported for the fingerprint and the tests. */
export function buildReportInput(
  ctx: ReportContext,
  posting: Posting,
  draft: Draft,
  claims: CandidateClaims,
  opts: TailorInputOpts,
): string {
  const factText = new Map(claims.claims.map((c) => [c.id, c.text]));
  const requirementLines = ctx.requirements
    .map(
      (r) =>
        `- id: ${r.id}\n  state: ${r.state}\n  requirement: ${oneLine(r.requirement)}` +
        (r.evidence ? `\n  fact: ${oneLine(r.evidence)}` : "") +
        (r.reason && r.state !== "unchecked" ? `\n  reason: ${oneLine(r.reason)}` : ""),
    )
    .join("\n");
  const printed = [
    `headline: ${oneLine(draft.headline)}`,
    ...(draft.summary ? [`summary: ${oneLine(draft.summary)}`] : []),
    ...draft.experience.flatMap((role) => [
      `${oneLine(role.role)} — ${oneLine(role.employer)}:`,
      ...role.bullets.map(
        (b) =>
          `- ${oneLine(b.text)}\n  from: ${
            // #418: a used stretch cites no fact — the person chose the line for this job.
            b.claimIds.length === 0 ? "a line the person chose to add for this job" : b.claimIds.map((id) => oneLine(factText.get(id) ?? id)).join(" | ")
          }`,
      ),
    ]),
  ].join("\n");
  const disclosure = draftDisclosure(claims, draft);
  const heldBack = disclosure.flatMap((d) => d.heldBack.map((f) => `- ${oneLine(f)}`));
  const overfull = disclosure.flatMap((d) =>
    d.overfull.map((o) => `- ${oneLine(o.text)} (${o.count} facts${o.lostResult ? ", result not in the line" : ""})`),
  );
  const usedIds = new Set(draft.experience.flatMap((r) => r.bullets.flatMap((b) => (b.stretchId ? [b.stretchId] : []))));
  const lint = conservationIssues(claims, draft, opts.jobBlocks, opts.advertTests, opts.negatives, usedIds).map(
    (issue) => `- ${oneLine(issue.message)}`,
  );
  const block = (lines: string[]) => (lines.length ? lines.join("\n") : "(none)");
  return (
    `${reportPrompt()}title: ${oneLine(posting.title)}\nemployer: ${oneLine(posting.company)}\n` +
    `location: ${oneLine(posting.location)}\n\n${noBlockMarkers(posting.excerpt.trim())}\n\n` +
    `===REQUIREMENTS===\n${requirementLines}\n\n` +
    `===PRINTED LINES===\n${printed}\n\n` +
    `===HELD BACK===\n${block(heldBack)}\n\n` +
    `===OVER-PACKED LINES===\n${block(overfull)}\n\n` +
    `===LINT FINDINGS===\n${block(lint)}\n`
  );
}

const Sentence = z.string().trim().min(1);
const ReportResponseDoc = z
  .object({
    jobInShort: Sentence,
    salary: Sentence.nullable(),
    strong: z.array(z.object({ requirementId: z.string().min(1), say: Sentence }).strict()),
    gaps: z.array(z.object({ requirementId: z.string().min(1), say: Sentence.nullable() }).strict()),
    explain: z.array(Sentence),
  })
  .strict();

/** judge.ts's verifyCoverage, for this shape: `strong` names exactly the met ids and `gaps`
 *  exactly the open + denied ids — a skipped, duplicated or invented id fails the answer (burns
 *  the one retry) rather than shipping a report silent on a requirement the advert has. An
 *  unchecked id anywhere fails too: that is the model writing the line it was told not to. */
function verifyCoverage(
  requirements: ReportRequirement[],
  doc: z.infer<typeof ReportResponseDoc>,
): Pick<ApplicationReport, "strong" | "gaps"> {
  const check = (label: string, wanted: ReportRequirement[], got: { requirementId: string }[]) => {
    const wantedIds = wanted.map((r) => r.id);
    const gotIds = got.map((g) => g.requirementId);
    if (new Set(gotIds).size !== gotIds.length) throw new Error(`${label} duplicated a requirement id`);
    const missing = wantedIds.filter((id) => !gotIds.includes(id));
    const extra = gotIds.filter((id) => !wantedIds.includes(id));
    if (missing.length || extra.length)
      throw new Error(`${label} ids don't match (missing: ${missing.join(",")}; extra: ${extra.join(",")})`);
  };
  const byId = new Map(requirements.map((r) => [r.id, r.requirement]));
  check("strong", requirements.filter((r) => r.state === "met"), doc.strong);
  check("gaps", requirements.filter((r) => r.state === "open" || r.state === "denied"), doc.gaps);
  return {
    strong: doc.strong.map((s) => ({ requirement: byId.get(s.requirementId)!, say: s.say })),
    gaps: doc.gaps.map((g) => ({ requirement: byId.get(g.requirementId)!, say: g.say })),
  };
}

export class ReportValidationError extends Error {}

/** "Cut, and staying cut: what did not print and why, what was lost, how far each line leans" —
 *  enforced, not only written. Section 4 is read in an email; an `explain` line that talks about
 *  what the CV printed or held back is the app's kitchen showing (the first real report on staging
 *  wrote "since these were not printed but are available to you" and "the printed line covers …
 *  but does not state an outcome"). One such line fails the answer and burns the retry with the
 *  words named. A tripwire for OUR phrases only — "the app you shipped", "print the weekly
 *  report" are his work and must get through (the table in applicationReport.test.ts). */
export const KITCHEN_WORDS =
  /\b(printed lines?|not printed|unprinted|held[- ]back|over-?packed|lint findings?|available to you|(?:the|your) CV (?:does|did) not|(?:the|your) CV doesn't)\b/i;
function verifyNoKitchen(explain: string[]): void {
  for (const line of explain) {
    const hit = KITCHEN_WORDS.exec(line);
    if (hit) throw new Error(`explain talks about the document, not the person's work ("${hit[0]}"): "${line}"`);
  }
}

/** "Salary … as the advert states it, never estimated" — enforced, not only written: a salary the
 *  advert's own text does not contain (whitespace aside) reads as the advert stating none. */
export function quotedFromAdvert(salary: string | null, advert: string): string | null {
  if (salary === null) return null;
  const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return squash(advert).includes(squash(salary)) ? salary : null;
}

/**
 * The one model call: input built, one attempt plus one retry with the validation error appended
 * (judgeFacts's shape), the answer gated by zod and the coverage check. Throws after a second bad
 * answer — the export job then fails with plain words and a re-press tries again, re-spending
 * nothing already checkpointed (the draft, the approval, the shortened document).
 *
 * Cost is logged per call from the driver's own usage (null, never estimated, on a driver that
 * reports none — the CLI); the ledger row the metered client writes under its own stage is the
 * measured per-application figure the release gate reads. A measured number needs a working key.
 */
export async function writeApplicationReport(
  llm: LlmClient,
  ctx: ReportContext,
  posting: Posting,
  draft: Draft,
  claims: CandidateClaims,
  opts: TailorInputOpts,
): Promise<ApplicationReport> {
  const base = buildReportInput(ctx, posting, draft, claims, opts);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? base
        : `${base}\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const { text, cost } = await completeWithCost(llm, input);
    console.log(
      `[ops] application report call: model ${cost.model}, ` +
        (cost.inputTokens === null ? "usage unmeasured" : `${cost.inputTokens} in / ${cost.outputTokens} out tokens`),
    );
    try {
      const doc = ReportResponseDoc.parse(extractJson(text));
      const { strong, gaps } = verifyCoverage(ctx.requirements, doc);
      verifyNoKitchen(doc.explain);
      return {
        applicationUrl: ctx.applicationUrl,
        ageing: ctx.ageing,
        marketToCheck: ctx.marketToCheck,
        locationUnplaced: ctx.locationUnplaced,
        jobInShort: doc.jobInShort,
        salary: quotedFromAdvert(doc.salary, posting.excerpt),
        strong,
        gaps,
        unchecked: ctx.requirements.filter((r) => r.state === "unchecked").map((r) => r.requirement),
        // #418: the used stretches lead section 4, exactly as stored — never through the model.
        explain: [...(ctx.stretches ?? []).map((s) => REPORT_LINES.stretch(s.line, s.say)), ...doc.explain],
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new ReportValidationError(`application report failed validation twice: ${lastError.slice(0, 500)}`);
}

/** The exact input the report was written from, hashed — so a re-press on an unchanged document
 *  reuses the checkpointed report and a shortened one (#314) writes a fresh one. */
export function reportFingerprint(
  ctx: ReportContext,
  posting: Posting,
  draft: Draft,
  claims: CandidateClaims,
  opts: TailorInputOpts,
): string {
  return createHash("sha256").update(buildReportInput(ctx, posting, draft, claims, opts)).digest("hex");
}

/** The plain words the email uses where the model wrote nothing — exported so the screen tests
 *  and the browser journeys read the product's own sentences rather than re-typed copies. */
export const REPORT_LINES = {
  noLink: "No apply link was saved for this job.",
  expectIt: "You have nothing close to this. Expect it to come up.",
  unchecked: "Not checked: you have not told us either way. Check it before you apply.",
  noSalary: "The advert does not state a salary.",
  market: (market: string) =>
    `This job is in ${market}. We have not checked whether you can work there — check it before you apply.`,
  locationUnknown: "Job location unknown. We have not checked whether you can work there. Check it before you apply.",
  nothingStrong: "None of the advert's requirements is covered by your facts yet.",
  nothingOpen: "Every requirement the advert states is covered.",
  nothingToExplain: "Nothing more came up to prepare.",
  checkBeforeSending: "Check before you send the CV:",
  /** #418: a stretch the person used for this job — the line as it prints, and what to say if asked. */
  stretch: (line: string, say: string) => `You chose to say "${line}" on this CV — say: "${say}"`,
};

/** The email body: five sections, in this order, and nothing else. The attachment is named in one
 *  opening line; the ship-and-tell notices (a document that left with a known loss, #313/#314)
 *  ride right under it, before section 1, so he reads them before he opens the PDF (#401). */
export function reportEmailText(
  report: ApplicationReport,
  posting: Posting,
  pages: number,
  notices: string[],
): string {
  const bullets = (lines: string[], empty: string) => (lines.length ? lines.map((l) => `- ${l}`).join("\n") : empty);
  const job = [
    report.applicationUrl ? `Apply here: ${report.applicationUrl}` : REPORT_LINES.noLink,
    `${posting.title} at ${posting.company}${posting.location ? `, ${posting.location}` : ""}.`,
    report.jobInShort,
    ...(report.ageing ? [report.ageing] : []),
  ].join("\n");
  const notYet = [
    ...report.gaps.map((g) => `${g.requirement} — ${g.say ? `say: "${g.say}"` : REPORT_LINES.expectIt}`),
    ...report.unchecked.map((u) => `${u} — ${REPORT_LINES.unchecked}`),
  ];
  const explain = [
    ...report.explain,
    ...(report.marketToCheck ? [REPORT_LINES.market(report.marketToCheck)] : []),
    ...(report.locationUnplaced ? [REPORT_LINES.locationUnknown] : []),
  ];
  const checks = notices.length
    ? `${REPORT_LINES.checkBeforeSending}\n${notices.map((n) => `- ${n}`).join("\n")}\n\n`
    : "";
  return (
    `Your CV for ${posting.title} at ${posting.company} is attached (${pages} page${pages === 1 ? "" : "s"}, PDF). ` +
    `Read it, then send it yourself when you are ready.\n\n${checks}` +
    `1. The job, in short\n${job}\n\n` +
    `2. Where you are strong\n${bullets(report.strong.map((s) => `${s.requirement} — say: "${s.say}"`), REPORT_LINES.nothingStrong)}\n\n` +
    `3. Where you are not, and what to say\n${bullets(notYet, REPORT_LINES.nothingOpen)}\n\n` +
    `4. Be ready to explain\n${bullets(explain, REPORT_LINES.nothingToExplain)}\n\n` +
    `5. Salary\n${report.salary ?? REPORT_LINES.noSalary}\n`
  );
}
