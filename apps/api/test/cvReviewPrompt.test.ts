import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #340: this pins what AC 1 asks of the review prompt — R1–R6, quality-only judging, own-family
// drafting, the output shape — so a later "improvement" that drops a rule goes red here, not on a
// person's CV. The brain doc's copy (docs/cv-brain/tailoring-reasoning.md §9) is NOT read here:
// docs/** is on CI's paths-ignore list, and a test that reads it could turn main red on a push CI
// never runs (CLAUDE.md, "Keeping the plan honest").
// Read as the caller sends it: without the header comment (preview.ts tailorPrompt strips it the same way).
const prompt = readFileSync(new URL("../prompts/cv-review.md", import.meta.url), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");

describe("cv-review prompt (#340)", () => {
  it("states every drafting rule R1–R6", () => {
    for (const rule of ["R1", "R2", "R3", "R4", "R5", "R6"]) {
      expect(prompt, `prompt lacks ${rule}`).toMatch(new RegExp(`\\b${rule} — `));
    }
    expect(prompt).toContain("A missing must-have earns its one line whatever the job's length");
    expect(prompt).toContain("`letterhead` and `sections` are `null` when `sections` is not in JOBS TO REVIEW");
  });

  it("judges quality only — the three kinds — and forbids fit", () => {
    expect(prompt).toContain("The only kinds are:");
    for (const kind of ["`weak`", "`duplicate`", "`aim-without-result`"]) expect(prompt).toContain(kind);
    expect(prompt).toContain("**Never judge fit.**");
    expect(prompt).toContain("decided later, per job advert — never here");
    // The research run's forbidden reason must not be offered as a kind: "off-topic" appears only
    // where the prompt names it as a `keep` case.
    expect(prompt.match(/off-topic/g)?.length).toBe(1);
    expect(prompt).toContain("seems off-topic for the job's family is `keep`");
  });

  it("drafts from each job's own family and names the output shape", () => {
    expect(prompt).toContain("Only for a job placed in a family (placement not `none`)");
    expect(prompt).toContain("`family: null`, `mustHaves: []` and `drafted: []`");
    for (const field of ['"mustHave"', '"quote"', '"flags"', '"vague"', '"OPTIONAL", "INDUSTRY GUESS"', '"from": "CV"', '"from": "TYPICAL"', '"endDateMissing"', '"conflicts"', '"refused"'])
      expect(prompt, `output shape lacks ${field}`).toContain(field);
    expect(prompt).toContain("=== JOBS TO REVIEW ===");
  });
});
