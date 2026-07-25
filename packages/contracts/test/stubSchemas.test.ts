// Shape tests for the E5-facing stub contracts (#12): these are NEW, not-frozen schemas, so
// the fixture IS the spec — no oracle to agree with, just Schema.safeParse(fixture).success.
import { describe, expect, it } from "vitest";
import { FamilyFloor, AdRequirements } from "../src/index.js";

const validFloor = {
  schemaVersion: "0",
  family: "IT Project Manager",
  items: [
    {
      id: "budget-accountability",
      rankBand: "essential",
      question: "Have you owned a project budget?",
      options: ["Yes, over $1M", "No"],
      cvSection: "experience",
      noIsFatal: true,
    },
    {
      id: "headline-focus",
      rankBand: "nice-to-have",
      question: "What's the one line you want first on your CV?",
      options: [],
      cvSection: "summary",
      noIsFatal: false,
    },
  ],
};

const validRequirements = {
  schemaVersion: "0",
  adId: "2026-07-05_manulife_senior-it-project-manager-delivery-manager",
  curated: true,
  requirements: [
    {
      id: "manage-full-project-lifecycle",
      band: "must",
      requirement: "Own the full project lifecycle",
      cvSection: "experience",
    },
    {
      id: "digital-transformation-exposure",
      band: "nice",
      requirement: "Experience driving digital transformation",
    },
  ],
};

describe("FamilyFloor (#12) — ranked family-floor stub schema", () => {
  it("parses a valid ranked floor", () => {
    expect(FamilyFloor.safeParse(validFloor).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { question, ...rest } = validFloor.items[0]!;
    const broken = { ...validFloor, items: [rest, validFloor.items[1]!] };
    expect(FamilyFloor.safeParse(broken).success).toBe(false);
  });

  it("rejects a rankBand outside the enum", () => {
    const broken = {
      ...validFloor,
      items: [{ ...validFloor.items[0]!, rankBand: "urgent" }, validFloor.items[1]!],
    };
    expect(FamilyFloor.safeParse(broken).success).toBe(false);
  });

  it("preserves rank order through parse", () => {
    const parsed = FamilyFloor.parse(validFloor);
    expect(parsed.items.map((i) => i.id)).toEqual(validFloor.items.map((i) => i.id));
  });

  // #18: triggeredBy is optional (existing fixtures with no such field stay valid, above), and an
  // item that carries it still parses.
  it("parses an item carrying triggeredBy (#18 surfaced-item stub)", () => {
    const withTrigger = {
      ...validFloor,
      items: [
        ...validFloor.items,
        {
          id: "budget-employer-dates",
          rankBand: "standard",
          question: "Nice — which job was that, and roughly when?",
          options: [],
          cvSection: "experience",
          noIsFatal: false,
          triggeredBy: "budget-accountability",
        },
      ],
    };
    const parsed = FamilyFloor.safeParse(withTrigger);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items.at(-1)?.triggeredBy).toBe("budget-accountability");
    }
  });
});

describe("AdRequirements (#12) — per-ad ranked requirement list stub schema", () => {
  it("parses a valid ranked requirement list", () => {
    expect(AdRequirements.safeParse(validRequirements).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { requirement, ...rest } = validRequirements.requirements[0]!;
    const broken = {
      ...validRequirements,
      requirements: [rest, validRequirements.requirements[1]!],
    };
    expect(AdRequirements.safeParse(broken).success).toBe(false);
  });

  it("keeps older v0 payloads valid and defaults their curated decision to false", () => {
    const { curated, ...legacyV0 } = validRequirements;
    expect(AdRequirements.parse(legacyV0).curated).toBe(false);
  });

  it("rejects a band outside the enum", () => {
    const broken = {
      ...validRequirements,
      requirements: [
        { ...validRequirements.requirements[0]!, band: "critical" },
        validRequirements.requirements[1]!,
      ],
    };
    expect(AdRequirements.safeParse(broken).success).toBe(false);
  });

  it("preserves rank order through parse", () => {
    const parsed = AdRequirements.parse(validRequirements);
    expect(parsed.requirements.map((r) => r.id)).toEqual(
      validRequirements.requirements.map((r) => r.id),
    );
  });
});
