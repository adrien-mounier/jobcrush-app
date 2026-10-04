import { describe, expect, it } from "vitest";
import type { ClaimRecord } from "../src/claims.js";
import { cvLanguages, parseCvLanguage } from "../src/cvLanguages.js";

// #336 — the CV's languages, read into language + the CV's own level word, pre-ticked only where
// that word says the person works in the language (ADR-0016 clause 1).

const claim = (id: string, text: string, decision: ClaimRecord["decision"] = "pending") =>
  ({ id, text, decision }) as ClaimRecord;

describe("parseCvLanguage", () => {
  it.each([
    ["Polish (Native)", "Polish", "Native"],
    ["English - Fluent", "English", "Fluent"],
    ["French – B2", "French", "B2"],
    ["German: full professional proficiency", "German", "full professional proficiency"],
    ["Spanish, conversational", "Spanish", "conversational"],
    ["Italian", "Italian", null],
    ["  Dutch ( basic ) ", "Dutch", "basic"],
    ["Portuguese (Brazilian) – Fluent", "Portuguese", "Brazilian – Fluent"],
    ["English (C1) - fluent", "English", "C1 - fluent"],
    // Sentence-style lines, as the real claim miner returns them for "Native Polish speaker, fluent in
    // English, conversational German, some Italian" (#336 QA gate).
    ["Native Polish speaker", "Polish", "Native"],
    ["fluent in English", "English", "fluent"],
    ["conversational German", "German", "conversational"],
    ["some Italian", "Italian", "some"],
    ["Swedish-Fluent", "Swedish", "Fluent"],
    ["(Native) Polish", "Polish", "Native"],
    ["Haitian Creole", "Haitian Creole", null],
  ])("%s → %s / %s", (text, language, level) => {
    expect(parseCvLanguage(text)).toEqual({ language, level });
  });
});

describe("cvLanguages", () => {
  it("pre-ticks Native, Fluent and Professional; other levels and no level stay unticked", () => {
    const out = cvLanguages([
      claim("lang-polish", "Polish (Native)"),
      claim("lang-english", "English (Fluent)", "confirmed"),
      claim("lang-german", "German (Professional working proficiency)"),
      claim("lang-french", "French (Conversational)"),
      claim("lang-italian", "Italian"),
    ]);
    expect(out).toEqual([
      { language: "Polish", level: "Native", preTicked: true },
      { language: "English", level: "Fluent", preTicked: true },
      { language: "German", level: "Professional working proficiency", preTicked: true },
      { language: "French", level: "Conversational", preTicked: false },
      { language: "Italian", level: null, preTicked: false },
    ]);
  });

  it.each(["Limited professional proficiency", "Semi-fluent", "Not fluent", "Non-native"])(
    "a level that only mentions a working word without meaning it stays unticked: %s",
    (level) => {
      expect(cvLanguages([claim("lang-x", `Spanish (${level})`)])[0]!.preTicked).toBe(false);
    },
  );

  it("pre-ticks a sentence-style working language, never a lower one", () => {
    const out = cvLanguages([
      claim("lang-polish-native", "Native Polish speaker"),
      claim("lang-english-fluent", "fluent in English"),
      claim("lang-german-conversational", "conversational German"),
    ]);
    expect(out.map((l) => [l.language, l.preTicked])).toEqual([
      ["Polish", true],
      ["English", true],
      ["German", false],
    ]);
  });

  it("reads only language claims, skips rejected ones, and lists a language once", () => {
    const out = cvLanguages([
      claim("skill-tools", "Jira (Expert)"),
      claim("lang-spanish", "Spanish (Fluent)", "rejected"),
      claim("lang-polish", "Polish (Native)"),
      claim("lang-polish-2", "polish (native speaker)"),
    ]);
    expect(out.map((l) => l.language)).toEqual(["Polish"]);
  });
});
