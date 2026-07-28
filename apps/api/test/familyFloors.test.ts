import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TestFixtureFamilyFloorStore } from "../src/familyFloors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(
    readFileSync(
      join(
        here,
        "..",
        "..",
        "..",
        "packages",
        "contracts",
        "fixtures",
        "family-floor-v1.test-fixture.json",
      ),
      "utf8",
    ),
  );

describe("test-fixture family floor store", () => {
  it("stores and retrieves one immutable family version", () => {
    const store = new TestFixtureFamilyFloorStore();
    const floor = store.add(fixture());

    expect(store.get(floor.familyId, floor.version)).toEqual(floor);
    expect(() => store.add(fixture())).toThrow(
      "family floor version already exists",
    );
  });

  it("protects stored contents from aliases returned by add and get", () => {
    const store = new TestFixtureFamilyFloorStore();
    const added = store.add(fixture());
    const stored = store.get(added.familyId, added.version);

    expect(() => {
      added.essentialItems[0]!.question.prompt = "Mutated through add";
    }).toThrow();
    expect(() => {
      stored!.essentialItems[0]!.question.prompt = "Mutated through get";
    }).toThrow();
    expect(store.get(added.familyId, added.version)?.essentialItems[0]?.question.prompt).toBe(
      "Which example scope applies?",
    );
  });

  it("rejects malformed floors at the store boundary", () => {
    const store = new TestFixtureFamilyFloorStore();
    const invalid = fixture();
    delete invalid.essentialItems[0].evidenceDestination;

    expect(() => store.add(invalid)).toThrow();
  });

  it("test examples cannot unlock the production discovery reward", () => {
    const store = new TestFixtureFamilyFloorStore();
    store.add(fixture());

    expect(store.canUnlockProductionDiscoveryReward()).toBe(false);
  });
});
