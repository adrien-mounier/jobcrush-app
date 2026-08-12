// #162 — years of experience is worked out, never asked.
import { describe, expect, it } from "vitest";
import type { JobBlockView, Kind, MinedDate, MinedEndValue } from "@jobcrush/contracts";
import { countsTowardExperience } from "@jobcrush/contracts";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import {
  answerJobDateHole,
  computeYearsWorked,
  dateHoleQuestions,
  parseEndAnswer,
  syncWorkedYears,
  verifyWorkedYears,
} from "../src/yearsWorked.js";
import { readCounters } from "../src/counters.js";

const month = (year: number, m: number): MinedDate => ({ year, month: m, precision: "month" });
const year = (y: number): MinedDate => ({ year: y, month: null, precision: "year" });

const decision = <T>(value: T) => ({
  id: "x",
  value,
  origin: { kind: "read" as const, source_quote: "q" },
  machine_touch: "verbatim" as const,
  classification: "Verified" as const,
});

function block(
  id: string,
  start: MinedDate,
  end: MinedEndValue,
  kind: Kind = "job",
  employer = "Standard Chartered",
): JobBlockView {
  return {
    id,
    kind,
    countsTowardExperience: countsTowardExperience(kind),
    employer: decision(employer),
    title: decision("Regional PM"),
    start: decision(start),
    end: decision(end),
    kindDecision: decision(kind),
    confirmed: false,
    matchState: "new",
    candidateBlockIds: [],
  };
}

const endedAt = (d: MinedDate): MinedEndValue => ({ state: "ended", date: d });
const OK = { status: "ok", blocksFound: 3 } as const;
const NOW = new Date("2026-08-01T00:00:00Z");

describe("computeYearsWorked", () => {
  it("merges overlapping months and counts gaps as zero (AC1)", () => {
    // 2015-01..2017-12 (36m) overlapping 2017-01..2018-12 (24m, 12 shared) = 48m,
    // then a two-year gap, then 2021-01..2021-12 (12m). Total 60m = 5 years.
    const worked = computeYearsWorked(
      [
        block("a", month(2015, 1), endedAt(month(2017, 12))),
        block("b", month(2017, 1), endedAt(month(2018, 12))),
        block("c", month(2021, 1), endedAt(month(2021, 12))),
      ],
      OK,
      NOW,
    );
    expect(worked).toEqual({ state: "computed", years: 5, unknownEnds: 0 });
  });

  it("ignores a dated block that is not work (AC2)", () => {
    const worked = computeYearsWorked(
      [
        block("job", month(2020, 1), endedAt(month(2021, 12))),
        block("uni", month(2015, 1), endedAt(month(2018, 12)), "education"),
      ],
      OK,
      NOW,
    );
    expect(worked).toEqual({ state: "computed", years: 2, unknownEnds: 0 });
  });

  it("counts an unknown end as zero and reports the hole", () => {
    const worked = computeYearsWorked(
      [
        block("a", month(2004, 1), { state: "unknown" }),
        block("b", month(2023, 1), endedAt(month(2025, 12))),
      ],
      OK,
      NOW,
    );
    expect(worked).toEqual({ state: "computed", years: 3, unknownEnds: 1 });
  });

  it("counts an ongoing job up to today, current month included", () => {
    // Aug 2024 through Aug 2026 inclusive is 25 months.
    const worked = computeYearsWorked([block("a", month(2024, 8), { state: "ongoing" })], OK, NOW);
    expect(worked).toEqual({ state: "computed", years: 2.1, unknownEnds: 0 });
  });

  it("reads a year-precision span as January to December", () => {
    const worked = computeYearsWorked([block("a", year(2019), endedAt(year(2021)))], OK, NOW);
    expect(worked).toEqual({ state: "computed", years: 3, unknownEnds: 0 });
  });

  it("separates a confident zero from an unreadable history (AC6)", () => {
    expect(computeYearsWorked([], { status: "ok", blocksFound: 0 }, NOW)).toEqual({
      state: "computed",
      years: 0,
      unknownEnds: 0,
    });
    expect(computeYearsWorked([], { status: "failed" }, NOW)).toEqual({ state: "untestable" });
    expect(computeYearsWorked([], { status: "not_run" }, NOW)).toEqual({ state: "untestable" });
  });

  // #162 QA finding 2: an end date in the future is clamped to today. Nobody has worked a month that
  // has not happened yet, and this number is what adverts gate on — a typed "December 9999" used to
  // compute as 7,978 years, on a total no screen shows back.
  it("clamps an end date in the future to today, however far out it is", () => {
    const typo = computeYearsWorked([block("a", month(2021, 1), endedAt(month(2029, 12)))], OK, NOW);
    const absurd = computeYearsWorked([block("b", month(2021, 1), endedAt(month(9999, 12)))], OK, NOW);
    const ongoing = computeYearsWorked([block("c", month(2021, 1), { state: "ongoing" })], OK, NOW);
    expect(typo).toEqual(ongoing); // an end past today reads exactly like "still there"
    expect(absurd).toEqual(ongoing);
  });

  it("keeps a stored history testable when a later re-read fails", () => {
    const worked = computeYearsWorked([block("a", month(2020, 1), endedAt(month(2021, 12)))], { status: "failed" }, NOW);
    expect(worked).toEqual({ state: "computed", years: 2, unknownEnds: 0 });
  });
});

describe("dateHoleQuestions", () => {
  it("asks for the missing end, and says why it matters (AC3, AC4)", () => {
    const questions = dateHoleQuestions([
      block("a", month(2004, 1), { state: "unknown" }, "job", "Standard Chartered"),
      block("b", month(2023, 1), endedAt(month(2025, 12))),
      block("c", month(2015, 1), { state: "unknown" }, "education", "LSE"),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.itemId).toBe("job-date-a");
    expect(questions[0]!.question).toBe("When did you leave Standard Chartered?");
    expect(questions[0]!.consequence).toMatch(/adds nothing to your years of experience/);
    expect(questions[0]!.options).toEqual([]);
  });
});

describe("parseEndAnswer", () => {
  it("reads the shapes a person actually types", () => {
    expect(parseEndAnswer("still there")).toEqual({ state: "ongoing" });
    expect(parseEndAnswer("I'm currently there")).toEqual({ state: "ongoing" });
    expect(parseEndAnswer("March 2019")).toEqual({ state: "ended", date: month(2019, 3) });
    expect(parseEndAnswer("Mar 2019")).toEqual({ state: "ended", date: month(2019, 3) });
    expect(parseEndAnswer("03/2019")).toEqual({ state: "ended", date: month(2019, 3) });
    expect(parseEndAnswer("2019-03")).toEqual({ state: "ended", date: month(2019, 3) });
    expect(parseEndAnswer("2019")).toEqual({ state: "ended", date: year(2019) });
  });

  it("refuses what it cannot read rather than guessing", () => {
    expect(parseEndAnswer("a while back")).toBeNull();
    expect(parseEndAnswer("")).toBeNull();
    expect(parseEndAnswer("13/2019")).toBeNull();
  });
});

describe("syncWorkedYears", () => {
  it("stores the worked-out total at the global scope", async () => {
    const eligibility = new InMemoryEligibilityStore();
    await syncWorkedYears(
      eligibility,
      "s1",
      [block("a", month(2020, 1), endedAt(month(2021, 12)))],
      OK,
      NOW,
    );
    expect(await eligibility.numeric("s1", "years-experience", ANY_FAMILY)).toBe(2);
  });

  it("surfaces a drift between the stored copy and the recompute on a READ (AC5)", async () => {
    const eligibility = new InMemoryEligibilityStore();
    await eligibility.put("s1", { dimension: "years-experience", familyId: ANY_FAMILY, value: "10", label: "stale" });
    const before = readCounters()["years.drift_detected"];
    await verifyWorkedYears(eligibility, "s1", [block("a", month(2020, 1), endedAt(month(2021, 12)))], OK);
    expect(readCounters()["years.drift_detected"]).toBe(before + 1);
    expect(await eligibility.numeric("s1", "years-experience", ANY_FAMILY)).toBe(2); // repaired, not just reported
  });

  // #162 QA finding 3: a sync straight after a correction ALWAYS finds a different number — counting
  // that as drift made the counter 100% noise. Only a read-path verification counts it.
  it("does not count drift when a change was expected", async () => {
    const eligibility = new InMemoryEligibilityStore();
    await eligibility.put("s1", { dimension: "years-experience", familyId: ANY_FAMILY, value: "10", label: "stale" });
    const before = readCounters()["years.drift_detected"];
    await syncWorkedYears(eligibility, "s1", [block("a", month(2020, 1), endedAt(month(2021, 12)))], OK, NOW);
    expect(readCounters()["years.drift_detected"]).toBe(before); // a mutation door: a new number is the point
    expect(await eligibility.numeric("s1", "years-experience", ANY_FAMILY)).toBe(2); // still repaired
  });

  it("leaves the stored copy alone when the history is untestable", async () => {
    const eligibility = new InMemoryEligibilityStore();
    await eligibility.put("s1", { dimension: "years-experience", familyId: ANY_FAMILY, value: "8", label: "kept" });
    await syncWorkedYears(eligibility, "s1", [], { status: "failed" }, NOW);
    expect(await eligibility.numeric("s1", "years-experience", ANY_FAMILY)).toBe(8);
  });
});

describe("answerJobDateHole", () => {
  it("corrects the record and re-derives the total (AC5)", async () => {
    const jobBlocks = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    await jobBlocks.ingest(
      "s1",
      {
        blocks: [
          {
            id: "block-1",
            employer: { value: "Standard Chartered", source_quote: "SC", machine_touch: "verbatim", classification: "Verified" },
            title: { value: "PM", source_quote: "PM", machine_touch: "verbatim", classification: "Verified" },
            start: { value: month(2020, 1), source_quote: "Jan 2020", machine_touch: "verbatim", classification: "Verified" },
            end: { value: { state: "unknown" }, source_quote: null, machine_touch: "inferred", classification: "Derived" },
            kind: { value: "job", source_quote: "PM", machine_touch: "inferred", classification: "Derived" },
          },
        ],
        schemaVersion: "1",
      },
      "{}",
    );
    await syncWorkedYears(eligibility, "s1", await jobBlocks.list("s1"), (await jobBlocks.summary("s1")).read, NOW);
    expect(await eligibility.numeric("s1", "years-experience", ANY_FAMILY)).toBe(0);

    const result = await answerJobDateHole(jobBlocks, eligibility, "s1", "job-date-block-1", "December 2021");
    expect(result).toEqual({ ok: true });
    expect(await eligibility.numeric("s1", "years-experience", ANY_FAMILY)).toBe(2);
  });

  it("refuses an unreadable answer and an unknown block", async () => {
    const jobBlocks = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    expect(await answerJobDateHole(jobBlocks, eligibility, "s1", "job-date-x", "dunno")).toMatchObject({
      ok: false,
      code: "invalid_answer",
    });
    expect(await answerJobDateHole(jobBlocks, eligibility, "s1", "job-date-x", "2019")).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});
