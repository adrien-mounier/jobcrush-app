import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CandidateClaims } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import {
  conservationIssues,
  matchPosting,
  makePreviewStep,
  renderPreviewHtml,
  tailorDraft,
  type Draft,
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
      bullets: [
        "Led the checkout replatforming, delivered 2 months early",
        "Managed a budget of EUR 1.2M across 3 vendor teams",
        "Ran steering committee reporting for the CIO",
        "Coordinated cross-functional delivery across vendors",
        "Owned the release calendar across squads",
        "Drove risk and dependency management for delivery",
      ],
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

describe("conservation lint — tailor by emphasis, not amputation", () => {
  it("passes a draft that keeps certs, languages, and current-role density", async () => {
    expect(conservationIssues(await recordedClaims(), sampleDraft)).toEqual([]);
  });

  it("flags dropped certifications, lost languages, and a thinned current role", async () => {
    const lossy: Draft = {
      ...sampleDraft,
      certifications: [],
      additional: [],
      experience: [
        { ...sampleDraft.experience[0]!, bullets: ["Led the checkout replatforming"] },
      ],
    };
    const issues = conservationIssues(await recordedClaims(), lossy);
    expect(issues.some((i) => i.includes("certifications lost"))).toBe(true);
    expect(issues.some((i) => i.includes("languages lost"))).toBe(true);
    expect(issues.some((i) => i.includes("current role too thin"))).toBe(true);
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
