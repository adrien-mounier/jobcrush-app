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

  // #380 (ADR-0018 clause 4): removal only for an item that belongs nowhere; the old quality kinds
  // are gone, and neither weakness nor fit is ever a reason.
  it("suggests removal only for what belongs nowhere — the three kinds — never for a weak line, never for fit", () => {
    expect(prompt).toContain("The only kinds are:");
    for (const kind of ["`duplicate`", "`fragment`", "`personal-data`"]) expect(prompt).toContain(kind);
    for (const gone of ["`weak`", "`aim-without-result`", '"untick"']) expect(prompt, `prompt still offers ${gone}`).not.toContain(gone);
    expect(prompt).toContain('"verdict": "remove"');
    expect(prompt).toContain("**A true but weak item is never suggested for removal; fit is never a reason.**");
    expect(prompt).toContain("**Never judge fit.**");
    expect(prompt).toContain("decided later, per job advert — never here");
    // The research run's forbidden reason must not be offered as a kind: "off-topic" appears only
    // where the prompt names it as a `keep` case.
    expect(prompt.match(/off-topic/g)?.length).toBe(1);
    expect(prompt).toContain("seems off-topic for the job's family is `keep`");
  });

  // #371: About you rides on the sections call; #405 makes it a third-person pitch, not the printed
  // summary: it opens with who the person is (from the CV's own words), gives the two or three
  // strongest results, and ends on no list of skills, languages or degrees. The strict summary rules
  // stay with preview-tailor.md. A summary fact that belongs elsewhere is still named as a move.
  it("writes About you as a third-person pitch from the whole CV, and names the summary facts that move", () => {
    expect(prompt).toContain('"about"');
    expect(prompt).toContain("Open with who the candidate is");
    expect(prompt).toContain("two or three strongest results");
    expect(prompt).toContain("no closing list of skills, languages or degrees");
    expect(prompt).toContain("50–90 words");
    expect(prompt).toContain("Nothing the CV does not state");
    expect(prompt).toContain("No first-person pronouns");
    expect(prompt).toContain("proven ability to");
    expect(prompt).toContain("no summary");
    // The printed summary's own rules are not About you's: the prompt no longer bans the opener.
    expect(prompt).not.toContain("No identity opener");
    expect(prompt).not.toContain("The Professional Summary rules apply");
    // Golden rule: the prompt names no job family in About you's rule.
    expect(prompt).not.toMatch(/IT project manager|banking|Ship24/i);
    expect(prompt).toContain('"moves"');
    expect(prompt).toContain("skills | certifications | education | languages");
    expect(prompt).toContain("`about` is `null` when `sections` is not in JOBS TO REVIEW");
  });

  // #383: per job, the line that is only a tool list (it moves to Skills) and the tools an
  // achievement uses (copied to Skills; the achievement stays as written).
  it("names each job's tool lists and the tools its achievements use, changing no word", () => {
    expect(prompt).toContain('"toolLists"');
    expect(prompt).toContain('"toolsUsed"');
    expect(prompt).toContain("exactly as the line writes it");
    expect(prompt).toContain("tool stays under its job, unchanged");
    // #375 review: a tool list names its tools, so the caller can check every item is one.
    expect(prompt).toContain('"tools": ["<each tool it lists, verbatim>"]');
    // #393: the tools moved in land in a group the answer names — an existing one when it fits.
    expect(prompt).toContain('"toolsGroup"');
    expect(prompt).toContain("Skills group these tools belong in");
  });

  // #382 (ADR-0018 clause 6): the sections call names the skills the CV left ungrouped; the CV's
  // own group names are never touched.
  it("names the skills the CV left ungrouped, and only those", () => {
    expect(prompt).toContain("### (no group)");
    expect(prompt).toContain('"skillGroups"');
    expect(prompt).toContain("is never renamed or moved");
  });

  it("drafts from each job's own family and names the output shape", () => {
    expect(prompt).toContain("Only for a job placed in a family (placement not `none`)");
    expect(prompt).toContain("`family: null`, `mustHaves: []` and `drafted: []`");
    for (const field of ['"mustHave"', '"quote"', '"flags"', '"vague"', '"OPTIONAL", "INDUSTRY GUESS"', '"from": "CV"', '"from": "TYPICAL"', '"endDateMissing"', '"conflicts"', '"refused"'])
      expect(prompt, `output shape lacks ${field}`).toContain(field);
    expect(prompt).toContain("=== JOBS TO REVIEW ===");
  });
});
