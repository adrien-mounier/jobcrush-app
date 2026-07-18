// JC-24 the grill — gap-filling only (s2-kickoff decision 4). After the deck confirms facts, we look
// for HOLES the confirmed set leaves and ask ~5 short, skippable questions. Detection is mechanical
// and deterministic (this file); the LLM only *phrases* (makeGrillPhraser), and templates are the
// always-available fallback so the grill is never down because the model is.
//
// v1 leans on signals the miner already computes (prompts/claim-miner.md rule 4): a claim gets
// `needs_grill` + a `grill_hint` when it lacks a metric/scope/evidence or was inferred, and a
// `MinedRole` carries `dates_missing`. So we detect two gap types — one per undated role, one per
// flagged claim — rather than re-deriving them with brittle regex. Answers become confirmed,
// user-authored claims immediately (the deck stays the truth mechanism; the grill never re-verifies).
import type { CandidateClaim, MinedRole } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import type { LlmClient } from "./llm.js";

export type GapType = "missing-dates" | "needs-info";

/** A hole in the confirmed set worth one question. Deterministic id so answers can be routed back. */
export interface Gap {
  id: string;
  type: GapType;
  role: string; // stamped on the answer claim so it renders in the right CV section
  // missing-dates:
  employer?: string;
  title?: string;
  // needs-info:
  claimText?: string;
  hint?: string | null;
}

const DEFAULT_MAX = 5; // s2-kickoff: hard cap ~5–8 questions. Dates rank first, so P1 always survives.

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";

/**
 * Pure, deterministic gap detection over the CONFIRMED claims + the miner's roles.
 * P1 — one gap per undated role that still has a confirmed claim (rejecting a whole role drops it).
 * P2 — one gap per `needs_grill` claim, EXCEPT claims in a role we already ask dates for (don't
 *      pile two questions on one role). Same input → same gaps in the same order.
 */
export function detectGaps(
  confirmed: ClaimRecord[],
  roles: MinedRole[],
  opts: { max?: number } = {},
): Gap[] {
  const max = opts.max ?? DEFAULT_MAX;
  const nonProfile = confirmed.filter((c) => c.role !== "profile");
  const inRole = (role: string, employer: string) =>
    role.toLowerCase().includes(employer.toLowerCase());

  const dateGaps: Gap[] = [];
  const datedEmployers: string[] = [];
  for (const r of roles) {
    if (!r.dates_missing) continue;
    if (!nonProfile.some((c) => inRole(c.role, r.employer))) continue; // no confirmed claim → skip
    const claimRole = nonProfile.find((c) => inRole(c.role, r.employer))!.role;
    dateGaps.push({
      id: `gap-dates-${slug(r.employer)}`,
      type: "missing-dates",
      role: claimRole,
      employer: r.employer,
      title: r.title,
    });
    datedEmployers.push(r.employer.toLowerCase());
  }

  const infoGaps: Gap[] = [];
  for (const c of confirmed) {
    if (!c.needs_grill) continue;
    if (c.role !== "profile" && datedEmployers.some((e) => c.role.toLowerCase().includes(e))) continue;
    infoGaps.push({
      id: `gap-info-${c.id}`,
      type: "needs-info",
      role: c.role,
      claimText: c.text,
      hint: c.grill_hint,
    });
  }

  return [...dateGaps, ...infoGaps].slice(0, max); // P1 (dates) first, then P2 in CV order, capped
}

/** The always-available fallback phrasing. Asks about the CV entry, never judges the person. */
export function templateQuestion(g: Gap): string {
  if (g.type === "missing-dates") {
    return `What dates did you hold the ${g.title} role at ${g.employer}? Roughly is fine.`;
  }
  return `Anything to add to "${g.claimText}"? A number, a result, or a specific detail helps.`;
}

/** A skippable answer → a confirmed, user-authored claim (idempotent per gap: re-answering overwrites). */
export function answerToClaim(g: Gap, answer: string): CandidateClaim {
  const text =
    g.type === "missing-dates" ? `${g.title} at ${g.employer}: ${answer}` : `${g.claimText} — ${answer}`;
  return {
    id: `grill-${slug(g.id)}`,
    role: g.role,
    text,
    machine_touch: "verbatim", // the user typed it
    classification: "Verified", // user-authored, they vouch for it
    source_quote: answer.slice(0, 200),
    needs_grill: false, // answered — never re-flag
    grill_hint: null,
  };
}

/** Phrases every gap in one LLM round trip; caller falls back to templates on any failure. */
export type GrillPhraser = (gaps: Gap[]) => Promise<string[]>;

export function makeGrillPhraser(llm: LlmClient): GrillPhraser {
  return async (gaps) => {
    const items = gaps.map((g, i) => ({
      i,
      about:
        g.type === "missing-dates"
          ? `the dates of the "${g.title}" role at "${g.employer}"`
          : `the CV line "${g.claimText}"${g.hint ? ` (the CV is missing: ${g.hint})` : ""}`,
    }));
    const prompt =
      `Rephrase each item below as ONE short, warm question that fills a gap in a CV. Rules: ask about ` +
      `the CV entry, NEVER judge the person or their choices (never "why is there a gap"); one sentence; ` +
      `no preamble. Return ONLY a JSON array of strings, same order, one per item.\n\n` +
      JSON.stringify(items);
    const raw = await llm.complete(prompt);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end <= start) throw new Error("no JSON array in phraser output");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== gaps.length || !parsed.every((q) => typeof q === "string" && q.trim())) {
      throw new Error("phraser output did not match the gaps");
    }
    return parsed as string[];
  };
}
