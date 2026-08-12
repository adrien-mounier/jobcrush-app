// How a re-uploaded CV meets the corrections the person already made — ADR-0002's "a correction is
// a fact about me, not an edit I redo". Extracted from server.ts's composition root on 2026-08-12
// (architecture pass candidate 5), where it was reachable only by uploading a file over HTTP.
//
// Two jobs, both pure:
//   1. DEDUPE the miner's imported claims by identity, so one re-read never seeds the same fact
//      twice under two different generated ids. Identity is `field_key` when the claim is a
//      structured field, else `semantic_key` — the same key a stored resolution is filed under, which
//      is what lets a correction find its claim again on a later upload.
//   2. APPLY the person's stored resolutions on top: a corrected value wins over whatever the miner
//      just re-read (never the other way round), and the import proof is rewritten to show the
//      corrected text, with a conflict the person has already answered cleared rather than re-asked.
import type { CandidateClaim } from "@jobcrush/contracts";
import type { ImportProof } from "./sessions.js";

/** The stored corrections, keyed by claim identity — SessionRecord.importResolutions. */
export type ImportResolutions = Readonly<Record<string, string>>;

export interface ReconciledImport {
  /** Deduped, correction-applied claims to seed for this session. */
  claims: CandidateClaim[];
  /** The subset the person had already corrected. These are additionally CONFIRMED (claims.add), not
   *  left pending: the person supplied the value, so re-asking them to approve their own correction
   *  is the re-do this whole path exists to prevent. */
  corrected: CandidateClaim[];
  /** The proof as the person should see it — corrected text, and no conflict they already resolved. */
  proof: ImportProof;
}

/** A claim's stable identity across re-uploads. A structured field is keyed by its field_key so the
 *  same field found in a differently-worded CV still matches; everything else falls back to the
 *  miner's semantic_key. */
export function claimIdentity(claim: CandidateClaim): string {
  return claim.field_key ?? claim.semantic_key;
}

export function reconcileImport(
  proof: ImportProof,
  importedClaims: CandidateClaim[],
  resolutions: ImportResolutions,
): ReconciledImport {
  // Map-by-identity keeps the LAST claim for any repeated identity, matching the pre-extraction
  // behaviour exactly (new Map(entries) — a later entry overwrites an earlier one).
  const claims = [
    ...new Map(
      importedClaims.map((claim) => {
        const id = claimIdentity(claim);
        const resolved = resolutions[id];
        return [
          id,
          {
            ...claim,
            id,
            text: resolved ?? claim.text,
            // A structured field carries its value twice (text for display, field_value for
            // matching); a correction has to land on both or the two disagree silently.
            field_value: claim.field_key && resolved ? resolved : claim.field_value,
          },
        ] as const;
      }),
    ).values(),
  ];
  return {
    claims,
    corrected: claims.filter((claim) => resolutions[claimIdentity(claim)] !== undefined),
    proof: {
      ...proof,
      representativeFacts: proof.representativeFacts.map((fact) => ({
        ...fact,
        text: resolutions[fact.id] ?? fact.text,
      })),
      conflict:
        proof.conflict && resolutions[proof.conflict.fieldId] === undefined ? proof.conflict : null,
    },
  };
}
