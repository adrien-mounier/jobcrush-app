// #419 (ADR-0020 clause 4, second row; ADR-0005 clause 5 as amended; ADR-0008; ADR-0018 clause 9) —
// "It's true: keep it on my CV for every job". The person states the suggested line as their own
// fact: it joins the master CV as a confirmed line the person said (ADR-0008 *asked*), under the job
// it was suggested for — that job's employer and title as written, the role the profile heads the
// job's block with — or in the suggestion's skills group, tagged "Added while tailoring for <job>"
// (#387). It is written on the tap only, and Undo takes it off again.
import type { StretchProposalV2 } from "@jobcrush/contracts";
import type { ClaimRecord, ClaimStore, SeedClaim } from "./claims.js";
import { ABOUT_YOU_HEADING } from "./cvReview.js";
import type { Draft, Posting } from "./preview.js";
import { SECTIONS } from "./rootcv.js";
import { usedStretches, type StretchCheckpoint } from "./stretchSuggestions.js";
import type { TailorDraftRecord, TailorDraftStore } from "./tailorDraftStore.js";

/** The id an "It's true" line is written under — a tailor id (tailor.ts isTailorClaimId), so the
 *  posting search never reads a fact added while tailoring as new search evidence, and the job
 *  being tailored stays found (postingRetrieval.ts). */
export const statedClaimId = (proposalId: string): string => `tailor-${proposalId}`;

const isStated = (s: StretchProposalV2 | undefined): s is StretchProposalV2 =>
  s?.state === "approved" && s.scope === "every-job";
const suggestion = (checkpoint: StretchCheckpoint | undefined, id: string) =>
  checkpoint?.status === "ran" ? checkpoint.suggestions.find((s) => s.id === id) : undefined;

/** The role one draft job has on the master CV: a line the draft cites under it (the employer and
 *  title as the CV wrote them), else a line whose role names its employer (the join
 *  draftDisclosure makes), else the draft's own employer and title. */
function jobRole(role: Draft["experience"][number], confirmed: ClaimRecord[]): string {
  const cited = new Set([...role.bullets.flatMap((b) => b.claimIds), ...role.unprinted]);
  const employer = role.employer.trim().toLowerCase();
  const jobLines = confirmed.filter((c) => c.role !== "profile");
  const line =
    jobLines.find((c) => cited.has(c.id)) ?? (employer ? jobLines.find((c) => c.role.toLowerCase().includes(employer)) : undefined);
  return line?.role ?? `${role.employer} — ${role.role}`;
}

/** The master CV line for one suggestion, and the heading it is kept under (the profile's own). */
function statedLine(
  s: StretchProposalV2,
  draft: Draft,
  confirmed: ClaimRecord[],
  posting: Posting,
): { claim: SeedClaim; group: string | null; under: string } {
  const id = statedClaimId(s.id);
  const base = {
    id,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
    text: s.claimText,
    machine_touch: "verbatim" as const, // the person's own statement — the tap is the warrant
    classification: "Verified" as const,
    source_quote: s.claimText.slice(0, 200),
    needs_grill: false,
    grill_hint: null,
    addedFor: `${posting.title} at ${posting.company}`,
  };
  if (s.slot.kind === "bullet") {
    // The slot is one the draft prints (gateSuggestions dropped every other).
    const under = jobRole(draft.experience[s.slot.role]!, confirmed);
    return { claim: { ...base, role: under }, group: null, under };
  }
  if (s.slot.kind === "skill")
    return {
      claim: { ...base, role: "profile", section: "skill" },
      group: draft.skills[s.slot.group]?.label ?? null,
      under: SECTIONS.find(([tag]) => tag === "skill")![1],
    };
  return { claim: { ...base, role: "profile" }, group: null, under: ABOUT_YOU_HEADING };
}

/**
 * Stores one answer beside this job's draft and keeps the master CV in step with it: a suggestion
 * moving into "It's true" adds its line; one moving out of it (Undo, or another answer) takes the
 * line off (rejected — the profile, the print gate and every draft stop reading it). The line is
 * added after the record is stored and removed before, so no read in between sees a master CV line
 * without the answer it came from. Returns where the line was kept, for the confirmation.
 */
export async function saveAnswer(
  deps: { claims: ClaimStore; tailorDrafts: TailorDraftStore },
  sessionId: string,
  posting: Posting,
  record: TailorDraftRecord,
  answered: StretchCheckpoint,
  id: string,
  confirmed: ClaimRecord[],
): Promise<{ keptUnder?: string }> {
  const was = isStated(suggestion(record.stretch, id));
  const now = suggestion(answered, id);
  if (was && !isStated(now)) await deps.claims.reject(sessionId, statedClaimId(id));
  await deps.tailorDrafts.put(sessionId, posting.id, { ...record, stretch: answered });
  if (was || !isStated(now)) return {};
  const { claim, group, under } = statedLine(now, record.draft, confirmed, posting);
  await deps.claims.add(sessionId, claim);
  if (group) await deps.claims.setGroup(sessionId, claim.id, group);
  return { keptUnder: under };
}

/**
 * The facts THIS job's draft is written from, and the draft input composed from them. On this CV an
 * "It's true" line prints the way a used line does — at its slot, in place of the line out
 * (applyUsedStretches) — so the line is left out of this job's draft input for as long as the stored
 * draft is the one written without it. Otherwise the new fact would change this draft's
 * fingerprint, the draft would be written again, and the line could print twice. The lines are left
 * out only while that reproduces the stored draft's input exactly: any other change writes the
 * draft from every fact, the new lines among them. Every other job's draft reads them like any fact.
 */
export function draftFacts<T extends { fingerprint: string }>(
  confirmed: ClaimRecord[],
  stored: TailorDraftRecord | null,
  compose: (claims: ClaimRecord[]) => T,
): { claims: ClaimRecord[]; inputs: T } {
  const own = new Set(usedStretches(stored?.stretch).filter((s) => s.scope === "every-job").map((s) => statedClaimId(s.id)));
  if (stored && confirmed.some((c) => own.has(c.id))) {
    const claims = confirmed.filter((c) => !own.has(c.id));
    const inputs = compose(claims);
    if (inputs.fingerprint === stored.inputFingerprint) return { claims, inputs };
  }
  return { claims: confirmed, inputs: compose(confirmed) };
}
