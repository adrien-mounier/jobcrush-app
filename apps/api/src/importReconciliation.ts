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
import { createHash } from "node:crypto";
import type { CandidateClaim } from "@jobcrush/contracts";
import type { ImportProof } from "./sessions.js";
import { slug } from "./discovery.js";

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
  // Map-by-key keeps the LAST claim for any repeated key (new Map(entries) — a later entry
  // overwrites an earlier one). The key is the identity, except (#323) for a field the person has
  // not answered: there, two different values are two facts — a genuine contradiction the deck
  // must show whole — not one fact read twice, so each value keeps its own entry. Once the person
  // has answered, their value is the fact and the pair collapses to it: that drop is theirs, not
  // silent.
  const deduped = [
    ...new Map(
      importedClaims.map((claim) => {
        const id = claimIdentity(claim);
        const resolved = resolutions[id];
        return [
          claim.field_key && resolved === undefined ? `${id}\0${claim.field_value}` : id,
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
  // The store upserts by id, so a contested identity names its value in the id — the same id on
  // every re-upload whatever order the miner emits the pair in, so a decision the person made on
  // one value never re-attaches to the other.
  const perIdentity = new Map<string, number>();
  for (const claim of deduped) perIdentity.set(claim.id, (perIdentity.get(claim.id) ?? 0) + 1);
  // A value outside a-z0-9 (a city in Thai, say) slugs to nothing; a short hash keeps the id unique
  // and stable for it too.
  const valueKey = (value: string) =>
    slug(value) || createHash("sha1").update(value).digest("hex").slice(0, 8);
  const claims = deduped.map((claim) =>
    (perIdentity.get(claim.id) ?? 0) > 1
      ? { ...claim, id: `${claim.id}-${valueKey(claim.field_value ?? "")}` }
      : claim,
  );
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
