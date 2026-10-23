// #415 (ADR-0020): the Tailor step no longer takes a "No" to a requirement, but the denials past
// answers stored stay on the record and every reader of them (the card's "You told me you don't
// have this", the never-print list, the report's gap sentence) is still live. Tests plant one the
// way the retired answer route wrote it — same id scheme, same "Not applicable — " scaffolding.
import type { CandidateClaim } from "@jobcrush/contracts";
import { tailorClaimId } from "../src/tailor.js";

export function deniedClaim(adId: string, requirementId: string, requirement: string): CandidateClaim {
  return {
    id: tailorClaimId(adId, requirementId),
    semantic_key: tailorClaimId(adId, requirementId),
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text: `Not applicable — ${requirement}`,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: "No",
    needs_grill: false,
    grill_hint: null,
  };
}
