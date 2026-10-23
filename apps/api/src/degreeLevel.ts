// #416 (ADR-0020 clause 5) — a degree bar is decided by the degree held: a Master's meets a
// bachelor's, every run. This is the deterministic half of that rule: read the highest degree among
// the person's education facts on the one ladder bachelor < master < doctorate, with the common
// English and French forms (BSc/BA/Licence/Bachelor; MSc/MA/MBA/Master/Mastère/Maîtrise and an
// engineering degree, diplôme d'ingénieur, read as master; PhD/Doctorat). An unreadable degree is
// unknown, never guessed — the scorer's reading then stands (recordBars.ts, judge.ts).
//
// Only education facts are read: the claim-miner prompt's rule-8 `edu-` id prefix (the same key
// graph.ts's kindTag reads), or a line the review moved into the education section. A job line about
// "mentoring master's students" is never a degree. The bare BA/MA forms are read only before "in"/
// "of" or dotted (B.A., M.A.): "Boston, MA" is a place, not a degree.
import type { DegreeLevel } from "@jobcrush/contracts";

const RANK: Record<DegreeLevel, number> = { bachelor: 1, master: 2, doctorate: 3 };

// Highest first, so a line holding two levels ("BSc then MSc") reads as the higher one.
const FORMS: ReadonlyArray<readonly [DegreeLevel, RegExp]> = [
  ["doctorate", /\bph\.?\s?d\b|\bd\.?phil\b|\bdoctorat(?:e|es|s)?\b|\bdoctoral\b/i],
  [
    "master",
    /(?<!\bscrum\s)\bmaster(?:'s|s)?\b|\bmast[èe]re\b|\bma[îi]trise\b|\bm\.?sc\b|\bm\.?eng\b|\bmba\b|\bm\.a\.?|\bma\b(?=\s+(?:in|of)\b)|\bdipl[ôo]me d['’]ing[ée]nieur\b/i,
  ],
  ["bachelor", /\bbachelor(?:'s|s)?\b|\bb\.?sc\b|\bb\.?eng\b|\bbba\b|\bb\.a\.?|\bba\b(?=\s+(?:in|of)\b)|\blicence\b/i],
];

/** The level one education line states, or null when none of the known forms appears. */
export function readDegreeLevel(text: string): DegreeLevel | null {
  for (const [level, form] of FORMS) if (form.test(text)) return level;
  return null;
}

/** True when the degree held is at or above the bar's level — a higher degree meets a lower bar. */
export function meetsDegreeBar(held: DegreeLevel, bar: DegreeLevel): boolean {
  return RANK[held] >= RANK[bar];
}

export interface EducationFactLike {
  id: string;
  text: string;
  section?: string | null;
}

/** The highest degree among the person's education facts, or null when none reads as one. */
export function highestDegree(facts: ReadonlyArray<EducationFactLike>): DegreeLevel | null {
  let best: DegreeLevel | null = null;
  for (const fact of facts) {
    if (!(fact.id.startsWith("edu-") || fact.section === "education")) continue;
    const level = readDegreeLevel(fact.text);
    if (level !== null && (best === null || RANK[level] > RANK[best])) best = level;
  }
  return best;
}
