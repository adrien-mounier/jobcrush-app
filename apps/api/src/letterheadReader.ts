// #451 (spec #450): the letterhead reading — the model reads the person's name and city from the
// top of the CV's full text, as the CV writes them. It replaced extract.ts's shape rules
// (splitLetterhead), which traded one common letterhead for another over four QA rounds on #409.
// Email and phone stay deterministic (extract.ts's extractContact, #190).
//
// The guard below is what keeps "the machine never adds silently" (ADR-0004 clause 1a): a field is
// stored only when its source_quote is in the text the model was given and its value is that quote
// — or the quote with letter-spacing joined ("J A N E  D O E" → "JANE DOE", the one repair allowed).
// Anything else is dropped as not read, never repaired on the model's behalf.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContactFieldRead, RawCv } from "./extract.js";
import type { LlmClient } from "./llm.js";
import { extractJson } from "./miner.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "letterhead-reader.md");
/** The top of the CV's extracted text, not the deterministic letterhead slice (#444: the slice is
 *  itself a shape guess, and it is why a job bullet reached the city). */
export const LETTERHEAD_INPUT_CHARS = 2000;

let cachedPrompt: string | null = null;
function letterheadReaderPrompt(): string {
  if (!cachedPrompt) cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  return cachedPrompt;
}

export type LetterheadRead = { name?: ContactFieldRead; location?: ContactFieldRead };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
/** "J A N E  D O E" → "JANE DOE": a run of single letters separated by single spaces is one word;
 *  two or more spaces separate words. A run that is not letter-spaced is left as it is. */
const joinLetters = (s: string) =>
  s
    .split(/ {2,}|\n/)
    .map((w) => (w.split(" ").every((t) => t.length === 1) ? w.replace(/ /g, "") : w))
    .join(" ");

/** The guard: keeps a field only when the model's quote is in `text` and its value is that quote
 *  (or the quote letter-joined). Whitespace is not content — a name split over two lines is one
 *  name — so runs of it compare as one space. Dropped fields are absent, never null-filled. */
export function guardLetterheadRead(answer: unknown, text: string): LetterheadRead {
  const out: LetterheadRead = {};
  const haystack = collapse(text);
  for (const field of ["name", "location"] as const) {
    const got = (answer as Record<string, unknown> | null)?.[field] as { value?: unknown; source_quote?: unknown } | null;
    if (!got || typeof got.value !== "string" || typeof got.source_quote !== "string") continue;
    const quote = got.source_quote;
    const value = collapse(got.value);
    if (!value || !haystack.includes(collapse(quote))) continue;
    if (value !== collapse(quote) && value !== collapse(joinLetters(quote))) continue;
    out[field] = { value: got.value.trim(), sourceText: quote };
  }
  return out;
}

export async function readLetterhead(text: string, llm: LlmClient): Promise<LetterheadRead> {
  const raw = await llm.complete(`${letterheadReaderPrompt()}\n${text}\n`);
  return guardLetterheadRead(extractJson(raw), text);
}

/** Adapter for the pipeline step (main.ts wires it on the "letterhead-reading" metered client). */
export function makeReadLetterheadStep(llm: LlmClient) {
  return (rawCv: RawCv): Promise<LetterheadRead> => readLetterhead(rawCv.fullText.slice(0, LETTERHEAD_INPUT_CHARS), llm);
}
