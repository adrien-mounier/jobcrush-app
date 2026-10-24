// #413 (ADR-0020 clause 5) — a bar the record answers is decided by the record, never by the
// scorer. recordBars.ts is the one place that rule lives: a years bar's fit is min(1, years / bar)
// on the worked-out years across every published field it names, each job once, REPLACING the
// scorer's fit for that requirement. A bar the record cannot answer (no usable history, every named
// field unpublished, an unpublished industry) leaves the verdict untouched and is listed on the
// card under "Not tested" — never a zero. #416 adds the degree rule beside this one.
import { describe, expect, it } from "vitest";
import type { AdRequirementV1, AdRequirementsV1, FamilyPlacement, MinedJobBlock } from "@jobcrush/contracts";
import { answerYearsBar, applyRecordBars } from "../src/recordBars.js";
import { buildJobCard, resolveSessionYears, withYearsShortfall, type SessionYears } from "../src/deck.js";
import type { JudgeVerdict } from "../src/judge.js";
import type { JudgementRecord } from "../src/judgementStore.js";
import type { Posting } from "../src/preview.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore } from "../src/eligibility.js";
import { refreshWorkedYears } from "../src/yearsWorked.js";
import { LANGUAGE_CLAIM_PREFIX } from "../src/cvLanguages.js";

const FAMILY = "it-project-delivery"; // the advert's own family, and the one published field the bar names
const PRODUCT = "product-management";

const decision = (value: string) => ({
  value,
  source_quote: value,
  machine_touch: "verbatim" as const,
  classification: "Verified" as const,
});
const job = (id: string, [sy, sm]: [number, number], [ey, em]: [number, number]): MinedJobBlock => ({
  id,
  employer: decision(`Employer ${id}`),
  title: decision("PM"),
  start: { value: { year: sy, month: sm, precision: "month" }, source_quote: "x", machine_touch: "verbatim", classification: "Verified" },
  end: {
    value: { state: "ended", date: { year: ey, month: em, precision: "month" } },
    source_quote: "x",
    machine_touch: "verbatim",
    classification: "Verified",
  },
  kind: decision("job") as MinedJobBlock["kind"],
});
const placed = (familyIds: string[]): FamilyPlacement => ({
  schemaVersion: "2",
  outcome: "confirmed",
  families: familyIds.map((familyId) => ({ familyId, version: 1 })),
  confidence: "certain",
});
const unmapped: FamilyPlacement = { schemaVersion: "2", outcome: "unmapped" };

// The ticket's career: two delivery jobs (44 + 47 months = 7.6 years merged) and a 3-year job.
const DELIVERY = [job("d1", [2016, 1], [2019, 8]), job("d2", [2019, 9], [2023, 7])];
const THIRD = job("p1", [2023, 8], [2026, 7]);

/** The years struct exactly as the deck and tailor routes resolve it: real stores, facts synced. */
async function yearsFor(blocks: MinedJobBlock[], labels: Record<string, FamilyPlacement>): Promise<SessionYears> {
  const jobBlocks = new InMemoryJobBlockStore();
  const eligibility = new InMemoryEligibilityStore();
  await jobBlocks.init();
  await jobBlocks.ingest("s", { schemaVersion: "1", blocks }, "{}");
  for (const [blockId, placement] of Object.entries(labels)) await jobBlocks.label("s", blockId, placement);
  const view = await jobBlocks.list("s");
  await refreshWorkedYears(jobBlocks, eligibility, "s");
  return resolveSessionYears(await eligibility.list("s"), view, FAMILY);
}

const bar = (over: Partial<AdRequirementV1> = {}): AdRequirementV1 => ({
  id: "years-bar",
  band: "essential",
  kind: "ordinary",
  requirement: "8+ years in project management, consulting, or business transformation",
  eligibilityDimension: "years-experience",
  comparable: { op: ">=", value: 8 },
  yearsFamilies: [FAMILY], // consulting and business transformation are not published: dropped by the reader
  sourceSpan: "8+ years in project management, consulting, or business transformation",
  ...over,
});
const ad = (...requirements: AdRequirementV1[]): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId: "ad-x",
  curated: false,
  language: "en",
  familyFit: { family: FAMILY, confidence: 0.9 },
  requirements,
});
const verdict = (requirementId: string, fit: number): JudgeVerdict => ({ requirementId, fit, supportingFactId: null, reason: "r" });
const fitOf = (verdicts: JudgeVerdict[], id = "years-bar") => verdicts.find((v) => v.requirementId === id)!.fit;

describe("#413 answerYearsBar — which number answers a years bar", () => {
  it("AC1: a bar naming the delivery field counts every job placed in it, each once — the third job in both fields makes 10.6", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT, FAMILY]) });
    expect(answerYearsBar(bar(), years)).toBe(10.6);
  });

  it("AC2: the third job in product management only adds nothing — 7.6 against the bar of 8", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT]) });
    expect(answerYearsBar(bar(), years)).toBe(7.6);
  });

  it("AC3: a bar whose named fields are all unpublished (an empty list) is not tested — null, never 0", async () => {
    const years = await yearsFor(DELIVERY, { d1: placed([FAMILY]), d2: placed([FAMILY]) });
    expect(answerYearsBar(bar({ yearsFamilies: [] }), years)).toBeNull();
  });

  it("a cached read lacking the list falls back to today's single-family scope — the advert's own family", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT]) });
    expect(answerYearsBar(bar({ yearsFamilies: undefined }), years)).toBe(years.family);
    expect(years.family).toBe(7.6);
  });

  it("an unplaced job keeps the generous career-total fallback; every job placed elsewhere is a known zero", async () => {
    const someUnplaced = await yearsFor([...DELIVERY, THIRD], { d1: placed([PRODUCT]), d2: placed([PRODUCT]), p1: unmapped });
    expect(answerYearsBar(bar(), someUnplaced)).toBe(someUnplaced.total);
    const allElsewhere = await yearsFor([...DELIVERY, THIRD], { d1: placed([PRODUCT]), d2: placed([PRODUCT]), p1: placed([PRODUCT]) });
    expect(answerYearsBar(bar(), allElsewhere)).toBe(0);
  });

  it("a years struct carrying no job records (a caller without them) reads the family number, as before", () => {
    const years: SessionYears = { total: 9, family: 4, familySource: "fact", familyConfidence: "certain" };
    expect(answerYearsBar(bar(), years)).toBe(4);
  });

  it("a total bar reads the career total; no usable history at all answers nothing", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT]) });
    expect(answerYearsBar(bar({ yearsScope: "total", yearsFamilies: undefined }), years)).toBe(years.total);
    const none: SessionYears = { total: null, family: null, familySource: "unscoped", familyConfidence: null };
    expect(answerYearsBar(bar(), none)).toBeNull();
  });
});

describe("#413 applyRecordBars — the bar is decided by the years alone", () => {
  it("AC2: short at 7.6/8 the fit is 0.95 whatever the scorer rated it — never 0.475", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT]) });
    for (const scorerFit of [0.1, 0.5, 1.0]) {
      expect(fitOf(applyRecordBars([verdict("years-bar", scorerFit)], ad(bar()), years))).toBeCloseTo(0.95);
    }
  });

  it("AC1: met at 10.6/8 the fit is 1, even when the scorer rated it low", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT, FAMILY]) });
    expect(fitOf(applyRecordBars([verdict("years-bar", 0.5)], ad(bar()), years))).toBe(1);
  });

  it("AC3: a bar the record cannot answer leaves the scorer's verdict untouched — not a zero", async () => {
    const years = await yearsFor(DELIVERY, { d1: placed([FAMILY]), d2: placed([FAMILY]) });
    const verdicts = [verdict("years-bar", 0.5)];
    expect(applyRecordBars(verdicts, ad(bar({ yearsFamilies: [] })), years)).toEqual(verdicts);
  });

  // The rules #107/#222/#284 pinned on the old multiplier, re-stated for the replacement.
  it("leaves every verdict untouched when nothing is known at either scope — an unknown is never a penalty", () => {
    const none = { family: null, total: null };
    const verdicts = [verdict("years-bar", 0.5), verdict("other", 1)];
    expect(applyRecordBars(verdicts, ad(bar(), { ...bar(), id: "other", eligibilityDimension: undefined }), none)).toEqual(verdicts);
  });

  it("a family bar reads the family number, a total bar the total — both at once, each replaced", () => {
    const familyBar = bar({ id: "family-bar", comparable: { op: ">=", value: 5 }, yearsFamilies: undefined });
    const totalBar = bar({ id: "total-bar", yearsScope: "total", yearsFamilies: undefined });
    const out = applyRecordBars([verdict("family-bar", 0.2), verdict("total-bar", 0.2)], ad(familyBar, totalBar), { family: 4, total: 10 });
    expect(fitOf(out, "family-bar")).toBeCloseTo(0.8); // 4/5, the scorer's 0.2 gone
    expect(fitOf(out, "total-bar")).toBe(1); // 10 >= 8
  });

  it("a known ZERO at the family scope zeroes the family bar; a null at one scope leaves that bar untouched", () => {
    const familyBar = bar({ id: "family-bar", yearsFamilies: undefined });
    const totalBar = bar({ id: "total-bar", yearsScope: "total", yearsFamilies: undefined });
    const zero = applyRecordBars([verdict("family-bar", 1), verdict("total-bar", 1)], ad(familyBar, totalBar), { family: 0, total: 10 });
    expect(fitOf(zero, "family-bar")).toBe(0);
    const unknown = applyRecordBars([verdict("family-bar", 0.6), verdict("total-bar", 0.6)], ad(familyBar, totalBar), { family: null, total: 4 });
    expect(fitOf(unknown, "family-bar")).toBe(0.6);
    expect(fitOf(unknown, "total-bar")).toBeCloseTo(0.5); // 4/8
  });

  it("a bar of exactly 0 or no minimum demand ('<=', '==', no comparable) and a non-years requirement are all left untouched", () => {
    const years = { family: 5, total: 5 };
    const cases: AdRequirementV1[] = [
      bar({ comparable: { op: ">=", value: 0 } }),
      bar({ comparable: { op: "<=", value: 8 } }),
      bar({ comparable: { op: "==", value: 8 } }),
      bar({ comparable: undefined }),
      bar({ eligibilityDimension: undefined }),
    ];
    for (const req of cases) {
      const verdicts = [verdict("years-bar", 0.5)];
      expect(applyRecordBars(verdicts, ad(req), years)).toEqual(verdicts);
    }
  });

  it("a negative bar never sends the fit negative; reason and supportingFactId survive", () => {
    const [out] = applyRecordBars(
      [{ requirementId: "years-bar", fit: 0.9, supportingFactId: "c1", reason: "kept" }],
      ad(bar({ comparable: { op: ">=", value: -8 }, yearsFamilies: undefined })),
      { family: 5, total: 5 },
    );
    expect(out!.fit).toBe(0);
    expect(out).toMatchObject({ supportingFactId: "c1", reason: "kept" });
  });
});

describe("#413 the card: the scorer's fit for a years bar has no effect, and an untested bar is listed", () => {
  const posting: Posting = { id: "ad-x", title: "PM", company: "Acme", location: "Hong Kong", keywords: [], excerpt: "x", language: "en" };
  const other: AdRequirementV1 = { id: "english", band: "essential", kind: "ordinary", requirement: "Fluent English", sourceSpan: "Fluent English" };
  const judgement = (yearsFit: number): JudgementRecord => ({
    verdicts: [verdict("years-bar", yearsFit), verdict("english", 1)],
    version: "test",
    cost: { model: "none", inputTokens: 0, outputTokens: 0, judgedAt: "2026-10-18T00:00:00.000Z" },
    facts: [],
  });
  const cardWith = (adReq: AdRequirementsV1, years: SessionYears, yearsFit: number) =>
    buildJobCard(posting, adReq, [], [], withYearsShortfall(judgement(yearsFit), adReq, years), "estimated", years);

  it("AC4: the card's % is the same whether the scorer rated the years bar 0.1 or 1.0", async () => {
    const years = await yearsFor([...DELIVERY, THIRD], { d1: placed([FAMILY]), d2: placed([FAMILY]), p1: placed([PRODUCT]) });
    const low = cardWith(ad(bar(), other), years, 0.1);
    const high = cardWith(ad(bar(), other), years, 1.0);
    expect(low.matchPct).toBe(high.matchPct);
    expect(low.breakdown).toEqual(high.breakdown);
  });

  it("AC3: a bar naming only unpublished fields is listed under Not tested, not under the open gaps, and costs nothing", async () => {
    const years = await yearsFor(DELIVERY, { d1: placed([FAMILY]), d2: placed([FAMILY]) });
    const adReq = ad(bar({ yearsFamilies: [] }), other);
    const card = cardWith(adReq, years, 0.5);
    expect(card.notTested?.map((r) => r.id)).toEqual(["years-bar"]);
    expect(card.dontYet.map((r) => r.id)).not.toContain("years-bar");
    // Never a zero: the score is exactly what the scorer's own verdict gives, untouched.
    const untouched = buildJobCard(posting, adReq, [], [], judgement(0.5), "estimated");
    expect(card.matchPct).toBe(untouched.matchPct);
  });

  it("an industry bar naming no published industry is listed under Not tested the same way", async () => {
    const years = await yearsFor(DELIVERY, { d1: placed([FAMILY]), d2: placed([FAMILY]) });
    const industryBar = bar({ yearsScope: "industry", yearsIndustry: undefined, yearsFamilies: undefined });
    const card = cardWith(ad(industryBar, other), years, 0.5);
    expect(card.notTested?.map((r) => r.id)).toEqual(["years-bar"]);
  });

  it("a bar the record answers is never listed under Not tested — a shortfall shows as an open gap", async () => {
    const years = await yearsFor(DELIVERY, { d1: placed([FAMILY]), d2: placed([FAMILY]) });
    const short = cardWith(ad(bar({ comparable: { op: ">=", value: 15 } }), other), years, 1);
    expect(short.notTested).toBeUndefined();
    expect(short.dontYet.map((r) => r.id)).toContain("years-bar"); // 7.6/15 — a shortfall, shown, never asked
  });
});

// #416 (ADR-0020 clause 5) — a degree bar is decided by the degree held: the highest degree among
// the person's education facts against the bar's level. Held >= bar with no field named: fit 1,
// whatever the scorer said. A field named: the level is the record's and the scorer judges only
// the field (judge.ts tells it so), so its verdict stands here. Held below the bar, or either level
// unknown: the scorer's reading stands — "or equivalent experience" is a judgement.
describe("#416 applyRecordBars — a degree bar is decided by the degree held", () => {
  const MASTERS = [{ id: "edu-esiea", text: "ESIEA, Paris — Master's Degree in Computer Science (Machine Learning)" }];
  const BACHELORS = [{ id: "edu-bsc", text: "BSc Computer Science, 2008" }];
  const UNREADABLE = [{ id: "edu-esiea", text: "ESIEA, Paris, 2010" }];
  const degreeBar = (over: Partial<AdRequirementV1> = {}): AdRequirementV1 => ({
    id: "degree-bar",
    band: "essential",
    kind: "ordinary",
    requirement: "Bachelor's degree",
    eligibilityDimension: "degree",
    degreeLevel: "bachelor",
    sourceSpan: "Bachelor's degree",
    ...over,
  });
  const noYears: SessionYears = { family: null, total: null, familySource: "unscoped", familyConfidence: null };

  it("AC1: a Master's meets 'Bachelor's degree' with fit 1 whether the scorer said 0.3 or 0.9", () => {
    for (const scorerFit of [0.3, 0.9]) {
      expect(fitOf(applyRecordBars([verdict("degree-bar", scorerFit)], ad(degreeBar()), noYears, MASTERS), "degree-bar")).toBe(1);
    }
  });

  it("AC2: with a field named the scorer's field verdict stands — the level was settled for it", () => {
    const withField = degreeBar({ requirement: "Bachelor's degree in Computer Science or related field", degreeFieldNamed: true });
    const verdicts = [verdict("degree-bar", 0.6)];
    expect(applyRecordBars(verdicts, ad(withField), noYears, MASTERS)).toEqual(verdicts);
  });

  it("AC3: a bachelor's against 'Master's degree' keeps the scorer's reading — never forced to 0", () => {
    const verdicts = [verdict("degree-bar", 0.4)];
    expect(applyRecordBars(verdicts, ad(degreeBar({ requirement: "Master's degree", degreeLevel: "master" })), noYears, BACHELORS)).toEqual(verdicts);
  });

  it("AC4: an education fact with no readable level leaves the scorer's reading untouched", () => {
    const verdicts = [verdict("degree-bar", 0.5)];
    expect(applyRecordBars(verdicts, ad(degreeBar()), noYears, UNREADABLE)).toEqual(verdicts);
  });

  it("a bar whose level the reader could not name (no degreeLevel) is the scorer's, as today", () => {
    const verdicts = [verdict("degree-bar", 0.5)];
    expect(applyRecordBars(verdicts, ad(degreeBar({ degreeLevel: undefined })), noYears, MASTERS)).toEqual(verdicts);
  });

  it("a doctorate meets a master's bar; the fact set defaults to none, so a caller without facts changes nothing", () => {
    const phd = [{ id: "edu-phd", text: "PhD in Statistics" }];
    expect(fitOf(applyRecordBars([verdict("degree-bar", 0.2)], ad(degreeBar({ degreeLevel: "master" })), noYears, phd), "degree-bar")).toBe(1);
    const verdicts = [verdict("degree-bar", 0.2)];
    expect(applyRecordBars(verdicts, ad(degreeBar()), noYears)).toEqual(verdicts);
  });

  it("the card: the % is the same whether the scorer rated the degree bar 0.3 or 0.9, even with no work history", () => {
    const posting: Posting = { id: "ad-x", title: "PM", company: "Acme", location: "Hong Kong", keywords: [], excerpt: "x", language: "en" };
    const other: AdRequirementV1 = { id: "english", band: "essential", kind: "ordinary", requirement: "Fluent English", sourceSpan: "Fluent English" };
    const adReq = ad(degreeBar(), other);
    const judgement = (degreeFit: number): JudgementRecord => ({
      verdicts: [verdict("degree-bar", degreeFit), verdict("english", 0.5)],
      version: "test",
      cost: { model: "none", inputTokens: 0, outputTokens: 0, judgedAt: "2026-10-18T00:00:00.000Z" },
      facts: MASTERS, // the fact set the judgement was made against — the record the bar reads
    });
    const cardWith = (degreeFit: number) =>
      buildJobCard(posting, adReq, [], [], withYearsShortfall(judgement(degreeFit), adReq, noYears), "estimated", noYears);
    const low = cardWith(0.3);
    const high = cardWith(0.9);
    expect(low.matchPct).toBe(high.matchPct);
    expect(low.dontYet.map((r) => r.id)).not.toContain("degree-bar");
  });
});

// #425 (owner decision 2, ADR-0008 clause 6 as amended) — a language the CV lists with a working
// level word meets the job's language bar, whatever the scorer said; the card counts it met. A
// lesser word, or none, leaves the scorer's reading. Read from the judgement's own fact set, as the
// degree rule is, so the deck card and the Tailor screen agree.
describe("#425 applyRecordBars — a working level word on the CV meets a language bar", () => {
  const englishBar = (subject = "English"): AdRequirementV1 => ({
    id: "english",
    band: "essential",
    kind: "blocking",
    requirement: "Fluent written and spoken English",
    eligibilityDimension: "language",
    eligibilitySubject: subject,
    sourceSpan: "Fluent written and spoken English",
  });
  const noYears: SessionYears = { family: null, total: null, familySource: "unscoped", familyConfidence: null };
  const lang = (text: string) => [{ id: `${LANGUAGE_CLAIM_PREFIX}0`, text }];

  it("'English (Fluent)' meets it with fit 1 whether the scorer said 0.2 or 0.9, and says why in the CV's words", () => {
    for (const scorerFit of [0.2, 0.9]) {
      const [v] = applyRecordBars([verdict("english", scorerFit)], ad(englishBar()), noYears, lang("English (Fluent)"));
      expect(v).toMatchObject({ fit: 1, reason: "Your CV says: English (Fluent)" }); // never the scorer's note ("r")
    }
  });

  it("'Conversational', 'Beginner' or no level word leaves the scorer's reading", () => {
    for (const text of ["English (Conversational)", "English (Beginner)", "English"]) {
      const verdicts = [verdict("english", 0.4)];
      expect(applyRecordBars(verdicts, ad(englishBar()), noYears, lang(text))).toEqual(verdicts);
    }
  });

  it("a bar naming two languages is met only when the CV works in both", () => {
    const pair = ad(englishBar("Cantonese and English"));
    expect(fitOf(applyRecordBars([verdict("english", 0.3)], pair, noYears, lang("English (Fluent)")), "english")).toBe(0.3);
    const both = [...lang("English (Fluent)"), { id: `${LANGUAGE_CLAIM_PREFIX}1`, text: "Cantonese (Native)" }];
    expect(fitOf(applyRecordBars([verdict("english", 0.3)], pair, noYears, both), "english")).toBe(1);
  });

  it("the card counts it met", () => {
    const posting: Posting = { id: "ad-x", title: "PM", company: "Acme", location: "Hong Kong", keywords: [], excerpt: "x", language: "en" };
    const adReq = ad(englishBar());
    const judgement = (facts: { id: string; text: string }[]): JudgementRecord => ({
      verdicts: [verdict("english", 0.3)],
      version: "test",
      cost: { model: "none", inputTokens: 0, outputTokens: 0, judgedAt: "2026-10-24T00:00:00.000Z" },
      facts,
    });
    const cardWith = (text: string) =>
      buildJobCard(posting, adReq, [], [], withYearsShortfall(judgement(lang(text)), adReq, noYears), "estimated", noYears);
    expect(cardWith("English (Fluent)").dontYet.map((r) => r.id)).not.toContain("english");
    expect(cardWith("English (Conversational)").dontYet.map((r) => r.id)).toContain("english");
  });
});
