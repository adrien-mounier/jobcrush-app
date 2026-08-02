// #105 (E5 slice 4) — the five vocabulary-coincidence failure CLASSES from #86/#105's Problem
// Statement table, as two parallel row sets.
//
// *** READ THIS BEFORE USING EITHER SET — round-3 review finding: prompt contamination ***
// CANONICAL_REGRESSION_ROWS below are the ticket's own measured artefact — the "old scorer" column
// in each note is the actual band-weighted token-overlap score matchtick.ts produces for that exact
// pair — and slice 9's measurement harness wants them kept as the historical record. But all five of
// them ALSO appear, close to verbatim, as WORKED EXAMPLES inside apps/api/prompts/card-judge.md
// (its "own phrasing counts" / "shared words" / "writing about" / "a stated bar" bullets, and the
// residential-tower-construction paragraph, complete with the target band "partially — never fully").
// A model judged against these rows has already been shown the answer in its own instructions — that
// makes them USELESS for certifying that a real model judges correctly, however useful they remain
// as a plumbing fixture and as the ticket's historical record. NEVER use CANONICAL_REGRESSION_ROWS to
// certify live judgement quality (judge.live.test.ts must not import it for that purpose).
//
// HOLD_OUT_REGRESSION_ROWS covers the SAME five failure classes, deliberately in a different domain
// (warehouse/retail/food-safety operations, not IT project management) with wording that appears
// NOWHERE in card-judge.md. This is what judge.live.test.ts certifies against — it is the only set
// that can actually fail when judging is wrong.
//
// Do NOT "fix" the contamination by weakening the prompt's worked examples — they're doing real work
// steering the model (#105 review round 3 explicitly rejected that trade). The fix is uncontaminated
// test data, not a weaker prompt.
//
// Three consumers, never re-deriving these rows:
//   - judgeCards.test.ts drives CANONICAL_REGRESSION_ROWS through the real HTTP boundary against a
//     SCRIPTED fake judge. This is a PLUMBING test only: it proves a scripted verdict turns into the
//     right card shape (matchPct, dontYet, breakdown) — it CANNOT show the real model judges these
//     rows correctly (it never calls a model), and it cannot fail no matter how good or bad real
//     judgement is, since the verdict is scripted from `expected` in the first place.
//   - judge.live.test.ts (skipped unless ANTHROPIC_API_KEY is set — never part of the default,
//     network-free, paid-free suite) drives HOLD_OUT_REGRESSION_ROWS through the real judgeFacts() +
//     a real model call — the only place either row set is actually certified against live judgment.
export interface JudgeRegressionRow {
  id: string;
  label: string;
  /** The advert's own requirement text. */
  requirement: string;
  /** The candidate's evidence, in their own words — never the advert's wording. */
  evidence: string;
  /** The verdict a meaning-aware judge must reach. "covered": fit at or near 1. "not-covered": fit
   *  at or near 0 (no real support, or evidence of the wrong thing). "partial": real but incomplete
   *  support — genuinely between the two, never a coin flip toward either end. */
  expected: "covered" | "not-covered" | "partial";
  /** What the OLD token-overlap scorer got wrong here, and why — ties each row back to #86/#105's
   *  measured Problem Statement table. */
  note: string;
}

// PROMPT-CONTAMINATED — plumbing fixture + historical record ONLY. See the file header. Every
// evidence string here (and the construction row's requirement + target band) is quoted or closely
// paraphrased inside card-judge.md's own worked examples.
export const CANONICAL_REGRESSION_ROWS: JudgeRegressionRow[] = [
  {
    id: "years-bar-shortfall",
    label: "a stated years bar the candidate falls well short of",
    requirement: "8+ years of IT experience including 5+ years as a Project Manager",
    evidence: "3 years experience as a Project Manager, managing small internal IT projects.",
    expected: "not-covered",
    note: 'Old scorer: 100% — digits are stripped before comparing, so "3 years" and "8+ years" read as an identical match.',
  },
  {
    id: "own-phrasing-counts",
    label: "the candidate's own phrasing of the same underlying work",
    requirement: "Coordinate business and technical stakeholders across all project phases",
    evidence: "Ran weekly steering meetings with the CFO and the engineering leads.",
    expected: "covered",
    note: "Old scorer: 0% — zero shared vocabulary, even though the evidence describes exactly the requirement's own meaning.",
  },
  {
    id: "shared-words-different-task",
    label: "shared words describing an unrelated task",
    requirement: "Coordinate business and technical stakeholders across all project phases",
    evidence: "Coordinated the office relocation across all phases with business stakeholders.",
    expected: "not-covered",
    note: "Old scorer: 100% — near-total token overlap with the requirement, despite describing an office move, not project delivery.",
  },
  {
    id: "wrote-about-vs-did",
    label: "having written ABOUT a subject, not having done it",
    requirement: "Coordinate business and technical stakeholders across all project phases",
    evidence: "Wrote a blog post about coordinating business and technical stakeholders.",
    expected: "not-covered",
    note: "Old scorer: 100% — token overlap can't distinguish authoring content about a subject from doing the subject.",
  },
  {
    id: "different-domain-delivery",
    label: "real delivery leadership, in a domain the requirement doesn't ask for",
    requirement: "Lead end-to-end delivery of enterprise software projects",
    evidence: "Led end-to-end delivery of a residential tower construction project.",
    expected: "partial",
    note: "Old scorer: 100% — token overlap treats construction delivery as identical to enterprise-software delivery; it transfers partially, not fully.",
  },
];

/** @deprecated Use CANONICAL_REGRESSION_ROWS (plumbing/historical) or HOLD_OUT_REGRESSION_ROWS (live
 *  certification) explicitly — this alias exists only so nothing silently breaks; do not add new
 *  uses. Kept equal to CANONICAL_REGRESSION_ROWS since every pre-existing caller used it as such. */
export const JUDGE_REGRESSION_ROWS = CANONICAL_REGRESSION_ROWS;

// UNCONTAMINATED — the same five failure classes, in a different domain (warehouse/retail/food-safety
// operations, not IT project management), with wording that appears nowhere in card-judge.md. This is
// what actually certifies live judgement quality.
export const HOLD_OUT_REGRESSION_ROWS: JudgeRegressionRow[] = [
  {
    id: "years-bar-shortfall-holdout",
    label: "a stated years bar the candidate falls well short of (hold-out domain)",
    requirement: "Minimum 6 years of warehouse operations management experience",
    evidence: "18 months running the night shift at a regional distribution center.",
    expected: "not-covered",
    note: "Uncontaminated pair for the years-bar-shortfall class — a real, sizeable shortfall against a stated bar, in wording the prompt has never seen.",
  },
  {
    id: "own-phrasing-counts-holdout",
    label: "the candidate's own phrasing of the same underlying work (hold-out domain)",
    requirement: "Maintain compliance with food safety regulations across all storage areas",
    evidence: "Ran the weekly HACCP walkthroughs myself and signed off every cold-chain temperature log.",
    expected: "covered",
    note: "Describes the requirement's own meaning (regulatory food-safety compliance work) without using the words 'compliance' or 'regulations' at all.",
  },
  {
    id: "shared-words-different-task-holdout",
    label: "shared words describing an unrelated task (hold-out domain)",
    requirement: "Maintain compliance with food safety regulations across all storage areas",
    evidence: "Maintained the break room fridge and reorganized the storage areas for staff snacks.",
    expected: "not-covered",
    note: "Shares 'maintained' and 'storage areas' with the requirement while describing an entirely different, non-regulatory task.",
  },
  {
    id: "wrote-about-vs-did-holdout",
    label: "having written ABOUT a subject, not having done it (hold-out domain)",
    requirement: "Lead root-cause investigations after a safety incident",
    evidence: "Wrote an internal newsletter article summarizing how root-cause investigations are typically run after a safety incident.",
    expected: "not-covered",
    note: "Evidence of writing about the process, not of having led one.",
  },
  {
    id: "different-domain-delivery-holdout",
    label: "real, related experience at a smaller scale than the requirement asks for (hold-out domain)",
    requirement: "Manage inventory accuracy across a multi-site retail chain",
    evidence: "Managed inventory accuracy for a single independent bookstore's back-room stock.",
    expected: "partial",
    note: "Real inventory-management skill that transfers partially, not fully, to a multi-site chain's scale.",
  },
];
