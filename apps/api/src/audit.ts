// S2 decision #6 — the audit. The LLM re-reads the finished root CV against the cv-brain wording
// rules (prompts/root-cv-audit.md) and polishes phrasing; the mechanical gate certifies AFTER it.
// Same shape as the grill (grill.ts): the LLM only rewords, mechanics decide — and it is never
// allowed to take the build down or to change a fact:
//   - user-authored bullets (deck edits, grill answers) are never sent: the user's own words are
//     the truth mechanism, not an AI tell to polish away;
//   - per-bullet guards: every number must survive exactly, no forbidden glyphs, non-empty —
//     a violating polish falls back to that bullet's original text;
//   - any failure (LLM down, bad JSON, wrong count) returns the unaudited CV unchanged.
// Trace nodeIds are untouched, so the gate's trace-to-confirmed check holds on the audited CV.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmClient } from "./llm.js";
import { markdownFromEntries, type RootCv } from "./rootcv.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "root-cv-audit.md");

let cachedPrompt: string | null = null;
function auditPrompt(): string {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

/** Polishes every bullet in one LLM round trip; the caller guards + falls back per bullet. */
export type CvAuditor = (bullets: Array<{ i: number; section: string; text: string }>) => Promise<string[]>;

export function makeCvAuditor(llm: LlmClient): CvAuditor {
  return async (bullets) => {
    const raw = await llm.complete(`${auditPrompt()}\n${JSON.stringify(bullets)}\n`);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end <= start) throw new Error("no JSON array in audit output");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== bullets.length || !parsed.every((s) => typeof s === "string")) {
      throw new Error("audit output did not match the bullets");
    }
    return parsed as string[];
  };
}

// The mechanical no-new-facts guard: the polished bullet must carry exactly the same numbers
// (metrics, dates, budgets) as the original — added or dropped figures reject the polish.
const numbersOf = (s: string) =>
  (s.match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join("|");
const FORBIDDEN_GLYPHS = /[—–…|]/;

/**
 * Audit a rendered root CV. `skipIds`: claim ids whose bullets are user-authored — never sent to
 * the model, never changed. Returns the audited CV; on ANY failure returns `cv` unchanged.
 */
export async function auditRootCv(cv: RootCv, auditor: CvAuditor, skipIds: ReadonlySet<string>): Promise<RootCv> {
  const targets = cv.trace.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.nodeIds.some((id) => skipIds.has(id)));
  if (targets.length === 0) return cv;

  let polished: string[];
  try {
    polished = await auditor(targets.map(({ e, i }) => ({ i, section: e.section, text: e.bullet })));
  } catch {
    return cv; // the model is never allowed to take the build down
  }
  if (polished.length !== targets.length) return cv;

  const entries = cv.trace.entries.map((e) => ({ ...e }));
  targets.forEach(({ i }, t) => {
    const entry = entries[i];
    const next = polished[t]?.trim() ?? "";
    if (!entry || next.length === 0) return;
    if (numbersOf(next) === numbersOf(entry.bullet) && !FORBIDDEN_GLYPHS.test(next)) entry.bullet = next;
  });

  return { markdown: markdownFromEntries(entries), trace: { ...cv.trace, entries } };
}
