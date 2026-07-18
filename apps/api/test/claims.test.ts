// JC-21 — the claims store records deck/grill decisions and reads back only the confirmed subset
// (what buildClaimGraph + the JC-31 gate consume). Same InMemory* contract as sessions.test.ts.
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { InMemoryClaimStore } from "../src/claims.js";

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  role: "Acme — PM",
  text: "Led the checkout replatform.",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "Led checkout replatform.",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

describe("JC-21 InMemoryClaimStore", () => {
  it("seeds claims as pending, so confirmed() is empty until the deck decides", async () => {
    const s = new InMemoryClaimStore();
    await s.seed("sess", [claim({ id: "a" }), claim({ id: "b" })]);
    expect((await s.list("sess")).map((c) => c.decision)).toEqual(["pending", "pending"]);
    expect(await s.confirmed("sess")).toHaveLength(0);
  });

  it("confirm includes / reject excludes from the confirmed subset", async () => {
    const s = new InMemoryClaimStore();
    await s.seed("sess", [claim({ id: "a" }), claim({ id: "b" })]);
    await s.confirm("sess", "a");
    await s.reject("sess", "b");
    expect((await s.confirmed("sess")).map((c) => c.id)).toEqual(["a"]);
  });

  it("edit makes a claim user-authored + auto-confirmed with the new text", async () => {
    const s = new InMemoryClaimStore();
    await s.seed("sess", [claim({ id: "a", text: "old" })]);
    await s.edit("sess", "a", "new wording");
    const [c] = await s.confirmed("sess");
    expect(c).toMatchObject({ id: "a", text: "new wording", origin: "user-authored", decision: "confirmed" });
  });

  it("add persists a grill answer as a confirmed user-authored claim", async () => {
    const s = new InMemoryClaimStore();
    await s.add("sess", claim({ id: "grill-1", text: "Shipped in Q3 2023." }));
    expect((await s.confirmed("sess")).map((c) => [c.id, c.origin])).toEqual([["grill-1", "user-authored"]]);
  });

  it("isolates sessions", async () => {
    const s = new InMemoryClaimStore();
    await s.seed("a", [claim({ id: "x" })]);
    await s.confirm("a", "x");
    expect(await s.confirmed("b")).toHaveLength(0);
  });
});
