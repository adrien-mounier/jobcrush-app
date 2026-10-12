// #382 (ADR-0018 clause 6): skills are split one per item at import, whatever separator or layout
// the CV used, with the person's wording kept — and grouped under the CV's own group label when the
// skills line carries one, else under the fallback group. The rule is this table of real inputs
// (CODING_STANDARDS: a blocking check ships with the inputs it must let through); the recordings
// under test/eval/recordings are real miner output, so their shapes are rows here.
import { describe, expect, it } from "vitest";
import { CandidateClaim, type CandidateClaim as Claim } from "@jobcrush/contracts";
import { FALLBACK_GROUP, splitSkillClaims, splitSkillText } from "../src/skillsSplit.js";

const claim = (over: Partial<Claim>): Claim =>
  CandidateClaim.parse({
    id: "skill-tools",
    semantic_key: "skill-tools",
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text: "Jira",
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: "Jira",
    needs_grill: false,
    grill_hint: null,
    ...over,
  });

describe("splitSkillText — the rule, as a table", () => {
  const table: Array<[input: string, group: string | null, items: string[]]> = [
    // commas (synthetic-01, table-docx recordings)
    ["Jira, Confluence, MS Project, Excel", null, ["Jira", "Confluence", "MS Project", "Excel"]],
    // semicolons (linkedin-profile-pdf recording)
    ["Product Roadmapping; Stakeholder Management; Agile Methodologies", null, ["Product Roadmapping", "Stakeholder Management", "Agile Methodologies"]],
    // bullets and line breaks (a column of skills)
    ["• Jira\n• Confluence\n• MS Project", null, ["Jira", "Confluence", "MS Project"]],
    ["Jira\nConfluence\nMS Project", null, ["Jira", "Confluence", "MS Project"]],
    ["- Jira\n- Confluence", null, ["Jira", "Confluence"]],
    // the miner's sentence lead-in and the Oxford comma (clean-pdf recording): neither is a skill
    ["Has skills in Jira, MS Project, Confluence, SQL basics, and Power BI.", null, ["Jira", "MS Project", "Confluence", "SQL basics", "Power BI"]],
    // the CV's own group label, before its list
    ["Tools: Jira, Confluence, MS Project", "Tools", ["Jira", "Confluence", "MS Project"]],
    ["Delivery and governance: Agile / Scrum, Roadmap and Backlog Management, Stakeholder Management", "Delivery and governance", ["Agile / Scrum", "Roadmap and Backlog Management", "Stakeholder Management"]],
    // a colon-introduced list stays one skill when it is one item among others: the top-level
    // separator (here ";") splits, the commas belonging to an item never do
    [
      "Applied AI: Applied AI for knowledge work; Prompt engineering: structured prompting, Chain-of-Thought, Tree-of-Thoughts, adversarial validation; Multi-LLM orchestration (Claude, Gemini, GPT/Codex) with specialized sub-agents",
      "Applied AI",
      ["Applied AI for knowledge work", "Prompt engineering: structured prompting, Chain-of-Thought, Tree-of-Thoughts, adversarial validation", "Multi-LLM orchestration (Claude, Gemini, GPT/Codex) with specialized sub-agents"],
    ],
    // the same on separate lines, as a CV column lays it out
    ["Applied AI:\nPrompt engineering: structured prompting, Chain-of-Thought\nResponsible AI usage in regulated environments (data sensitivity, tool selection)", "Applied AI", ["Prompt engineering: structured prompting, Chain-of-Thought", "Responsible AI usage in regulated environments (data sensitivity, tool selection)"]],
    // commas inside brackets belong to the item
    ["python (basic), SQL (joins, windows), Excel", null, ["python (basic)", "SQL (joins, windows)", "Excel"]],
    // one skill is one skill — wording untouched, even the miner's sentence
    ["agile/scrum", null, ["agile/scrum"]],
    ["Has skills in Jira and MS Project.", null, ["Has skills in Jira and MS Project."]],
    ["Jira (Expert)", null, ["Jira (Expert)"]],
    // a lead-in with a colon is not a group name
    ["Skills: Jira, Confluence", null, ["Jira", "Confluence"]],
    ["Experienced in: Jira, SQL", null, ["Jira", "SQL"]],
    // the ceiling, pinned: a LONE colon list reads as a group (the miner emits one claim per
    // group, so a lone "Label: a, b" is one) — only beside other skills does it stay one skill
    ["Prompt engineering: structured prompting, Chain-of-Thought", "Prompt engineering", ["structured prompting", "Chain-of-Thought"]],
  ];
  for (const [input, group, items] of table) {
    it(`${JSON.stringify(input).slice(0, 70)} → ${items.length} item(s)${group ? ` under "${group}"` : ""}`, () => {
      expect(splitSkillText(input)).toEqual({ group, items });
    });
  }
});

describe("splitSkillClaims", () => {
  it("replaces each skill claim by one claim per item — kebab ids and semantic keys unique and stable, source and classification carried — and leaves every other claim alone, in order", () => {
    const summary = claim({ id: "years-of-experience", semantic_key: "years-of-experience", text: "7 years in delivery." });
    const skills = claim({ id: "skill-tools", text: "Tools: Jira, Confluence, MS Project", source_quote: "Jira, Confluence, MS Project", classification: "Partially-Supported", needs_grill: true, grill_hint: "no evidence" });
    const edu = claim({ id: "edu-msc", semantic_key: "edu-msc", text: "MSc, Warsaw" });
    const out = splitSkillClaims([summary, skills, edu]);
    expect(out.map((c) => c.id)).toEqual(["years-of-experience", "skill-tools-jira", "skill-tools-confluence", "skill-tools-ms-project", "edu-msc"]);
    expect(out[1]).toMatchObject({
      semantic_key: "skill-tools-jira",
      text: "Jira",
      role: "profile",
      source_quote: "Jira, Confluence, MS Project",
      classification: "Partially-Supported",
      needs_grill: true,
      grill_hint: "no evidence",
      groupName: "Tools",
    });
    expect(out[0]).toEqual(summary);
    expect(out[4]).toEqual(edu);
    // Every split claim is still a valid contract claim.
    for (const c of out) expect(() => CandidateClaim.parse(c)).not.toThrow();
  });

  it("a skills line with no label lands in the fallback group; a single skill keeps its own id", () => {
    const out = splitSkillClaims([claim({ id: "skill-python", semantic_key: "skill-python", text: "python (basic)" }), claim({ id: "skill-tools", text: "Jira, Excel" })]);
    expect(out.map((c) => [c.id, c.text, c.groupName])).toEqual([
      ["skill-python", "python (basic)", FALLBACK_GROUP],
      ["skill-tools-jira", "Jira", FALLBACK_GROUP],
      ["skill-tools-excel", "Excel", FALLBACK_GROUP],
    ]);
  });

  it("two items that slug the same, or slug to nothing, still get distinct ids", () => {
    const out = splitSkillClaims([claim({ text: "C++, C#, ภาษาไทย, C" })]);
    expect(out.map((c) => c.id)).toEqual(["skill-tools-c", "skill-tools-c-2", "skill-tools-3", "skill-tools-c-4"]);
    expect(new Set(out.map((c) => c.semantic_key)).size).toBe(4);
  });
});
