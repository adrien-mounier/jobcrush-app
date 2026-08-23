import { describe, expect, it } from "vitest";
import {
  IndustryVocabulary,
  publishedIndustryVocabulary,
} from "../src/industryVocabulary.js";

const group = (groupId: string) => ({
  groupId,
  label: groupId,
  scope: `what ${groupId} covers and where its edge is`,
});

const industry = (industryId: string, groupId: string, version = 1) => ({
  industryId,
  label: industryId,
  scope: `what ${industryId} covers and where its edge is`,
  version,
  groupId,
});

const document = (
  groups: ReturnType<typeof group>[],
  industries: ReturnType<typeof industry>[],
) => ({
  schemaVersion: "1",
  reviewedBy: "owner",
  reviewedAt: "2026-08-23T00:00:00.000Z",
  groups,
  industries,
});

const twoGroups = () => [group("finance"), group("industrial")];
const twoIndustries = () => [industry("banking", "finance"), industry("chemicals", "industrial")];

describe("the published industry vocabulary", () => {
  it("ships as reviewed data: at least ten industries across at least four groups", () => {
    const vocabulary = publishedIndustryVocabulary();
    const industries = vocabulary.activeIndustries();

    expect(industries.length).toBeGreaterThanOrEqual(10);
    expect(new Set(industries.map((entry) => entry.groupId)).size).toBeGreaterThanOrEqual(4);
  });

  it("gives every industry a group that is defined, and every group a scope sentence", () => {
    const vocabulary = publishedIndustryVocabulary();

    for (const entry of vocabulary.activeIndustries()) {
      expect(entry.scope.trim().length).toBeGreaterThan(0);
      const owningGroup = vocabulary.group(entry.groupId);
      expect(owningGroup, `${entry.industryId} names group ${entry.groupId}`).not.toBeNull();
      expect(owningGroup?.scope.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries the industries the closeness cases name", () => {
    const vocabulary = publishedIndustryVocabulary();

    for (const id of ["banking", "finance", "chemicals", "software", "logistics-and-transport"]) {
      expect(vocabulary.active(id), id).not.toBeNull();
    }
  });
});

describe("the publication gate", () => {
  it("refuses a duplicate industry id", () => {
    expect(() =>
      new IndustryVocabulary().publish(
        document(twoGroups(), [industry("banking", "finance"), industry("banking", "industrial")]),
      ),
    ).toThrow(/duplicate industry id: banking/);
  });

  it("refuses an industry naming a group that is not defined", () => {
    expect(() =>
      new IndustryVocabulary().publish(
        document([group("finance")], [industry("banking", "finance"), industry("chemicals", "industrial")]),
      ),
    ).toThrow(/industry names a group that is not defined: chemicals -> industrial/);
  });

  it("refuses a version that does not increase", () => {
    const vocabulary = new IndustryVocabulary();
    vocabulary.publish(document(twoGroups(), [industry("banking", "finance", 2)]));

    expect(() =>
      vocabulary.publish(document(twoGroups(), [industry("banking", "finance", 1)])),
    ).toThrow(/industry version must increase: banking \(2 -> 1\)/);
  });

  it("refuses a changed industry that keeps its version, so a stored placement's words never move", () => {
    const vocabulary = new IndustryVocabulary();
    vocabulary.publish(document(twoGroups(), [industry("banking", "finance")]));

    expect(() =>
      vocabulary.publish(
        document(twoGroups(), [{ ...industry("banking", "finance"), scope: "something else" }]),
      ),
    ).toThrow(/industry version must increase: banking/);
  });

  it("refuses a missing or empty scope sentence", () => {
    // Matched on the failing PATH, not on "something threw": a bare toThrow() here would pass on a
    // schema error anywhere in the document and prove nothing about the scope sentence.
    const scopePath = (publish: () => unknown) => {
      try {
        publish();
      } catch (error) {
        return (error as { issues?: { path: (string | number)[] }[] }).issues?.map((issue) =>
          issue.path.join("."),
        );
      }
      return ["no error thrown"];
    };

    expect(
      scopePath(
        () =>
          new IndustryVocabulary().publish(
            document(twoGroups(), [{ ...industry("banking", "finance"), scope: "   " }]),
          ),
      ),
    ).toContain("industries.0.scope");

    const { scope: _omitted, ...noScope } = industry("banking", "finance");
    expect(
      scopePath(() => new IndustryVocabulary().publish(document(twoGroups(), [noScope]))),
    ).toContain("industries.0.scope");

    expect(
      scopePath(
        () =>
          new IndustryVocabulary().publish(
            document([{ ...group("finance"), scope: "" }], [industry("banking", "finance")]),
          ),
      ),
    ).toContain("groups.0.scope");
  });

  it("refuses a duplicate group id", () => {
    expect(() =>
      new IndustryVocabulary().publish(
        document([group("finance"), group("finance")], [industry("banking", "finance")]),
      ),
    ).toThrow(/duplicate industry group id: finance/);
  });

  it("refuses dropping a group an older, still-readable version still names", () => {
    const vocabulary = new IndustryVocabulary();
    vocabulary.publish(document(twoGroups(), twoIndustries()));

    // banking moves out of `finance` at v2 and the group is retired in the same breath — but
    // banking@1 is still readable and still names it.
    expect(() =>
      vocabulary.publish(
        document([group("industrial")], [
          industry("banking", "industrial", 2),
          industry("chemicals", "industrial"),
        ]),
      ),
    ).toThrow(/industry names a group that is not defined: banking -> finance/);
  });

  it("keeps an older version readable after a new one is published", () => {
    const vocabulary = new IndustryVocabulary();
    vocabulary.publish(document(twoGroups(), [industry("banking", "finance", 1)]));
    vocabulary.publish(
      document(twoGroups(), [{ ...industry("banking", "finance", 2), label: "Banking, renamed" }]),
    );

    expect(vocabulary.get("banking", 1)?.label).toBe("banking");
    expect(vocabulary.active("banking")?.version).toBe(2);
    expect(vocabulary.activeIndustries().map((entry) => entry.version)).toEqual([2]);
  });
});

describe("industry closeness", () => {
  const vocabulary = publishedIndustryVocabulary();

  it("answers exact for the same industry", () => {
    expect(vocabulary.closeness("banking", "banking")).toBe("exact");
  });

  it("answers near for a different industry in the same group", () => {
    expect(vocabulary.closeness("banking", "finance")).toBe("near");
    expect(vocabulary.closeness("finance", "banking")).toBe("near");
  });

  it("answers far across groups", () => {
    expect(vocabulary.closeness("banking", "chemicals")).toBe("far");
    expect(vocabulary.closeness("software", "logistics-and-transport")).toBe("far");
  });

  it("answers far for an industry we never published", () => {
    expect(vocabulary.closeness("banking", "quidditch")).toBe("far");
    expect(vocabulary.closeness("quidditch", "quidditch")).toBe("far");
  });
});
