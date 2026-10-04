// #163 / ADR-0002 clause 3 — a confirmed sentence a correction contradicts is held aside, never
// rewritten. Lives beside the claims subsystem it operates on (the route entry stays thin).
import type { DecisionKey, HeldSentence } from "@jobcrush/contracts";
import type { ClaimStore } from "./claims.js";

// The printable form(s) a decision value can take inside a person's own prose, used to find
// confirmed sentences a correction contradicts. Mechanical and deliberately narrow: string values
// match as case-insensitive substrings (4+ chars, so a short generic word can't sweep half the
// CV), date values match by their year.
// ponytail: substring matching, no NLP — a sentence saying "two years" against a corrected date
// range is invisible to this; upgrade to a model-read contradiction check if this misses too much.
const printableForms = (value: unknown): string[] => {
  if (typeof value === "string") return value.trim().length >= 4 ? [value.trim()] : [];
  if (value && typeof value === "object") {
    const v = value as { year?: number; state?: string; date?: { year?: number } };
    if (typeof v.year === "number") return [String(v.year)];
    if (v.state === "ended" && typeof v.date?.year === "number") return [String(v.date.year)];
  }
  return [];
};

const printable = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { year?: number; month?: number | null; state?: string; date?: { year?: number } };
    if (typeof v.year === "number") return v.month ? `${v.month}/${v.year}` : String(v.year);
    if (v.state === "ongoing") return "ongoing";
    if (v.state === "ended" && typeof v.date?.year === "number") return String(v.date.year);
  }
  return String(value);
};

/** ADR-0002 clause 3 — a confirmed sentence that still carries the value a correction superseded is
 *  held aside (reopened, so it leaves the confirmed set and never prints beside the corrected fact)
 *  and the person gets a precise question. The sentence itself is NEVER rewritten or deleted; it
 *  returns the moment they answer (re-confirm in the deck). */
export async function holdContradictingSentences(
  claims: ClaimStore,
  sessionId: string,
  key: DecisionKey,
  supersededValue: unknown,
  correctedValue: unknown,
): Promise<HeldSentence[]> {
  const forms = printableForms(supersededValue);
  if (forms.length === 0) return [];
  const held: HeldSentence[] = [];
  // #335: every confirmed line, ticked or kept — confirmed() is the print gate and skips a kept line,
  // which would then bring the superseded value back onto the CV the moment it is re-ticked.
  for (const claim of (await claims.list(sessionId)).filter((c) => c.decision === "confirmed")) {
    const hit = forms.find((f) => claim.text.toLowerCase().includes(f.toLowerCase()));
    if (!hit) continue;
    await claims.reopen(sessionId, claim.id);
    held.push({
      id: claim.id,
      text: claim.text,
      question:
        `You corrected this job's ${key} to "${printable(correctedValue)}", and this sentence still says ` +
        `"${hit}": "${claim.text}". Does the sentence need updating, or does "${hit}" measure something ` +
        `else? It will return to your CV as soon as you answer.`,
    });
  }
  return held;
}
