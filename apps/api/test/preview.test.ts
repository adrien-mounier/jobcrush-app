import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CandidateClaims } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import {
  applyStoredContact,
  buildTailorInput,
  conservationIssues,
  Draft,
  eligiblePostings,
  loadPostings,
  matchPosting,
  makePreviewStep,
  renderPreviewHtml,
  tailorDraft,
} from "../src/preview.js";
import { makeMineStep } from "../src/miner.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { isTerminal } from "../src/jobs.js";
import type { LlmClient } from "../src/llm.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)));

const sampleDraft: Draft = {
  name: "Maria Kowalski",
  headline: "IT Project Manager for enterprise delivery",
  contact: "Warsaw · maria.kowalski@example.com",
  summary: "Project manager with delivery accountability across vendors.",
  experience: [
    {
      role: "IT Project Manager",
      employer: "Nordic Retail Group",
      location: "Warsaw, Poland",
      dates: "Mar 2021 - Present",
      // Claim ids here must be real ids from the recordedClaims() fixture (clean-pdf.json) —
      // conservationIssues() now cross-checks every claimIds entry against it (#158 must-fix 2).
      bullets: [
        { text: "Led the checkout replatforming, delivered 2 months early", outcome: "", claimIds: ["nrg-led-checkout-replatform"] },
        { text: "Managed a budget of EUR 1.2M across 3 vendor teams", outcome: "", claimIds: ["nrg-managed-budget"] },
        { text: "Ran steering committee reporting for the CIO", outcome: "", claimIds: ["nrg-steering-committee-reporting"] },
      ],
      unprinted: [],
    },
  ],
  skills: [{ label: "Delivery", items: ["Jira", "MS Project"] }],
  certifications: [
    { name: "PRINCE2 Practitioner", date: "2019" },
    { name: "PSM I", date: "2020" },
  ],
  education: [{ institution: "University of Warsaw", detail: "MSc MIS", dates: "2017" }],
  additional: [{ label: "Languages", value: "Polish (Native), English (Fluent)" }],
};

async function recordedClaims(): Promise<CandidateClaims> {
  return CandidateClaims.parse(
    JSON.parse(await readFile(join(fixtures, "eval", "recordings", "clean-pdf.json"), "utf8")),
  );
}

async function promptText(): Promise<string> {
  return readFile(join(fixtures, "..", "prompts", "preview-tailor.md"), "utf8");
}

function llmReturning(json: unknown): LlmClient {
  return { complete: async () => JSON.stringify(json) };
}

async function startSession(app: ReturnType<typeof buildServer>["app"]) {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

describe("JC-16 posting match + render", () => {
  it("matches a posting by title keywords", () => {
    const pm = matchPosting(["IT Project Manager"]);
    expect(pm.title.toLowerCase()).toContain("project manager");
    const ba = matchPosting(["Business Analyst"]);
    expect(ba.title.toLowerCase()).toContain("business analyst");
  });

  it("falls back to the first posting when nothing matches", () => {
    const p = matchPosting(["Zookeeper"]);
    expect(p).toBeTruthy();
  });

  // #103 code review finding 1: this pre-signup path has no session, so it defaults to
  // eligiblePostings(SERVED_LANGUAGES) rather than the raw, unfiltered pool — a non-English posting
  // must never be picked here either, even by an empty-target-title fallback that would otherwise
  // just take postings[0].
  it("never matches a non-English posting, even by keyword or by the no-match fallback (#103)", () => {
    const zh = loadPostings().find((p) => p.language === "zh");
    expect(zh).toBeDefined();
    expect(matchPosting(["IT Project Manager"]).id).not.toBe(zh!.id);
    expect(matchPosting(["Zookeeper"]).id).not.toBe(zh!.id);
    expect(eligiblePostings(["en"]).some((p) => p.id === zh!.id)).toBe(false);
    expect(eligiblePostings(["en", "zh"]).some((p) => p.id === zh!.id)).toBe(true);
  });

  it("burns the watermark into the rendered document itself", () => {
    const posting = matchPosting(["Project Manager"]);
    const html = renderPreviewHtml(sampleDraft, posting);
    expect(html).toContain("DRAFT");
    expect(html).toContain("background-image"); // watermark is part of the render
    expect(html).toContain("Facts not yet verified");
    expect(html).toContain("Maria Kowalski");
    expect(html).not.toContain("<script"); // self-contained, no active content
    expect(html).toContain('name="viewport"'); // fit-to-width on mobile, not pinch-to-read
  });

  it("escapes claim-derived content in the render", () => {
    const hostile = { ...sampleDraft, name: `<img src=x onerror=alert(1)>` };
    const html = renderPreviewHtml(hostile, matchPosting([]));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  // #158 AC: a bullet's claim ids are provenance data, not UI — the page keeps rendering the
  // human text unchanged, and never leaks the ids that back a merge.
  it("renders a bullet's text but never the claim ids behind it", () => {
    const merged: Draft = {
      ...sampleDraft,
      experience: [
        {
          ...sampleDraft.experience[0]!,
          bullets: [
            {
              text: "Led the checkout replatforming and managed its EUR 1.2M budget",
              claimIds: ["nrg-led-checkout-replatform", "nrg-managed-budget"],
            },
          ],
        },
      ],
    };
    const html = renderPreviewHtml(merged, matchPosting([]));
    expect(html).toContain("Led the checkout replatforming and managed its EUR 1.2M budget");
    expect(html).not.toContain("nrg-led-checkout-replatform");
    expect(html).not.toContain("nrg-managed-budget");
  });

  it("tailorDraft validates the LLM's JSON against the draft schema", async () => {
    const { draft } = await tailorDraft(await recordedClaims(), matchPosting([]), llmReturning(sampleDraft));
    expect(draft.name).toBe("Maria Kowalski");
    await expect(
      tailorDraft(await recordedClaims(), matchPosting([]), llmReturning({ nope: 1 })),
    ).rejects.toThrow();
  });

  it("rating-pair render (watermark off) has no draft banner or watermark", () => {
    const html = renderPreviewHtml(sampleDraft, matchPosting([]), { watermark: false });
    expect(html).not.toContain("DRAFT");
    expect(html).not.toContain("background-image");
    expect(html).not.toContain("Facts not yet verified");
  });

  it("renders the engine's canonical sections: certs, grouped skills, education, additional", () => {
    const html = renderPreviewHtml(sampleDraft, matchPosting([]));
    expect(html).toContain("<h2>Certifications</h2>");
    expect(html).toContain("PRINCE2 Practitioner");
    expect(html).toContain("<strong>Delivery</strong>"); // bold skill-group label, not a run-on list
    expect(html).toContain("<strong>University of Warsaw</strong>");
    expect(html).toContain("<strong>Languages:</strong>");
  });

  it("omits empty sections entirely (no Certifications heading without certs)", () => {
    const bare = { ...sampleDraft, certifications: [], education: [], additional: [] };
    const html = renderPreviewHtml(bare, matchPosting([]));
    expect(html).not.toContain("<h2>Certifications</h2>");
    expect(html).not.toContain("<h2>Education</h2>");
    expect(html).not.toContain("<h2>Additional Information</h2>");
  });

  it("normalizes forbidden glyphs (en/em dashes, pipes) in rendered content", () => {
    const glyphy = {
      ...sampleDraft,
      contact: "Warsaw | maria@example.com",
      experience: [
        { ...sampleDraft.experience[0]!, dates: "Mar 2021 – Present" },
      ],
    };
    const html = renderPreviewHtml(glyphy, matchPosting([]), { watermark: false });
    expect(html).toContain("Mar 2021 - Present");
    expect(html).toContain("Warsaw · maria@example.com");
    expect(html).not.toContain("–");
  });
});

describe("#190 applyStoredContact — render preference over the header re-read", () => {
  it("replaces the header's phone and email in place, leaving the rest of the line untouched", () => {
    const result = applyStoredContact("Warsaw · +48 600 000 000 · old@example.com", {
      phone: "+48 611 111 111",
      email: "new@example.com",
    });
    expect(result).toBe("Warsaw · +48 611 111 111 · new@example.com");
  });

  it("only touches the field that has a stored value — the other stays as the header wrote it", () => {
    const result = applyStoredContact("Warsaw · +48 600 000 000 · old@example.com", {
      phone: "+48 611 111 111",
      email: null,
    });
    expect(result).toBe("Warsaw · +48 611 111 111 · old@example.com");
  });

  it("appends a stored value the header never printed, rather than losing it (a supply-once CV)", () => {
    const result = applyStoredContact("Warsaw", { phone: "+48 611 111 111", email: null });
    expect(result).toBe("Warsaw · +48 611 111 111");
  });

  it("is a no-op when nothing is stored for either field", () => {
    const result = applyStoredContact("Warsaw · +48 600 000 000 · old@example.com", { phone: null, email: null });
    expect(result).toBe("Warsaw · +48 600 000 000 · old@example.com");
  });

  // Code review must-fix 1: PHONE_RE matches any 8+ digit run — a digit-bearing email local-part
  // must never be mistaken for a phone number to swap into.
  it("never corrupts a digit-bearing email when swapping in a stored phone (no separate phone in the header)", () => {
    const result = applyStoredContact("Warsaw · jane.12345678@example.com", {
      phone: "+48 611 111 111",
      email: null,
    });
    // The email is untouched — its digits were never a phone match — and the phone is appended,
    // since there was no OTHER phone-shaped span in the line to swap.
    expect(result).toBe("Warsaw · jane.12345678@example.com · +48 611 111 111");
  });

  it("swaps a real phone next to a digit-bearing email without touching the email's own digits", () => {
    const result = applyStoredContact("Warsaw · +48 600 000 000 · jane.12345678@example.com", {
      phone: "+48 611 111 111",
      email: null,
    });
    expect(result).toBe("Warsaw · +48 611 111 111 · jane.12345678@example.com");
  });

  it("a digit-bearing email with stored email explicitly null is never altered", () => {
    const result = applyStoredContact("jane.12345678@example.com", { phone: null, email: null });
    expect(result).toBe("jane.12345678@example.com");
  });

  // Code review must-fix 2: extract.ts's PHONE_RE has no dot separator, so a tailor-reformatted
  // "+33.6.00.00.00.00" (a common French style) would otherwise go unrecognised and the correction
  // would be APPENDED beside the wrong number instead of replacing it — two phones on the page.
  it("replaces a dotted-format phone rather than appending beside it — exactly one phone prints", () => {
    const result = applyStoredContact("Paris · +33.6.00.00.00.00 · jane@example.com", {
      phone: "+33 6 11 11 11 11",
      email: null,
    });
    expect(result).toBe("Paris · +33 6 11 11 11 11 · jane@example.com");
    expect(result.match(/\+33/g)).toHaveLength(1);
  });

  // QA #190 blocking: a bracket-mined stored value ("(852) 1234 5678", now mined whole per the
  // extract.ts fix) must both (a) swap cleanly onto a header phone written differently, and (b)
  // be recognised as the header's OWN phone-shaped span so a later re-render can find and replace
  // it too, without leaving a stray "(" behind.
  it("a bracket-shaped stored phone swaps in cleanly over a plain header phone", () => {
    const result = applyStoredContact("Hong Kong · +852 9999 9999 · jane@example.com", {
      phone: "(852) 1234 5678",
      email: null,
    });
    expect(result).toBe("Hong Kong · (852) 1234 5678 · jane@example.com");
  });

  it("a bracket-shaped phone already in the header is recognised and replaced, not left with a stray bracket", () => {
    const result = applyStoredContact("Hong Kong · (852) 9999 9999 · jane@example.com", {
      phone: "+852 1234 5678",
      email: null,
    });
    expect(result).toBe("Hong Kong · +852 1234 5678 · jane@example.com");
  });
});

describe("conservation lint — tailor by emphasis, not amputation", () => {
  it("passes a draft that keeps certs and languages", async () => {
    expect(conservationIssues(await recordedClaims(), sampleDraft)).toEqual([]);
  });

  it("flags dropped certifications and lost languages", async () => {
    const lossy: Draft = {
      ...sampleDraft,
      certifications: [],
      additional: [],
    };
    const issues = conservationIssues(await recordedClaims(), lossy);
    expect(issues.some((i) => i.message.includes("certifications lost"))).toBe(true);
    expect(issues.some((i) => i.message.includes("languages lost"))).toBe(true);
  });

  // #153/#158: the hidden floor (Math.min(6, sourceBullets) on the newest role) is deleted.
  // A thin current role is no longer a conservation issue — "first call is not a floor."
  it("does not flag a thinned current role — the floor was deleted (#153)", async () => {
    const thin: Draft = {
      ...sampleDraft,
      experience: [
        {
          ...sampleDraft.experience[0]!,
          bullets: [
            {
              text: "Led the checkout replatforming, delivered 2 months early",
              claimIds: ["nrg-led-checkout-replatform"],
            },
          ],
        },
      ],
    };
    expect(conservationIssues(await recordedClaims(), thin)).toEqual([]);
  });

  // #158 must-fix: claim ids are provenance, not decoration — an id the tailor never actually
  // received must be caught, not merely well-formed. Without this check a fabricated id like
  // "made-up-claim" passes validation untouched.
  it("flags a bullet citing a claim id that is not a real source claim", async () => {
    const claims = await recordedClaims();
    const fabricated: Draft = {
      ...sampleDraft,
      experience: [
        {
          ...sampleDraft.experience[0]!,
          bullets: [
            {
              text: "Led the checkout replatforming, delivered 2 months early",
              claimIds: ["made-up-claim"],
            },
          ],
        },
      ],
    };
    const issues = conservationIssues(claims, fabricated);
    expect(issues.some((i) => i.message.includes("made-up-claim"))).toBe(true);
  });

  it("flags an unprinted entry citing a claim id that is not a real source claim", async () => {
    const claims = await recordedClaims();
    const fabricated: Draft = {
      ...sampleDraft,
      experience: [{ ...sampleDraft.experience[0]!, unprinted: ["also-made-up"] }],
    };
    const issues = conservationIssues(claims, fabricated);
    expect(issues.some((i) => i.message.includes("also-made-up"))).toBe(true);
  });

  it("does not flag claim ids that are real, in bullets or in unprinted", async () => {
    const claims = await recordedClaims();
    const valid: Draft = {
      ...sampleDraft,
      experience: [{ ...sampleDraft.experience[0]!, unprinted: ["nrg-managed-budget"] }],
    };
    expect(conservationIssues(claims, valid)).toEqual([]);
  });

  // #208: compound bullets are captured whole and split at WRITING time, so one claim id cited by
  // two printed bullets is the new legitimate shape — the lint must pass it.
  //
  // ⚠️ Read this before trusting the pass: each divided bullet is SINGLE-claim, so #154's
  // verbatim-result rule (which fires only at claimIds.length >= 2) cannot see it. A division is
  // guarded by the #208 block instead — the two-bullet cap and the numbers-survive check below.
  // What neither can see is a result carrying no digit; that residue is ADR-0012 clause 4a.
  it("passes one claim id split across two printed bullets (#208)", async () => {
    const claims = await recordedClaims();
    const split: Draft = {
      ...sampleDraft,
      experience: [
        {
          ...sampleDraft.experience[0]!,
          bullets: [
            {
              text: "Led the checkout replatforming, delivered 2 months early",
              claimIds: ["nrg-led-checkout-replatform"],
              outcome: "",
            },
            {
              text: "Coordinated the vendor teams through the replatforming cutover",
              claimIds: ["nrg-led-checkout-replatform"],
              outcome: "",
            },
          ],
        },
      ],
    };
    expect(conservationIssues(claims, split)).toEqual([]);
  });

  // The other half of AC3: #154 must still hold "when a compound line is divided". The real risk is
  // not that the merge rule stopped working — previewMergeOutcome.test.ts already pins that — it is
  // that a division sitting in the SAME role could mask it, since both shapes now share one loop.
  // So: one divided claim and one bad merge in the same draft. The merge must still be caught.
  it("a division in the same role does not mask a merged line that lost its result (#154 after #208)", async () => {
    const claims = await recordedClaims();
    const both: Draft = {
      ...sampleDraft,
      experience: [
        {
          ...sampleDraft.experience[0]!,
          bullets: [
            // the division: one claim, two lines, both single-claim
            {
              text: "Led the checkout replatforming, delivered 2 months early",
              claimIds: ["nrg-led-checkout-replatform"],
              outcome: "",
            },
            {
              text: "Coordinated vendor teams through the replatforming cutover",
              claimIds: ["nrg-led-checkout-replatform"],
              outcome: "",
            },
            // the bad merge: declares a result the sentence never prints
            {
              text: "Led checkout replatforming and managed the budget across 3 vendor teams",
              claimIds: ["nrg-led-checkout-replatform", "nrg-managed-budget"],
              outcome: "delivered 2 months early",
            },
          ],
        },
      ],
    };
    const issues = conservationIssues(claims, both);
    expect(issues.filter((i) => i.message.includes("is not in the bullet's own text"))).toHaveLength(1);
  });

  // #208 division guards. A split says "I am rendering this whole line across two bullets", so the
  // line's figures must survive it — and one source line may not become three, which is padding.
  // Fixture claim: "Managed a budget of EUR 1.2M across 3 vendor teams." (numbers 1.2 and 3).
  const splitBudget = (texts: string[], extra: Draft["experience"][number]["bullets"] = []): Draft => ({
    ...sampleDraft,
    experience: [
      {
        ...sampleDraft.experience[0]!,
        bullets: [
          ...texts.map((text) => ({ text, claimIds: ["nrg-managed-budget"], outcome: "" })),
          ...extra,
        ],
      },
    ],
  });

  it("passes a split that carries the line's figures across both bullets", async () => {
    const issues = conservationIssues(
      await recordedClaims(),
      splitBudget(["Managed a EUR 1.2M project budget", "Coordinated 3 vendor teams to delivery"]),
    );
    expect(issues).toEqual([]);
  });

  it("flags a split that drops the line's figures on the way (#208)", async () => {
    const issues = conservationIssues(
      await recordedClaims(),
      splitBudget(["Managed the project budget", "Coordinated the vendor teams to delivery"]),
    );
    const lost = issues.filter((i) => i.message.includes("appears on none of them"));
    expect(lost).toHaveLength(1);
    expect(lost[0]!.message).toContain("1.2, 3");
    // The person is told in their own terms, not ours — this one is NOT blockCovered, because
    // draftDisclosure() says nothing about divisions.
    expect(lost[0]!.blockCovered).toBeUndefined();
    expect(lost[0]!.visitor).toContain("split into 2 bullets");
  });

  it("flags one source line printed as three bullets — the padding shape splitting made possible", async () => {
    const issues = conservationIssues(
      await recordedClaims(),
      splitBudget([
        "Managed a EUR 1.2M project budget",
        "Coordinated 3 vendor teams to delivery",
        "Owned the vendor relationship end to end",
      ]),
    );
    const padded = issues.filter((i) => i.message.includes("printed on 3 separate bullets"));
    expect(padded).toHaveLength(1);
  });

  // Once a merge is in play, #154 owns the line and deliberately guarantees only ONE surviving
  // result. Demanding every figure there would fire on lines that rule calls fine.
  it("leaves the figures check alone when one of the citing bullets is a merge", async () => {
    const issues = conservationIssues(
      await recordedClaims(),
      splitBudget(["Managed the project budget"], [
        {
          text: "Ran vendor reporting for the CIO",
          claimIds: ["nrg-managed-budget", "nrg-steering-committee-reporting"],
          outcome: "",
        },
      ]),
    );
    expect(issues.some((i) => i.message.includes("appears on none of them"))).toBe(false);
  });

  it("does not count education diplomas or experience bullets as certifications", async () => {
    const claims = await recordedClaims();
    claims.claims.push(
      {
        id: "edu-leaving-certificate",
        role: "Marcel Pagnol High School",
        text: "Leaving Certificate, secondary school examination",
        machine_touch: "verbatim",
        classification: "Verified",
        source_quote: "Leaving Certificate",
        needs_grill: false,
        grill_hint: null,
      },
      {
        id: "nrg-pci-certification-audit",
        role: "IT Project Manager - Nordic Retail Group",
        text: "Led the PCI certification audit",
        machine_touch: "verbatim",
        classification: "Verified",
        source_quote: "Led the PCI certification audit",
        needs_grill: false,
        grill_hint: null,
      },
    );
    // sampleDraft renders 2 certs; source still counts 2 (PRINCE2 + PSM I), not 4.
    expect(conservationIssues(claims, sampleDraft)).toEqual([]);
  });

  it("tailorDraft feeds lint issues back on retry and accepts the corrected draft", async () => {
    const lossy = { ...sampleDraft, certifications: [] };
    let calls = 0;
    const llm = {
      complete: async (prompt: string) => {
        calls++;
        if (calls === 1) return JSON.stringify(lossy);
        expect(prompt).toContain("certifications lost");
        return JSON.stringify(sampleDraft);
      },
    };
    const { draft, conservationNotices } = await tailorDraft(await recordedClaims(), matchPosting([]), llm);
    expect(calls).toBe(2);
    expect(draft.certifications.length).toBe(2);
    expect(conservationNotices).toEqual([]);
  });

  it("ships a still-lossy draft after retry, telling the visitor in plain words (#163)", async () => {
    const lossy = { ...sampleDraft, certifications: [] };
    const { draft, conservationNotices } = await tailorDraft(
      await recordedClaims(),
      matchPosting([]),
      llmReturning(lossy),
    );
    expect(draft.certifications.length).toBe(0); // shipped — never fails the job
    // ADR-0002 clause 5: the loss is a message to the person, not a console-only warning.
    expect(conservationNotices.length).toBeGreaterThan(0);
    expect(conservationNotices[0]).toContain("certification");
    expect(conservationNotices[0]).not.toContain("JSON"); // plain words, not LLM feedback
  });
});

describe("buildTailorInput carries claim ids (#158, #153 falsifiable check)", () => {
  it("prefixes every claim line with its own id so the tailor can cite it back", async () => {
    const claims = await recordedClaims();
    const input = buildTailorInput(claims, matchPosting([]));
    for (const c of claims.claims) {
      expect(input).toContain(c.id);
    }
    expect(input).toContain(
      "- nrg-led-checkout-replatform [IT Project Manager - Nordic Retail Group]",
    );
  });
});

describe("Draft schema — bullet spend rail, no floor, claim provenance (#158)", () => {
  const bullet = (n: number, claimIds: string[] = [`claim-${n}`]) => ({
    text: `Delivered outcome number ${n} for the team`,
    claimIds,
  });
  const draftWithBullets = (bullets: unknown[], unprinted: string[] = []) => ({
    ...sampleDraft,
    experience: [{ ...sampleDraft.experience[0]!, bullets, unprinted }],
  });

  it("accepts a role with exactly 10 bullets — the rail", () => {
    const bullets = Array.from({ length: 10 }, (_, i) => bullet(i));
    expect(() => Draft.parse(draftWithBullets(bullets))).not.toThrow();
  });

  it("rejects an 11th bullet on one role", () => {
    const bullets = Array.from({ length: 11 }, (_, i) => bullet(i));
    expect(() => Draft.parse(draftWithBullets(bullets))).toThrow();
  });

  it("a 2-bullet role is valid on its own — no floor forces padding", () => {
    const bullets = [bullet(0), bullet(1)];
    expect(() => Draft.parse(draftWithBullets(bullets))).not.toThrow();
  });

  it("rejects a bullet citing no claim — an uncited bullet is treated as invented", () => {
    const bullets = [bullet(0, [])];
    expect(() => Draft.parse(draftWithBullets(bullets))).toThrow();
  });

  it("accepts a merged bullet carrying two source claim ids, visible mechanically", () => {
    const bullets = [bullet(0, ["nrg-led-checkout-replatform", "nrg-managed-budget"])];
    const parsed = Draft.parse(draftWithBullets(bullets));
    expect(parsed.experience[0]!.bullets[0]!.claimIds).toEqual([
      "nrg-led-checkout-replatform",
      "nrg-managed-budget",
    ]);
  });

  it("records unprinted candidate bullets by claim id instead of discarding them", () => {
    const bullets = Array.from({ length: 10 }, (_, i) => bullet(i));
    const parsed = Draft.parse(draftWithBullets(bullets, ["nrg-steering-committee-reporting"]));
    expect(parsed.experience[0]!.unprinted).toEqual(["nrg-steering-committee-reporting"]);
  });
});

describe("tailor prompt pins the #153 decisions (#158 falsifiable check)", () => {
  it("states the spend ladder and the rail of 10, with no per-role cap other than 10", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("first call");
    expect(prompt).toContain("10 bullets");
    expect(prompt).not.toContain("4-6");
    expect(prompt).not.toContain("3-4");
    expect(prompt).not.toContain("reach **8**");
  });

  it("has no rule that thins a role by its age or by how many roles the candidate has", async () => {
    const prompt = await promptText();
    expect(prompt).not.toMatch(/older than ~?8 years/i);
    expect(prompt).not.toMatch(/compress the oldest/i);
  });

  it("withdraws merge-never-drop: choosing and reporting what did not print replaces it", async () => {
    const prompt = await promptText();
    expect(prompt).not.toContain("merge weak or overlapping bullets instead of dropping");
    expect(prompt).not.toContain("must never render with fewer bullets than the source supports");
    expect(prompt).toContain("choose, do not squish");
    expect(prompt).toContain("unprinted");
  });

  it("instructs the tailor to cite claim ids on every printed bullet", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("claimIds");
  });

  // docs/cv-brain/cv-authoring-rules.md ("Length and bullet density"): "an advert can still
  // overrule [the ladder] when an older role is the relevant one" — the ladder is not absolute.
  it("states the posting can overrule the ladder when an older role is the relevant one", async () => {
    const prompt = await promptText();
    expect(prompt).toMatch(/posting can overrule\s+the ladder when an older role is/);
  });

  it("states the two-page budget as a maximum, matching cv-brain wording", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("two pages maximum");
  });
});

// #159: coarse/unknown dates print a start-only date (never "Present"), the summary prints only
// when it earns its place (no word cap), and nationality becomes a print-by-default rather than a
// conservation rule. cv-authoring-rules.md ("Coarse and unknown dates", "Professional Summary")
// is the normative spec these rules implement; see also ADR-0007's rule-6 consequence.
describe("#159 tailor prompt — coarse dates, summary earns its place, nationality by default", () => {
  it("instructs a start-only date when a role's end is unstated and not confirmed current", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("renders its start alone");
    expect(prompt).toContain('Never invent "Present"');
    expect(prompt).toContain('"Since 2003"');
    expect(prompt).toContain('"From 2003"');
  });

  // Code review must-fix 2: the start-alone clause offered "2003" or "March 2003" with no tie to
  // source precision, sitting inside a rule that demands the SAME date form for every role — so
  // the model could "helpfully" invent a month on a year-only role to match the rest of the CV.
  it("ties start-only precision to the source, never to the CV's other roles' form", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("exactly the precision the source gave it");
    expect(prompt).toContain("can never license inventing one");
    expect(prompt).toContain(
      "a year-only start stays year-only even when every other role prints",
    );
  });

  it("forbids a dateless entry and any note about the missing end date on the tailored CV", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("never leave `dates` empty");
    expect(prompt).toContain("start-only date, not a dateless entry");
    expect(prompt).toContain("never add a note, caveat, or placeholder");
  });

  it("has no word cap on the summary rule specifically, and allows an empty one when nothing earns it a place", async () => {
    const prompt = await promptText();
    // Scoped to rule 10's own paragraph (code review take-if-cheap) — a whole-file scan would
    // also redden on an unrelated future word count elsewhere (e.g. a bullet-length rule).
    const rule10 = prompt.slice(prompt.indexOf("10. **Summary prints"), prompt.indexOf("## Writing style"));
    expect(rule10).not.toMatch(/\d+\s*words/i);
    expect(rule10).toContain("prints only when it earns its place");
    expect(rule10).toContain('"summary": ""');
  });

  it("orders the summary achievement first and bans the identity opener and capability claims", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("the achievement first");
    expect(prompt).toContain("never displaces the achievement");
    expect(prompt).toContain("identity opener");
    expect(prompt).toContain("capability claims");
    expect(prompt).toContain("proven ability to");
  });

  it("keeps languages as a conservation rule but reframes nationality as a print-by-default", async () => {
    const prompt = await promptText();
    expect(prompt).toContain("Never drop them — a conservation rule");
    expect(prompt).toContain("print in `additional` by default");
    expect(prompt).not.toContain("Languages, nationality, and similar profile facts");
  });
});

describe("#159 summary prints only when it earns its place — schema + render", () => {
  it("Draft accepts an empty summary (nothing earned it a place)", () => {
    expect(() => Draft.parse({ ...sampleDraft, summary: "" })).not.toThrow();
  });

  // Code review must-fix 1 (both review axes): z.string().default("") also accepted an ABSENT
  // key, so a truncated/retried tailor response that drops "summary" entirely parsed clean and
  // shipped byte-identical to a deliberate omission. Only "" is a deliberate omission; a missing
  // key must still fail parse and drive the retry.
  it("Draft rejects a MISSING summary key — a dropped key must retry, never silently vanish", () => {
    const { summary: _summary, ...withoutSummary } = sampleDraft;
    expect(() => Draft.parse(withoutSummary)).toThrow();
  });

  it("tailorDraft retries when the response is missing the summary key entirely", async () => {
    const { summary: _summary, ...withoutSummary } = sampleDraft;
    let calls = 0;
    const llm = {
      complete: async () => {
        calls++;
        return JSON.stringify(calls === 1 ? withoutSummary : sampleDraft);
      },
    };
    const { draft } = await tailorDraft(await recordedClaims(), matchPosting([]), llm);
    expect(calls).toBe(2);
    expect(draft.summary).toBe(sampleDraft.summary);
  });

  it("omits the Professional Summary heading entirely when summary is empty — never a heading with nothing under it", () => {
    const html = renderPreviewHtml({ ...sampleDraft, summary: "" }, matchPosting([]));
    expect(html).not.toContain("<h2>Professional Summary</h2>");
  });

  it("treats a whitespace-only summary as absent too", () => {
    const html = renderPreviewHtml({ ...sampleDraft, summary: "   " }, matchPosting([]));
    expect(html).not.toContain("<h2>Professional Summary</h2>");
  });

  it("still renders the Professional Summary heading and text when a summary is present", () => {
    const html = renderPreviewHtml(sampleDraft, matchPosting([]));
    expect(html).toContain("<h2>Professional Summary</h2>");
    expect(html).toContain(sampleDraft.summary);
  });
});

describe("#159 header — left-aligned, two-line, no filler (BINDING DESIGN #157 item 1 variant C)", () => {
  it("left-aligns the name instead of centering it", () => {
    const html = renderPreviewHtml(sampleDraft, matchPosting([]), { watermark: false });
    // Whitespace-tolerant (code review take-if-cheap): a harmless "h1{" -> "h1 {" reformat must
    // not redden this, only an actual alignment regression should.
    expect(html).toMatch(/h1\s*\{[^}]*text-align:\s*left/);
    expect(html).not.toMatch(/h1\s*\{[^}]*text-align:\s*center/);
  });

  it("folds the headline and contact onto one line, joined by a dash, not a pipe", () => {
    const html = renderPreviewHtml(sampleDraft, matchPosting([]), { watermark: false });
    expect(html).toContain(
      `<span class="role-word">${sampleDraft.headline}</span> - ${sampleDraft.contact}`,
    );
    expect(html).not.toContain('<p class="contact">');
  });

  // Code review must-fix 5: renderPreviewHtml() emits exactly one <h1> and one
  // <p class="headline"> for every draft regardless of summary state, so counting them can never
  // fail — it duplicated the schema+render block's own omission test without adding coverage.
  // This instead checks the actual adjacency: with no summary, the header runs straight into the
  // next section with nothing between them — a real filler block, or a regression to the old
  // 3-line header, would break this exact substring.
  it("adds no filler block when the summary is absent — header runs straight into Experience", () => {
    const html = renderPreviewHtml({ ...sampleDraft, summary: "" }, matchPosting([]), {
      watermark: false,
    });
    expect(html).toContain("</p>\n\n<h2>Professional Experience</h2>");
    expect(html).not.toContain("<h2>Professional Summary</h2>");
  });
});

describe("JC-17 pipeline end to end (fake LLMs)", () => {
  function fakePipeline() {
    const mined = { schemaVersion: "0", roles: [], claims: [], parser_flags: [] };
    const mine = async () => ({
      doc: (await recordedClaims()) ?? mined,
      claims: (await recordedClaims()).claims,
      roles: 2,
      needsGrill: 2,
    });
    return { mine };
  }

  async function waitTerminal(server: ReturnType<typeof buildServer>, jobId: string) {
    await new Promise<void>((resolve) => {
      const un = server.store.subscribe(jobId, (j) => {
        if (isTerminal(j.status)) {
          un();
          resolve();
        }
      });
      void server.store.get(jobId).then((j) => {
        if (j && isTerminal(j.status)) {
          un();
          resolve();
        }
      });
    });
  }

  // #272: the pipeline ends at mine. No draft is built, no model is called for one, and the job
  // payload carries no preview fields — the draft screen and its route are deleted.
  it("paste (JC-17) → mine: full flow with feed, and no draft is built", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await startSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: { text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json();
    await waitTerminal(server, jobId);

    const job = await server.app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie } });
    expect(job.json().status).toBe("completed");
    const feed = job.json().progress.feed as string[];
    expect(feed.some((l) => l.includes("Mined"))).toBe(true);
    // #272: the run tailors nothing — no draft step, no wait-screen line about picking a posting.
    expect(feed.some((l) => l.includes("Tailored a draft"))).toBe(false);
    expect(feed.some((l) => l.includes("Picking a live posting"))).toBe(false);
    expect(job.json().progress.preview).toBeUndefined();
    expect(job.json().progress.previewHtml).toBeUndefined();
    expect(job.json().progress.miner).toBeUndefined();
  });

  // #190 AC4/AC5, kept on the ENGINE (#272 removed the pipeline step that used to exercise this
  // end-to-end): the stored, corrected phone wins over the tailor's own header re-read — proven by
  // planting a DIFFERENT phone in the draft's contact line than the stored one. The fake LLM
  // copies the header verbatim (as the real one would), so a plain rendering would show the
  // header's number; only the deterministic post-process in preview.ts can make the stored one
  // appear. The post-deck tailored CV inherits this behaviour through makePreviewStep.
  it("a stored corrected phone prints on the render even though the draft's own contact line carries a different number", async () => {
    const headerDraft: Draft = { ...sampleDraft, contact: "Jane Doe · jane@example.com · +33 6 00 00 00 00" };
    const step = makePreviewStep(llmReturning(headerDraft));
    const rendered = await step(
      { doc: await recordedClaims() },
      ["IT Project Manager"],
      undefined,
      { phone: "+33 6 99 99 99 99", email: null },
    );
    expect(rendered.html).toContain("+33 6 99 99 99 99");
    expect(rendered.html).not.toContain("+33 6 00 00 00 00");
  });

  it("jobs are session-scoped: another session gets 404", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const mine = await startSession(server.app);
    const theirs = await startSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie: mine },
      payload: { text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) },
    });
    const { jobId } = created.json();
    await waitTerminal(server, jobId);
    expect(
      (await server.app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie: theirs } }))
        .statusCode,
    ).toBe(404);
  });

  it("spec §8-3 AC: no export/share/download route exists server-side, and the old preview route is gone (#272)", async () => {
    const server = buildServer();
    await server.app.ready();
    const routes = server.app.printRoutes({ commonPrefix: false });
    for (const forbidden of ["export", "download", "pdf", "docx", "share", "previews"]) {
      expect(routes.toLowerCase()).not.toContain(forbidden);
    }
  });

  // #270 AC5: a person who pastes is not a different kind of visitor. `persistImport` used to be
  // bound only for uploads, so a paste read the CV, showed the facts live, and then stored NOTHING
  // against the session — the proof vanished on reload and the claim store stayed empty.
  it("a paste stores its facts against the session, exactly as an upload does", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await startSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: { text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) },
    });
    const { jobId } = created.json();
    await waitTerminal(server, jobId);

    const job = await server.app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie } });
    const sessionId = (await server.store.get(jobId))!.sessionId!;

    const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().importProof).toEqual(job.json().progress.importProof);
    expect(me.json().importProof.usefulFactCount).toBeGreaterThan(0);
    expect((await server.claims.list(sessionId)).length).toBeGreaterThan(0);
  });

  it("short paste is rejected (min 100 chars)", async () => {
    const server = buildServer();
    const cookie = await startSession(server.app);
    const res = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: { text: "too short" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("JC-13 mine step adapter", () => {
  it("shapes the pipeline payload from a mined doc", async () => {
    const claims = await recordedClaims();
    const step = makeMineStep({ complete: async () => JSON.stringify(claims) });
    const out = await step({ source: "paste", status: "ok", fullText: "cv", blocks: [], stats: { roles: 0, bullets: 0, chars: 2, pages: null } });
    expect(out.roles).toBe(claims.roles.length);
    expect(out.claims.length).toBe(claims.claims.length);
    expect(out.doc.schemaVersion).toBe("1");
  });
});

// #163 — a correction sticks and reaches the tailored CV (ADR-0002).
describe("#163 stored corrected job records feed the tailor", () => {
  const blockDecision = (value: string, quote: string) => ({
    value,
    source_quote: quote,
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
  });
  const minedBlock = {
    id: "scb-regional-pm",
    employer: blockDecision("Standard Chartered", "Standard Chartered Bank"),
    title: blockDecision("Regional PM", "Regional Project Manager"),
    start: {
      value: { year: 2019, month: null, precision: "year" as const },
      source_quote: "2019",
      machine_touch: "verbatim" as const,
      classification: "Verified" as const,
    },
    end: {
      value: { state: "ended" as const, date: { year: 2022, month: null, precision: "year" as const } },
      source_quote: "2022",
      machine_touch: "verbatim" as const,
      classification: "Verified" as const,
    },
    kind: blockDecision("job", "Regional Project Manager") as never,
  };
  const doc = { blocks: [minedBlock], schemaVersion: "1" };

  it("builds the Roles: block from the stored records, corrected values winning (AC1)", async () => {
    const store = new InMemoryJobBlockStore();
    await store.ingest("s1", doc as never, "raw");
    await store.correct("s1", "scb-regional-pm", "title", "Regional Delivery Director");
    const blocks = await store.list("s1");
    const input = buildTailorInput(await recordedClaims(), matchPosting([]), "", { jobBlocks: blocks });
    const rolesSection = input.slice(input.lastIndexOf("Roles:"), input.lastIndexOf("Claims:"));
    expect(rolesSection).toContain("Regional Delivery Director at Standard Chartered (2019 - 2022)");
    expect(rolesSection).not.toContain("Regional PM at"); // the miner's read no longer feeds the tailor
  });

  it("a correction survives a re-upload of the same CV and still reaches the tailor (AC2)", async () => {
    const store = new InMemoryJobBlockStore();
    await store.ingest("s1", doc as never, "raw");
    await store.correct("s1", "scb-regional-pm", "title", "Regional Delivery Director");
    await store.ingest("s1", doc as never, "raw again"); // re-upload: same CV re-mined
    const blocks = await store.list("s1");
    expect(blocks).toHaveLength(1); // never duplicated
    const input = buildTailorInput(await recordedClaims(), matchPosting([]), "", { jobBlocks: blocks });
    expect(input).toContain("Regional Delivery Director");
  });

  it("falls back to the miner's roles when no stored records exist", async () => {
    const claims = await recordedClaims();
    const input = buildTailorInput(claims, matchPosting([]), "", { jobBlocks: [] });
    expect(input).toContain(claims.roles[0]!.title);
  });

  it("education blocks never enter the Roles: block", async () => {
    const store = new InMemoryJobBlockStore();
    const eduBlock = {
      ...minedBlock,
      id: "uni-warsaw",
      employer: blockDecision("University of Warsaw", "University of Warsaw"),
      kind: blockDecision("education", "MSc") as never,
    };
    await store.ingest("s1", { blocks: [eduBlock], schemaVersion: "1" } as never, "raw");
    const input = buildTailorInput(await recordedClaims(), matchPosting([]), "", {
      jobBlocks: await store.list("s1"),
    });
    const rolesSection = input.slice(input.lastIndexOf("Roles:"), input.lastIndexOf("Claims:"));
    expect(rolesSection).not.toContain("University of Warsaw");
  });

  it("advert-tested dimensions enter the input with the summary-promotion instruction (AC3)", async () => {
    const input = buildTailorInput(await recordedClaims(), matchPosting([]), "", {
      advertTests: ["Fluent Mandarin"],
    });
    expect(input).toContain("===ADVERT-TESTS===");
    expect(input).toContain("Fluent Mandarin");
    expect(input).toContain("woven into the summary");
    expect(input).toContain("Never invent a fact");
  });

  it("the lint flags a lost corrected fact and a printed superseded value, in plain words (AC4)", async () => {
    const store = new InMemoryJobBlockStore();
    await store.ingest("s1", doc as never, "raw");
    await store.correct("s1", "scb-regional-pm", "title", "Regional Delivery Director");
    const blocks = await store.list("s1");
    const claims = await recordedClaims();

    // Draft still prints the superseded title and not the corrected one.
    const stale: Draft = {
      ...sampleDraft,
      experience: [{ ...sampleDraft.experience[0]!, role: "Regional PM", employer: "Standard Chartered" }],
    };
    const issues = conservationIssues(claims, stale, blocks);
    expect(issues.some((i) => i.message.includes("corrected title lost"))).toBe(true);
    expect(issues.some((i) => i.message.includes("superseded title printed"))).toBe(true);
    const visitor = issues.map((i) => i.visitor).join(" ");
    expect(visitor).toContain('"Regional Delivery Director"');

    // Draft printing the corrected title passes both checks.
    const corrected: Draft = {
      ...sampleDraft,
      experience: [
        { ...sampleDraft.experience[0]!, role: "Regional Delivery Director", employer: "Standard Chartered" },
      ],
    };
    expect(
      conservationIssues(claims, corrected, blocks).filter((i) => i.message.includes("title")),
    ).toEqual([]);
  });
});

describe("#163 lint — advert-tested promotion and corrected dates", () => {
  it("flags a declared, advert-tested language missing from the summary", async () => {
    const claims = await recordedClaims();
    // sampleDraft's additional carries Polish + English; the advert tests Polish; the summary
    // doesn't mention it → flagged. Once the summary weaves it in, the issue clears.
    const issues = conservationIssues(claims, sampleDraft, [], ["Native Polish required"]);
    expect(issues.some((i) => i.message.includes("advert-tested fact not promoted"))).toBe(true);
    expect(issues.some((i) => i.visitor.includes("Polish"))).toBe(true);
    const promoted: Draft = { ...sampleDraft, summary: `${sampleDraft.summary} Native Polish speaker.` };
    expect(conservationIssues(claims, promoted, [], ["Native Polish required"])).toEqual([]);
  });

  it("does not flag when the advert tests nothing the candidate declared", async () => {
    expect(conservationIssues(await recordedClaims(), sampleDraft, [], ["Fluent Swahili"])).toEqual([]);
  });

  it("flags a corrected start date the printed entry does not carry", async () => {
    const store = new InMemoryJobBlockStore();
    await store.ingest(
      "s1",
      {
        schemaVersion: "1",
        blocks: [
          {
            id: "nrg-pm",
            employer: { value: "Nordic Retail Group", source_quote: "Nordic Retail Group", machine_touch: "verbatim", classification: "Verified" },
            title: { value: "IT Project Manager", source_quote: "IT Project Manager", machine_touch: "verbatim", classification: "Verified" },
            start: { value: { year: 2021, month: null, precision: "year" }, source_quote: "2021", machine_touch: "verbatim", classification: "Verified" },
            end: { value: { state: "ongoing" }, source_quote: "Present", machine_touch: "verbatim", classification: "Verified" },
            kind: { value: "job", source_quote: "IT Project Manager", machine_touch: "verbatim", classification: "Verified" },
          },
        ],
      } as never,
      "raw",
    );
    await store.correct("s1", "nrg-pm", "start", { year: 2020, month: null, precision: "year" });
    const blocks = await store.list("s1");
    const claims = await recordedClaims();
    // sampleDraft prints "Mar 2021 - Present" for Nordic Retail Group — the corrected 2020 is absent.
    const issues = conservationIssues(claims, sampleDraft, blocks);
    expect(issues.some((i) => i.message.includes("corrected start date lost"))).toBe(true);
    const fixed: Draft = {
      ...sampleDraft,
      experience: [{ ...sampleDraft.experience[0]!, dates: "2020 - Present" }],
    };
    expect(conservationIssues(claims, fixed, blocks)).toEqual([]);
  });
});
