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
        { text: "Led the checkout replatforming, delivered 2 months early", claimIds: ["nrg-led-checkout-replatform"] },
        { text: "Managed a budget of EUR 1.2M across 3 vendor teams", claimIds: ["nrg-managed-budget"] },
        { text: "Ran steering committee reporting for the CIO", claimIds: ["nrg-steering-committee-reporting"] },
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
    const draft = await tailorDraft(await recordedClaims(), matchPosting([]), llmReturning(sampleDraft));
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
    expect(issues.some((i) => i.includes("certifications lost"))).toBe(true);
    expect(issues.some((i) => i.includes("languages lost"))).toBe(true);
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
    expect(issues.some((i) => i.includes("made-up-claim"))).toBe(true);
  });

  it("flags an unprinted entry citing a claim id that is not a real source claim", async () => {
    const claims = await recordedClaims();
    const fabricated: Draft = {
      ...sampleDraft,
      experience: [{ ...sampleDraft.experience[0]!, unprinted: ["also-made-up"] }],
    };
    const issues = conservationIssues(claims, fabricated);
    expect(issues.some((i) => i.includes("also-made-up"))).toBe(true);
  });

  it("does not flag claim ids that are real, in bullets or in unprinted", async () => {
    const claims = await recordedClaims();
    const valid: Draft = {
      ...sampleDraft,
      experience: [{ ...sampleDraft.experience[0]!, unprinted: ["nrg-managed-budget"] }],
    };
    expect(conservationIssues(claims, valid)).toEqual([]);
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
    const draft = await tailorDraft(await recordedClaims(), matchPosting([]), llm);
    expect(calls).toBe(2);
    expect(draft.certifications.length).toBe(2);
  });

  it("ships a still-lossy draft after retry instead of failing the job", async () => {
    const lossy = { ...sampleDraft, certifications: [] };
    const draft = await tailorDraft(await recordedClaims(), matchPosting([]), llmReturning(lossy));
    expect(draft.certifications.length).toBe(0); // shipped, flagged via console.warn
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
  async function promptText(): Promise<string> {
    return readFile(join(fixtures, "..", "prompts", "preview-tailor.md"), "utf8");
  }

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

describe("JC-16/17 pipeline end to end (fake LLMs)", () => {
  function fakePipeline() {
    const mined = { schemaVersion: "0", roles: [], claims: [], parser_flags: [] };
    const mine = async () => ({
      doc: (await recordedClaims()) ?? mined,
      claims: (await recordedClaims()).claims,
      roles: 2,
      needsGrill: 2,
    });
    return { mine, preview: makePreviewStep(llmReturning(sampleDraft)) };
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

  it("paste (JC-17) → mine → preview: full flow with feed and watermarked HTML", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await startSession(server.app);
    await server.app.inject({
      method: "PUT",
      url: "/sessions/me/targets",
      headers: { cookie },
      payload: { targetTitles: ["IT Project Manager"] },
    });
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
    expect(feed.some((l) => l.includes("Tailored a draft"))).toBe(true);
    // preview html never travels through the job payload
    expect(job.json().progress.previewHtml).toBeUndefined();
    expect(job.json().progress.miner).toBeUndefined();

    const preview = await server.app.inject({
      method: "GET",
      url: `/previews/${jobId}`,
      headers: { cookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("text/html");
    expect(preview.body).toContain("DRAFT");
  });

  // #190 AC4/AC5: the stored, corrected phone wins over the tailor's own header re-read — proven by
  // planting a DIFFERENT phone in the source document's header than the one the door corrected to.
  // The fake LLM copies the header verbatim (as the real one would), so a plain rendering would show
  // the header's number; only the deterministic post-process in preview.ts can make the corrected
  // one appear. Correcting BEFORE the CV is even seen also proves ADR-0008 §3: the mine step's own
  // "read" write of the header's number must never clobber the person-said correction.
  it("a corrected phone prints on the render even though the CV's own header carries a different number", async () => {
    const headerDraft: Draft = { ...sampleDraft, contact: "Jane Doe · jane@example.com · +33 6 00 00 00 00" };
    const server = buildServer({
      pipeline: { mine: fakePipeline().mine, preview: makePreviewStep(llmReturning(headerDraft)) },
    });
    const cookie = await startSession(server.app);
    const corrected = await server.app.inject({
      method: "PUT",
      url: "/contact",
      headers: { cookie },
      payload: { field: "phone", value: "+33 6 99 99 99 99" },
    });
    expect(corrected.statusCode).toBe(200);

    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: {
        text: "Jane Doe\njane@example.com | +33 6 00 00 00 00\n\nExperience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(
          5,
        ),
      },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json();
    await waitTerminal(server, jobId);

    const preview = await server.app.inject({ method: "GET", url: `/previews/${jobId}`, headers: { cookie } });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain("+33 6 99 99 99 99");
    expect(preview.body).not.toContain("+33 6 00 00 00 00");
  });

  it("previews are session-scoped: another session gets 404", async () => {
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
      (await server.app.inject({ method: "GET", url: `/previews/${jobId}`, headers: { cookie: theirs } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await server.app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie: theirs } }))
        .statusCode,
    ).toBe(404);
  });

  it("JC-16 AC: no export/share/download route exists server-side (checked against the API)", async () => {
    const server = buildServer();
    await server.app.ready();
    const routes = server.app.printRoutes({ commonPrefix: false });
    for (const forbidden of ["export", "download", "pdf", "docx", "share"]) {
      expect(routes.toLowerCase()).not.toContain(forbidden);
    }
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
