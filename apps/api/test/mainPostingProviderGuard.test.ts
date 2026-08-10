import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// #174 QA round: assertEveryActiveProviderIsImplemented (postingRetrieval.ts) is unit-tested in
// isolation, but nothing proved main.ts actually CALLS it — deleting the five-line try/catch around it
// left the whole 1134-test suite green. That is the repo's own standing rule failing for the guard
// itself: "a check that finds nothing must be distinguishable from a check that did not run." A true
// behavioural test would mean executing main.ts's real module-level side effects (every store/LLM
// client resolved from env, a real app.listen) or mocking most of its own imports — a harness bigger
// than the risk warrants, and main.ts is an entry point, not to be restructured for testability. This
// uses the same source-level idiom as onboardingRatchet.test.ts: read the file, assert the property
// structurally rather than by executing it.
describe("main.ts calls the posting-provider boot guard (#174)", () => {
  it("calls assertEveryActiveProviderIsImplemented(postingProviderPolicies) before constructing providers and before the server listens", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");

    expect(
      source,
      "main.ts must call assertEveryActiveProviderIsImplemented(postingProviderPolicies) — the #174 " +
        "boot guard against an active registry row with no driver implementation anywhere.",
    ).toMatch(/assertEveryActiveProviderIsImplemented\(\s*postingProviderPolicies\s*\)/);

    const guardAt = source.indexOf("assertEveryActiveProviderIsImplemented(");
    const providersConstructedAt = source.indexOf("const postingProviders = [");
    const listenAt = source.indexOf(".listen(");
    expect(providersConstructedAt, "const postingProviders = [ construction not found in main.ts").toBeGreaterThan(-1);
    expect(listenAt, ".listen( call not found in main.ts").toBeGreaterThan(-1);
    expect(
      guardAt,
      "the boot guard must run BEFORE postingProviders is constructed, so a driver that exists but " +
        "declines for a config reason (e.g. no TECHMAP_RAPIDAPI_KEY) still boots fine — the guard must " +
        "see the registry alone, never a constructed instance.",
    ).toBeLessThan(providersConstructedAt);
    expect(
      guardAt,
      "the boot guard must run BEFORE app.listen — it exists to fail fast, naming the row, before this " +
        "process ever accepts traffic.",
    ).toBeLessThan(listenAt);
  });
});
