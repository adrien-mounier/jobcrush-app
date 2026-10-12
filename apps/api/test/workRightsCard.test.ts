// #376 — what a CV line may propose on "Where you can work". A proposal is shown and never stored,
// but a wrong "yes" pre-selected is still a wrong nudge, so the rule is pinned both ways: the
// phrasings that name citizenship of the market's country propose yes; living there, speaking its
// language, or another country's nationality propose nothing.
import { describe, expect, it } from "vitest";
import { InMemoryEligibilityStore } from "../src/eligibility.js";
import { workRightsRows } from "../src/workRightsCard.js";

const area = (text: string) => ({ text, marketKey: "", statedAt: "2026-10-12T00:00:00.000Z" });
const proposalFor = async (place: string, line: string) =>
  (await workRightsRows(new InMemoryEligibilityStore(), "s", [area(place)], [line]))[0]!.proposed;

describe("#376 the CV proposes a work-rights yes only from citizenship", () => {
  it.each([
    ["Sydney", "Nationality: Australian"],
    ["Sydney", "Australian citizen, based in Bangkok."],
    ["Melbourne", "Dual citizenship: French and Australian"],
    ["Hong Kong", "Hong Kong permanent resident."],
    ["Singapore", "Citizenship: Singapore"],
    ["Vietnam", "Vietnamese national"],
  ])("%s ← %j proposes yes", async (place, line) => {
    expect(await proposalFor(place, line)).toBe("eligible");
  });

  it.each([
    ["Sydney", "Based in Sydney, Australia."],
    ["Vietnam", "Languages: Vietnamese (native); nationality: French"],
    ["Hong Kong", "Nationality: Australian"],
    ["Singapore", "Worked with Singaporean clients for three years."],
  ])("%s ← %j proposes nothing", async (place, line) => {
    expect(await proposalFor(place, line)).toBeNull();
  });
});
