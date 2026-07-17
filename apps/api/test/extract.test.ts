import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRawCv, extractRawCv, segment } from "../src/extract.js";
import { runOnboardingJob, UNPARSEABLE_ERROR } from "../src/pipeline.js";
import { InMemoryJobStore } from "../src/jobs.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fx = (name: string) => readFile(join(fixtures, name));

describe("JC-12 text extraction", () => {
  it("clean 2-page PDF: sections found, roles and bullets counted", async () => {
    const raw = await extractRawCv(await fx("clean.pdf"), "pdf");
    expect(raw.status).toBe("ok");
    expect(raw.stats.pages).toBe(2);
    const kinds = raw.blocks.map((b) => b.kind);
    expect(kinds).toContain("role");
    expect(kinds).toContain("education");
    expect(kinds).toContain("skills");
    expect(raw.stats.roles).toBe(2);
    expect(raw.stats.bullets).toBeGreaterThanOrEqual(4);
    expect(raw.fullText).toContain("Nordic Retail Group");
  });

  it("LinkedIn-style profile PDF parses with experience content", async () => {
    const raw = await extractRawCv(await fx("linkedin-profile.pdf"), "pdf");
    expect(raw.status).toBe("ok");
    expect(raw.fullText).toContain("Klarnify");
    expect(raw.blocks.some((b) => b.kind === "role")).toBe(true);
    expect(raw.blocks.some((b) => b.kind === "skills")).toBe(true);
  });

  it("hostile two-column PDF still yields text and never crashes", async () => {
    const raw = await extractRawCv(await fx("two-column.pdf"), "pdf");
    expect(raw.status).toBe("ok");
    // Column interleaving garbles order — the guarantee is graceful text, not perfect structure.
    expect(raw.fullText).toContain("UrbanMobility");
    expect(raw.fullText).toContain("lena.fischer@example.com");
    expect(raw.blocks.length).toBeGreaterThan(0);
  });

  it("scanned PDF (no text layer) is unparseable, never garbage", async () => {
    const raw = await extractRawCv(await fx("scanned.pdf"), "pdf");
    expect(raw.status).toBe("unparseable");
    expect(raw.blocks).toEqual([]);
  });

  it("clean DOCX extracts sections via mammoth", async () => {
    const raw = await extractRawCv(await fx("clean.docx"), "docx");
    expect(raw.status).toBe("ok");
    expect(raw.fullText).toContain("SaigonSoft");
    expect(raw.blocks.some((b) => b.kind === "role")).toBe(true);
    expect(raw.blocks.some((b) => b.kind === "education")).toBe(true);
  });

  it("hostile table-based DOCX still yields the row text", async () => {
    const raw = await extractRawCv(await fx("table-based.docx"), "docx");
    expect(raw.status).toBe("ok");
    expect(raw.fullText).toContain("CloudWorks India");
    expect(raw.fullText).toContain("Anna University");
  });

  it("plain TXT passes through and segments", async () => {
    const raw = await extractRawCv(await fx("plain.txt"), "txt");
    expect(raw.status).toBe("ok");
    expect(raw.blocks.some((b) => b.kind === "role")).toBe(true);
    expect(raw.stats.bullets).toBe(3);
  });

  it("preamble contact details are classified without an explicit heading", () => {
    const blocks = segment("Jane Doe\njane@example.com | +33 6 00 00 00 00\n\nExperience\nPM at X");
    expect(blocks[0]).toMatchObject({ kind: "contact" });
    expect(blocks[0].confidence).toBeLessThan(0.9);
  });
});

describe("JC-12 pipeline job (extract stage over the JC-9 machinery)", () => {
  it("upload input runs to completion with a humanized feed and a rawCv checkpoint", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding");
    await runOnboardingJob(store, job.id, { type: "upload", data: await fx("clean.pdf"), kind: "pdf" }, []);
    const done = await store.get(job.id);
    expect(done?.status).toBe("completed");
    expect((done?.progress.rawCv as { status: string }).status).toBe("ok");
    const feed = done?.progress.feed as string[];
    expect(feed.some((l) => l.match(/Found 2 dated roles/))).toBe(true);
  });

  it("scanned upload fails the job with the unparseable signal (JC-17 trigger)", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding");
    await runOnboardingJob(store, job.id, { type: "upload", data: await fx("scanned.pdf"), kind: "pdf" }, []);
    const done = await store.get(job.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toBe(UNPARSEABLE_ERROR);
    const feed = done?.progress.feed as string[];
    expect(feed.at(-1)).toMatch(/paste your CV text/);
  });

  it("checkpoint rule: a re-run reuses the extracted rawCv", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding");
    const marker = buildRawCv("upload", "Experience\nRole A 2020 - 2024\n- did things", null);
    await store.update(job.id, { progress: { rawCv: marker } });
    // hand it a scanned PDF: if extraction re-ran, the job would fail; the checkpoint must win
    await runOnboardingJob(store, job.id, { type: "upload", data: await fx("scanned.pdf"), kind: "pdf" }, []);
    const done = await store.get(job.id);
    expect(done?.status).toBe("completed");
    expect((done?.progress.rawCv as { fullText: string }).fullText).toContain("Role A");
  });
});
