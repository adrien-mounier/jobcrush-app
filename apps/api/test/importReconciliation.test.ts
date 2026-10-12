// ADR-0002's re-upload guarantee, tested directly. Before the 2026-08-12 architecture pass this
// logic lived inside server.ts's composition root, so the only way to reach it was to upload a file
// over HTTP (uploads.test.ts) — the end-to-end path stays there; these are the rules themselves.
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import type { ClaimRecord } from "../src/claims.js";
import { claimIdentity, newItemsOnly, reconcileImport } from "../src/importReconciliation.js";
import type { ImportProof } from "../src/sessions.js";

function claim(over: Partial<CandidateClaim> = {}): CandidateClaim {
  return {
    id: "generated-id",
    semantic_key: "sk-1",
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text: "Led delivery.",
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: "Led delivery.",
    needs_grill: false,
    grill_hint: null,
    ...over,
  };
}

const proof: ImportProof = {
  outcome: "success",
  usefulFactCount: 1,
  representativeFacts: [{ id: "sk-1", text: "Led delivery.", provenance: "cv" }],
  conflict: null,
};

describe("reconcileImport", () => {
  it("keys a structured field by field_key and everything else by semantic_key", () => {
    expect(claimIdentity(claim({ semantic_key: "sk-1", field_key: "email" }))).toBe("email");
    expect(claimIdentity(claim({ semantic_key: "sk-1", field_key: null }))).toBe("sk-1");
  });

  it("seeds one claim per identity when a re-read produces the same fact twice", () => {
    const result = reconcileImport(
      proof,
      [claim({ id: "a", semantic_key: "sk-1" }), claim({ id: "b", semantic_key: "sk-1" })],
      {},
    );
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.id).toBe("sk-1");
  });

  // #323: one field key, two different values is two facts (a genuine contradiction), not one fact
  // read twice — tailor by emphasis, not amputation starts at import. Neither may be dropped.
  it("#323: keeps both claims when one field key carries two different values", () => {
    const result = reconcileImport(
      proof,
      [
        claim({ id: "a", semantic_key: "sa-bkk", field_key: "search-area", field_value: "Bangkok", text: "Bangkok" }),
        claim({ id: "b", semantic_key: "sa-ldn", field_key: "search-area", field_value: "London", text: "London" }),
      ],
      {},
    );
    expect(result.claims.map((c) => [c.id, c.field_value])).toEqual([
      ["search-area-bangkok", "Bangkok"],
      ["search-area-london", "London"],
    ]);
    // The same ids whatever order the miner emits the pair in: a deck decision stays on its value.
    const reversed = reconcileImport(
      proof,
      [
        claim({ id: "b", semantic_key: "sa-ldn", field_key: "search-area", field_value: "London", text: "London" }),
        claim({ id: "a", semantic_key: "sa-bkk", field_key: "search-area", field_value: "Bangkok", text: "Bangkok" }),
      ],
      {},
    );
    expect(reversed.claims.map((c) => c.id).sort()).toEqual(["search-area-bangkok", "search-area-london"]);
    // Values in another script get distinct, stable ids too (QA finding on #323).
    const thai = reconcileImport(
      proof,
      [
        claim({ id: "a", semantic_key: "sa-1", field_key: "search-area", field_value: "กรุงเทพ", text: "กรุงเทพ" }),
        claim({ id: "b", semantic_key: "sa-2", field_key: "search-area", field_value: "เชียงใหม่", text: "เชียงใหม่" }),
      ],
      {},
    );
    expect(new Set(thai.claims.map((c) => c.id)).size).toBe(2);
    expect(thai.claims.every((c) => /^search-area-[a-z0-9]+$/.test(c.id))).toBe(true);
  });

  it("#323: collapses them to the person's own answer once they have resolved the field", () => {
    const result = reconcileImport(
      proof,
      [
        claim({ id: "a", semantic_key: "sa-bkk", field_key: "search-area", field_value: "Bangkok", text: "Bangkok" }),
        claim({ id: "b", semantic_key: "sa-ldn", field_key: "search-area", field_value: "London", text: "London" }),
      ],
      { "search-area": "London" },
    );
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toMatchObject({ id: "search-area", text: "London", field_value: "London" });
  });

  it("a stored correction outranks the freshly re-read value, on text AND field_value", () => {
    const result = reconcileImport(
      proof,
      [claim({ semantic_key: "sk-1", field_key: "email", field_value: "old@x.com", text: "old@x.com" })],
      { email: "new@x.com" },
    );
    expect(result.claims[0]).toMatchObject({ text: "new@x.com", field_value: "new@x.com" });
  });

  it("leaves field_value alone for a non-field claim, even when a resolution exists", () => {
    const result = reconcileImport(proof, [claim({ semantic_key: "sk-1", field_key: null })], {
      "sk-1": "corrected sentence",
    });
    expect(result.claims[0]).toMatchObject({ text: "corrected sentence", field_value: null });
  });

  it("reports only the corrected claims as corrected — those get confirmed, not re-asked", () => {
    const result = reconcileImport(
      proof,
      [claim({ semantic_key: "sk-1" }), claim({ semantic_key: "sk-2", text: "Untouched." })],
      { "sk-1": "Corrected." },
    );
    expect(result.claims).toHaveLength(2);
    expect(result.corrected.map((c) => c.id)).toEqual(["sk-1"]);
  });

  it("nothing is reported corrected when the person has resolved nothing", () => {
    const result = reconcileImport(proof, [claim()], {});
    expect(result.corrected).toEqual([]);
  });

  it("rewrites the proof's representative facts to the corrected text", () => {
    const result = reconcileImport(proof, [claim()], { "sk-1": "Corrected." });
    expect(result.proof.representativeFacts[0]!.text).toBe("Corrected.");
  });

  it("clears a conflict the person already answered, and keeps one they have not", () => {
    const conflicted: ImportProof = {
      ...proof,
      conflict: { fieldId: "email", label: "Email: your CV says a@x.com and also b@x.com. Which one is right?", values: ["a@x.com", "b@x.com"], userResolvedValue: null },
    };
    expect(reconcileImport(conflicted, [claim()], { email: "new@x.com" }).proof.conflict).toBeNull();
    expect(reconcileImport(conflicted, [claim()], {}).proof.conflict).toEqual(conflicted.conflict);
  });

  it("does not mutate its inputs", () => {
    const claims = [claim({ semantic_key: "sk-1", text: "original" })];
    const snapshot = structuredClone(claims);
    const proofSnapshot = structuredClone(proof);
    reconcileImport(proof, claims, { "sk-1": "corrected" });
    expect(claims).toEqual(snapshot);
    expect(proof).toEqual(proofSnapshot);
  });
});

// #385 (ADR-0018 clause 3): a re-upload brings check mode back for new items only. The miner names
// an item afresh on every read, so an item read again under a new id is still the same item when its
// job already holds it in the same words — as read from the CV, as the review fixed it, or as it was
// before the person edited it. Matching is within the same job only.
describe("newItemsOnly", () => {
  const ROLE = "IT Project Manager - Nordic Retail Group";
  const held = (over: Partial<ClaimRecord> & Pick<ClaimRecord, "id" | "text">): ClaimRecord => ({
    ...claim({ role: ROLE, source_quote: over.text }),
    decision: "confirmed",
    origin: "mined",
    lineState: "ticked",
    originalText: null,
    ...over,
  });

  it("drops an item its job already holds in the same words, under any id; keeps new words, and the same words under another job", () => {
    const existing = [held({ id: "led", text: "Led the checkout replatform." })];
    const read = [
      claim({ id: "x1", semantic_key: "led-again", role: ROLE, text: "Led the  checkout replatform", source_quote: "- Led the checkout replatform" }),
      claim({ id: "x2", semantic_key: "new", role: ROLE, text: "Rolled out the new point of sale." }),
      claim({ id: "x3", semantic_key: "other-job", role: "Project Coordinator - Baltic Software House", text: "Led the checkout replatform." }),
    ];
    expect(newItemsOnly(read, existing).map((c) => c.id)).toEqual(["x2", "x3"]);
  });

  it("knows an item the review fixed by its CV words, and one the person edited by its words before the edit", () => {
    const existing = [
      held({ id: "fixed", text: "Managed a budget across 3 vendor teams.", source_quote: "Managed a budget accross 3 vendor teams." }),
      held({ id: "edited", text: "My own words.", originalText: "Coordinated releases for 4 squads.", origin: "user-authored" }),
    ];
    const read = [
      claim({ id: "a", semantic_key: "a", role: ROLE, text: "Managed a budget accross 3 vendor teams." }),
      claim({ id: "b", semantic_key: "b", role: ROLE, text: "Coordinated releases for 4 squads." }),
    ];
    expect(newItemsOnly(read, existing)).toEqual([]);
  });

  it("a drafted item matches nothing: its quote is another line's words", () => {
    const existing = [held({ id: "draft-nrg-1", text: "Owned delivery.", source_quote: "Led the checkout replatform.", origin: "drafted-accepted" })];
    const read = [claim({ id: "led", semantic_key: "led", role: ROLE, text: "Led the checkout replatform." })];
    expect(newItemsOnly(read, existing).map((c) => c.id)).toEqual(["led"]);
  });

  it("a first upload keeps everything; a structured field is matched by its key, never its words", () => {
    const read = [claim({ id: "a", text: "Led." }), claim({ id: "email", semantic_key: "email", field_key: "email", field_value: "a@x.com", text: "a@x.com" })];
    expect(newItemsOnly(read, [])).toEqual(read);
    expect(newItemsOnly(read, [held({ id: "e", role: "profile", text: "a@x.com" })]).map((c) => c.id)).toEqual(["a", "email"]);
  });
});
