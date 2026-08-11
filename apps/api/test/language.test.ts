// #103 (E5 slice 2) — plain unit tests of language.ts's exported behaviour: the pinned seam for the
// detector and the eligibility rule (spec #86's Testing Decisions). The API-boundary proof that a
// non-English posting is retained-but-hidden lives in cards.test.ts.
import { describe, expect, it } from "vitest";
import { detectLanguage, languageEligible, readingLanguages } from "../src/language.js";
import { loadPostings } from "../src/preview.js";
import { TECHMAP_LANGUAGE_SAMPLES } from "./fixtures/provider-language-samples.js";

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

describe("#113 sparse real-world advert formats", () => {
  it.each([
    [
      "ATS bullet list",
      "Responsibilities:\n- Manage end-to-end delivery\n- Stakeholder engagement\n- Budget governance\n- Risk planning\n- Vendor coordination",
    ],
    ["bare skills blob", "Agile Scrum Jira Confluence Stakeholder Management Risk Governance Budget Planning"],
    [
      "recruiter one-liner",
      "Hiring now: Senior IT Project Manager - hybrid Hong Kong. #projectmanagement #agile",
    ],
  ])("labels an English %s as en", (_format, text) => {
    expect(detectLanguage(text)).toBe("en");
  });

  it("keeps the exact checked-in Techmap capture as an English calibration set", () => {
    expect(TECHMAP_LANGUAGE_SAMPLES.metadata).toEqual({
      provider: "techmap",
      capturedAt: "2026-08-11",
      region: "HK",
      query: "project manager",
      sourceField: "jsonLD.description",
    });
    expect(
      TECHMAP_LANGUAGE_SAMPLES.adverts.map((advert) => ({
        baseline: advert.baselineVerdict,
        current: detectLanguage(advert.description),
      })),
    ).toEqual([
      { baseline: "en", current: "en" },
      { baseline: "en", current: "en" },
      { baseline: "en", current: "en" },
    ]);
  });

  it.each([
    ["French", "und", "Chef de projet agile management du risque équipe senior"],
    [
      "sparse French",
      "und",
      "Recherche project manager agile scrum transformation numérique Paris",
    ],
    [
      "loanword-heavy French",
      "und",
      "Recherche project manager agile scrum cloud risk management Paris",
    ],
    [
      "loanword-heavy Indonesian",
      "id",
      "Lowongan project manager agile scrum cloud untuk Jakarta remote",
    ],
    [
      "marker-prefixed French",
      "und",
      "Responsibilities: Chef de projet agile scrum cloud pour équipe Paris",
    ],
    [
      "Spanish with one English function-word collision",
      "und",
      "Buscamos a gerente de proyecto con experiencia Madrid",
    ],
    [
      "Spanish with a repeated English function-word collision",
      "und",
      "Buscamos a gerente para trabajar a tiempo completo Madrid",
    ],
    [
      "Indonesian",
      "id",
      "Dicari project manager agile scrum berpengalaman memimpin transformasi digital perbankan lintas departemen",
    ],
  ])("does not open the English gate for a sparse %s advert", (_name, label, text) => {
    const detected = detectLanguage(text);
    expect(detected).toBe(label);
    expect(languageEligible(detected, ["en"])).toBe(false);
  });

  it.each([
    [
      "Vietnamese",
      "vi",
      "Chúng tôi đang tuyển quản lý dự án công nghệ có kinh nghiệm làm việc với các nhóm quốc tế.",
    ],
    [
      "Indonesian",
      "id",
      "Kami mencari manajer proyek teknologi yang memiliki pengalaman mengelola tim dan bekerja dengan pemangku kepentingan.",
    ],
  ])("positively labels a Latin-script %s advert and keeps it out of an English deck", (_name, label, text) => {
    const detected = detectLanguage(text);
    expect(detected).toBe(label);
    expect(languageEligible(detected, ["en"])).toBe(false);
  });

  it("keeps every English corpus advert labelled en and the non-English fixture ineligible", () => {
    const chinesePostingId = "2026-07-10_huaxin-tech-shenzhen_it-xiangmu-jingli";
    for (const posting of loadPostings()) {
      const expected = posting.id === chinesePostingId ? "zh" : "en";
      expect(posting.language, posting.id).toBe(expected);
    }
    expect(languageEligible("zh", ["en"])).toBe(false);
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
