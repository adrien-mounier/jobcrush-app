// #416 (ADR-0020 clause 5) — a small deterministic reader finds the highest degree the person
// holds among their education facts, on the one ladder bachelor < master < doctorate, with the
// common English and French forms. An unreadable degree is unknown, never guessed: the scorer's
// reading then stands. Only education facts are read (the miner's `edu-` id prefix, the same key
// graph.ts's kindTag reads), so a job line about "mentoring master's students" never counts.
import { describe, expect, it } from "vitest";
import { highestDegree, readDegreeLevel } from "../src/degreeLevel.js";

describe("#416 readDegreeLevel — the English and French forms", () => {
  const table: Array<[string, "bachelor" | "master" | "doctorate" | null]> = [
    // The owner's own line.
    ["ESIEA, Paris — Master's Degree in Computer Science (Machine Learning)", "master"],
    // English, bachelor.
    ["Bachelor of Science in Information Systems, 2012", "bachelor"],
    ["BSc Computer Science", "bachelor"],
    ["B.Sc. (Hons) Physics", "bachelor"],
    ["BA in Economics", "bachelor"],
    ["B.A. History", "bachelor"],
    ["BEng Mechanical Engineering", "bachelor"],
    // English, master.
    ["Master of Business Administration", "master"],
    ["MSc Data Science", "master"],
    ["M.Sc. Artificial Intelligence", "master"],
    ["MA in International Relations", "master"],
    ["MBA, INSEAD", "master"],
    ["MEng Civil Engineering", "master"],
    // English, doctorate.
    ["PhD in Statistics", "doctorate"],
    ["Ph.D. Computer Science", "doctorate"],
    ["Doctorate in Education", "doctorate"],
    ["DPhil Philosophy, Oxford", "doctorate"],
    // French.
    ["Licence en droit, Université Paris 1", "bachelor"],
    ["Master 2 Finance, Université Paris-Dauphine", "master"],
    ["Mastère spécialisé en management de projet", "master"],
    ["Maîtrise en gestion", "master"],
    ["Diplôme d'ingénieur, École Centrale", "master"],
    ["Diplome d'ingenieur, INSA Lyon", "master"],
    ["Doctorat en informatique", "doctorate"],
    // Unreadable: no guess.
    ["Certified Scrum Master", null],
    ["ESIEA, Paris, 2010", null],
    ["Boston, MA — summer school", null],
    ["High school diploma", null],
    ["", null],
  ];
  for (const [text, level] of table) {
    it(`"${text}" reads as ${level ?? "unknown"}`, () => {
      expect(readDegreeLevel(text)).toBe(level);
    });
  }
});

describe("#416 highestDegree — the highest level among the education facts", () => {
  it("picks the highest across several education facts", () => {
    expect(
      highestDegree([
        { id: "edu-bsc", text: "BSc Computer Science, 2008" },
        { id: "edu-msc", text: "MSc Machine Learning, 2010" },
      ]),
    ).toBe("master");
  });

  it("a line holding two levels reads as the higher one", () => {
    expect(highestDegree([{ id: "edu-both", text: "BSc then MSc in Physics" }])).toBe("master");
  });

  it("reads only education facts — a job line about master's students is not a degree", () => {
    expect(highestDegree([{ id: "acme-mentoring", text: "Mentored master's students on their theses" }])).toBeNull();
    expect(highestDegree([{ id: "cert-pmp", text: "PMP, 2019" }])).toBeNull();
  });

  it("a fact moved into the education section counts even without the id prefix", () => {
    expect(highestDegree([{ id: "line-7", text: "MBA, HEC Paris", section: "education" }])).toBe("master");
  });

  it("no readable level anywhere is unknown, never a guess", () => {
    expect(highestDegree([{ id: "edu-x", text: "ESIEA, Paris, 2010" }])).toBeNull();
    expect(highestDegree([])).toBeNull();
  });
});
