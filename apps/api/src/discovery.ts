// #16 discovery (screen 1a) — the answer→CV-line→section-bar core loop, server side.
//
// The screen is a pure function of persisted state (spec story #76: answers persist server-side from
// question 1, never localStorage). This module holds the pure helpers the routes call:
//   - composeCvLine / composeRoleLine — cheap, deterministic CV text from an answer (spec §8.2:
//     "composed cheaply from my answer, polished later" — a later audit pass rewrites; prior art
//     grill.ts's answerToClaim, which composes claim text locally the same way).
//   - resolveFamily / parseCity — the family-placement + city stubs (the real family classifier is a
//     clustering model, out of scope — spec "the flow uses a hand list stand-in"). Behind functions so
//     E5 can replace the producer, exactly like e5stub.ts's loadFamilyFloor.
//   - discoveryState — rebuilds the whole DiscoveryState from the session's role + its recorded
//     discovery answers (confirmed positives + negatives), so GET /discovery resumes with no client state.
import type { FloorItem, CvSection } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import { loadFamilyFloor } from "./e5stub.js";

export const CV_SECTIONS = ["summary", "experience", "skills", "education"] as const;

// A discovery answer is persisted as a claim under this deterministic id, so answered-tracking and
// resume derive from the store alone (item answered ⇔ a `discovery-<itemId>` claim exists).
export const DISCOVERY_PREFIX = "discovery-";
export const discoveryClaimId = (itemId: string) => `${DISCOVERY_PREFIX}${itemId}`;
export const itemIdOf = (claimId: string) => claimId.slice(DISCOVERY_PREFIX.length);
export const isDiscoveryClaim = (claimId: string) => claimId.startsWith(DISCOVERY_PREFIX);

// --- the E5 family-placement stub (hand stand-in; one family for now, like sample-family-floors.json) ---
const STUB_FAMILY = "IT Project Manager";
const KIN_TITLES = [
  "IT project manager",
  "programme manager",
  "delivery manager",
  "project lead",
  "PMO lead",
];
// A hand "jobs open" count per family — E5/the real market feed replaces this producer (spec §carried
// risks: the count is stubbed behind the contract). One number is the whole promise (spec §7).
const STUB_COUNT: Record<string, number> = { [STUB_FAMILY]: 142 };

/** Q1 free text → its job family + the kin titles we search ("same kind of job"). A title that matches
 *  nothing is still placed (spec story #16: accepted in silence) — the stub always returns the family. */
export function resolveFamily(text: string): { family: string; suggestions: string[] } {
  return { family: STUB_FAMILY, suggestions: text.trim() ? KIN_TITLES : [] };
}

/** The visitor's city, lifted from Q1 for free (spec story #20: the promise carries my city). "…in Paris"
 *  → "Paris"; none → null. Deliberately simple — Q1 is free text, not a structured field. */
export function parseCity(text: string): string | null {
  const m = text.match(/\bin\s+(\p{Lu}[\p{L}-]+(?:\s+\p{Lu}[\p{L}-]+)?)/u);
  return m?.[1] ?? null;
}

export function promiseCount(family: string): number | null {
  return STUB_COUNT[family] ?? null;
}

/** The CV's lead line — the role the visitor typed is the first line on the page (spec story #18: never
 *  ask their name; the role line leads). First clause of Q1, cleaned. */
export function composeRoleLine(role: string): string {
  const head = (role.split(/[,.;]/)[0] ?? role).trim() || role.trim();
  return head.charAt(0).toUpperCase() + head.slice(1);
}

const stripAnswerLead = (answer: string) => answer.replace(/^(yes|no)\b[,\s]*/i, "").trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A cheap, deterministic CV line from a floor answer. Not grammatically perfect by design — the spec
 *  wants it instant and unpolished, with a later audit pass doing the rewrite (§8.2). Three shapes:
 *    - a free-text item (no options): the answer IS the line (the visitor's own words, e.g. a headline).
 *    - a "Which/What X …?" item: "X: <answer>".
 *    - a "Have you / Do you …?" item: "<verb phrase> — <qualifier>." (dash form, like answerToClaim). */
export function composeCvLine(item: FloorItem, answer: string): string {
  const trimmed = answer.trim();
  if (item.options.length === 0) return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;

  const qualifier = stripAnswerLead(answer);
  if (/^(which|what)\b/i.test(item.question)) {
    const noun = item.question
      .replace(/^(which|what)\s+/i, "")
      .replace(/\b(have|do|did|are|were)\s+you\b.*$/i, "")
      .replace(/[?.]+$/, "")
      .trim();
    return `${cap(noun)}: ${qualifier || trimmed}.`;
  }
  const verbPhrase = item.question
    .replace(/^(have you|do you|did you|are you|were you|can you|could you)\b/i, "")
    .replace(/[?.]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const stem = cap(verbPhrase);
  return qualifier ? `${stem} — ${qualifier}.` : `${stem}.`;
}

// --- the DiscoveryState the screen renders (the pinned contract shared with the web client) ---

export interface DiscoveryQuestion {
  itemId: string;
  question: string;
  options: string[];
  cvSection: CvSection;
}
export interface DiscoveryCvLine {
  itemId: string; // "role" for the lead line, else the floor item id
  section: CvSection;
  text: string;
}
export interface DiscoveryPromise {
  family: string;
  city: string | null;
  count: number | null;
}
export interface DiscoveryState {
  stage: "discovery";
  role: string | null;
  family: string | null;
  city: string | null;
  promise: DiscoveryPromise | null;
  questions: DiscoveryQuestion[];
  railFill: Record<CvSection, number>;
  essentialRemaining: number;
  cvLines: DiscoveryCvLine[];
}

const emptyRail = (): Record<CvSection, number> =>
  ({ summary: 0, experience: 0, skills: 0, education: 0 });

const toQuestion = (i: FloorItem): DiscoveryQuestion => ({
  itemId: i.id,
  question: i.question,
  options: i.options,
  cvSection: i.cvSection,
});

/** Discovery asks the leading bands (essential + standard); nice-to-have never gates the deck or the
 *  bars (spec: "the essential band alone is the discovery gate"). */
const asked = (i: FloorItem) => i.rankBand === "essential" || i.rankBand === "standard";

/** Rebuild the whole screen state from persisted facts. `role` is the Q1 text (null before Q1);
 *  `confirmed`/`negatives` are this session's recorded answers. Pure + deterministic → GET resumes. */
export function discoveryState(
  role: string | null,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): DiscoveryState {
  if (!role) {
    return {
      stage: "discovery",
      role: null,
      family: null,
      city: null,
      promise: null,
      questions: [],
      railFill: emptyRail(),
      essentialRemaining: 0,
      cvLines: [],
    };
  }

  const { family } = resolveFamily(role);
  const city = parseCity(role);
  const floor = loadFamilyFloor(family).items;
  const byId = new Map(floor.map((i) => [i.id, i]));

  // An item is answered by EITHER a positive or a "no" (both close it). Positives also carry a CV line.
  const positives = confirmed.filter((c) => isDiscoveryClaim(c.id));
  const answeredIds = new Set(
    [...positives, ...negatives.filter((c) => isDiscoveryClaim(c.id))].map((c) => itemIdOf(c.id)),
  );

  const questions = floor.filter(asked).filter((i) => !answeredIds.has(i.id)).map(toQuestion);

  // rail fill: per section, the share of that section's asked (essential+standard) items answered.
  const railFill = emptyRail();
  for (const section of CV_SECTIONS) {
    const inSection = floor.filter((i) => asked(i) && i.cvSection === section);
    if (inSection.length === 0) continue;
    const done = inSection.filter((i) => answeredIds.has(i.id)).length;
    railFill[section] = done / inSection.length;
  }

  const essential = floor.filter((i) => i.rankBand === "essential");
  const essentialRemaining = essential.filter((i) => !answeredIds.has(i.id)).length;

  // cvLines: the role lead line, then each answered positive's line, in the floor's rank order.
  const cvLines: DiscoveryCvLine[] = [
    { itemId: "role", section: "summary", text: composeRoleLine(role) },
  ];
  for (const i of floor) {
    const claim = positives.find((c) => itemIdOf(c.id) === i.id);
    if (claim) cvLines.push({ itemId: i.id, section: i.cvSection, text: claim.text });
  }

  return {
    stage: "discovery",
    role,
    family,
    city,
    promise: { family, city, count: promiseCount(family) },
    questions,
    railFill,
    essentialRemaining,
    cvLines,
  };
}

/** True only for a BARE "no" — it closes the item but adds nothing to the CV (persisted as a negative
 *  via #13's answerNegative). A hedged option like "No, but a related certification" is NOT a "no": it
 *  asserts a real fact, so it must fall through to composeCvLine and be conserved (never dropped as a
 *  negative — CLAUDE.md conservation). The full "no" treatment — asked-and-closed, correction — is #18. */
export function isNoAnswer(answer: string): boolean {
  return /^no[.!]?$/i.test(answer.trim());
}
