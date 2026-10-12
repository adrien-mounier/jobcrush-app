// #382 (ADR-0018 clause 6): skills are one per item, in named groups. The miner still reads a skills
// line as one claim per group (claim-miner.md rule 8 — its recorded evals stay valid); this step
// splits each `skill-` claim after the mine and before the import persists, deterministically, so
// the person's wording is kept and nothing is re-spent. The split rule is test/skillsSplit.test.ts's
// table; in words:
//   - the top-level separator splits: line breaks or bullets first, else ";", else ",". A separator
//     one level down stays inside its item, so "Prompt engineering: structured prompting,
//     Chain-of-Thought" is one skill when ";" or a line break separates the skills around it;
//   - a "," or ";" inside brackets never splits;
//   - a label before the whole list ("Tools: Jira, Confluence") is the CV's own group name, unless
//     it is the miner's sentence lead-in ("Has skills in …", "Skills:"), which is not a skill;
//   - a skill with no label lands in FALLBACK_GROUP, so every skill has a group to be renamed or
//     moved from; "and" before the last item and the full stop after it are not wording;
//   - a line that yields one item is left exactly as it was.
// Ceiling (ponytail): a lone "Label: a, b, c" claim reads as a group — the miner emits one claim
// per group, so a lone colon list is one. The review's sections call later names the skills left in
// FALLBACK_GROUP (cvReviewRun.ts resolveSkillGroups).
import type { CandidateClaim } from "@jobcrush/contracts";
import { slug } from "./discovery.js";

/** The group of a skill the CV gave no label to. */
export const FALLBACK_GROUP = "Skills";

export type SkillClaim = CandidateClaim & { groupName: string };

const LEAD_IN = /^(?:(?:has|have|with)\s+)?(?:skills?|skilled|proficien(?:t|cy)|experienced?|expertise|competenc(?:e|es|ies|y)|knowledge)(?:\s+(?:in|with|of|includ(?:e|es|ing)))?\s*:?\s*/i;
const BULLET = /^\s*[-*•▪‣·]\s+/;
const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Splits on `sep` outside brackets. */
function splitOutsideBrackets(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (BRACKETS[ch]) depth++;
    else if (Object.values(BRACKETS).includes(ch) && depth > 0) depth--;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

const clean = (items: string[]): string[] =>
  items
    .map((s) => s.replace(BULLET, "").trim().replace(/^(?:and|&)\s+/i, ""))
    .filter((s) => s.length > 0);

export function splitSkillText(text: string): { group: string | null; items: string[] } {
  const original = text.trim();
  let rest = original;
  let group: string | null = null;
  // A label before the whole list: short, no separator inside it, followed by the list.
  const labelled = /^([^:;,\n]{1,60}):\s*([\s\S]+)$/.exec(rest);
  if (labelled) {
    const label = labelled[1]!.trim();
    rest = labelled[2]!;
    group = `${label}:`.replace(LEAD_IN, "") === "" ? null : label;
  } else rest = rest.replace(LEAD_IN, "");
  const lines = clean(rest.split(/\r?\n/));
  let items: string[];
  if (lines.length > 1) items = lines;
  else if (rest.includes(";")) items = clean(splitOutsideBrackets(rest, ";"));
  else items = clean(splitOutsideBrackets(rest, ","));
  if (items.length > 1) items[items.length - 1] = items[items.length - 1]!.replace(/\.$/, "");
  // One item: the line was one skill all along — its wording stays exactly as read.
  if (items.length <= 1 && group === null) return { group: null, items: [original] };
  return { group, items };
}

/** The group a stored skill reads under: its own, or the fallback for a skill stored without one
 *  (stored before #382, or added by a door that names none). */
export const groupOf = (claim: { groupName: string | null }): string => claim.groupName ?? FALLBACK_GROUP;

/** A section's skills as named groups, in the order each group first appears (CV order).
 *  ponytail: no stored group order — moving a group's first skill into another group can move that
 *  group up the list. A position column on the group lands when someone reorders groups. */
export function skillGroups(claims: ReadonlyArray<{ id: string; groupName: string | null }>): Array<{ name: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const c of claims) groups.set(groupOf(c), [...(groups.get(groupOf(c)) ?? []), c.id]);
  return [...groups].map(([name, ids]) => ({ name, ids }));
}

/** One claim per skill in place of each `skill-` claim; every other claim passes through untouched. */
export function splitSkillClaims(claims: CandidateClaim[]): Array<CandidateClaim | SkillClaim> {
  return claims.flatMap((claim) => {
    if (!claim.id.startsWith("skill-")) return [claim];
    const { group, items } = splitSkillText(claim.text);
    const groupName = group ?? FALLBACK_GROUP;
    if (items.length === 1 && items[0] === claim.text) return [{ ...claim, groupName }];
    // The suffix is the item's own slug — the same on a re-upload, so a decision made on "Jira"
    // finds "Jira" again (importReconciliation keys on semantic_key); a repeat or an empty slug
    // (another script) takes the item's position instead.
    const taken = new Set<string>();
    return items.map((text, i) => {
      const s = slug(text);
      const suffix = s && !taken.has(s) ? s : `${s ? `${s}-` : ""}${i + 1}`;
      taken.add(suffix);
      return { ...claim, id: `${claim.id}-${suffix}`, semantic_key: `${claim.semantic_key}-${suffix}`, text, groupName };
    });
  });
}
