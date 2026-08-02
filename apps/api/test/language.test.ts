// #103 (E5 slice 2) — plain unit tests of language.ts's exported behaviour: the pinned seam for the
// detector and the eligibility rule (spec #86's Testing Decisions). The API-boundary proof that a
// non-English posting is retained-but-hidden lives in cards.test.ts.
import { describe, expect, it } from "vitest";
import { detectLanguage, languageEligible, readingLanguages } from "../src/language.js";

describe("#103 detectLanguage — local, deterministic, no model call", () => {
  it("detects English prose via function-word frequency", () => {
    expect(
      detectLanguage(
        "We are looking for a project manager to lead the delivery of this program and coordinate with the stakeholders on the team.",
      ),
    ).toBe("en");
  });

  it("detects Chinese via the CJK script range, before any word-frequency heuristic runs", () => {
    expect(detectLanguage("我们正在招聘一名项目经理，负责端到端的项目交付与团队协调。")).toBe("zh");
  });

  it("detects Japanese via kana", () => {
    expect(detectLanguage("これはプロジェクトマネージャーの募集です、経験者を歓迎します。")).toBe("ja");
  });

  it("falls back to und for text too short to judge", () => {
    expect(detectLanguage("PM role")).toBe("und");
  });

  it("falls back to und for Latin-script text that doesn't read as English (not guessed at further)", () => {
    expect(
      detectLanguage("Bonjour et bienvenue chez nous pour ce poste de gestion de projet informatique"),
    ).toBe("und");
  });
});

describe("#103 code review finding 4: script detection is PROPORTIONAL, not first-match", () => {
  it("an otherwise-English advert quoting a Chinese company name and address still detects as en", () => {
    const text =
      "We are hiring an IT Project Manager to join our regional delivery team. " +
      "You will lead end-to-end delivery of enterprise software projects, coordinate business " +
      "and technical stakeholders, and manage vendor relationships across our APAC offices. " +
      "This role is based with our partner 华信科技 (Huaxin Tech) at their office on 深圳市南山区科技园 " +
      "in Shenzhen. We are looking for someone with strong communication skills and a track " +
      "record of delivering complex programs on time and on budget for global clients.";
    expect(detectLanguage(text)).toBe("en");
  });

  it("a majority-Chinese advert still detects as zh — dominance, not mere presence, decides it", () => {
    expect(
      detectLanguage(
        "我们正在招聘一名IT项目经理，负责端到端的项目管理，从立项到交付全流程负责，协调业务部门与技术团队之间的沟通。",
      ),
    ).toBe("zh");
  });
});

describe("#103 languageEligible — the one eligibility rule, in one place", () => {
  it("an English posting is eligible for the default English-only reader", () => {
    expect(languageEligible("en", ["en"])).toBe(true);
  });

  it("a Chinese posting is NOT eligible for an English-only reader", () => {
    expect(languageEligible("zh", ["en"])).toBe(false);
  });

  it("a Chinese posting IS eligible once the reader's language list includes it — proves LIST semantics, not a single value (#86 AC3)", () => {
    expect(languageEligible("zh", ["en", "zh"])).toBe(true);
  });

  it("und (undetermined) is never eligible, even for a reader whose list would otherwise match — the documented safe default for unreadable text", () => {
    expect(languageEligible("und", ["en", "zh", "und"])).toBe(false);
  });
});

describe("#103 readingLanguages — a list, defaulted to English, not a single value", () => {
  it("defaults to ['en'] for any session, since nothing persists a user's languages yet (#86 decision 4)", () => {
    expect(readingLanguages({ id: "session-a" })).toEqual(["en"]);
    expect(readingLanguages({ id: "session-b" })).toEqual(["en"]);
  });
});
