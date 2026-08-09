import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRawCv, extractContact, extractRawCv, segment } from "../src/extract.js";
import { buildImportProof, runOnboardingJob, UNPARSEABLE_ERROR } from "../src/pipeline.js";
import { InMemoryJobStore } from "../src/jobs.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fx = (name: string) => readFile(join(fixtures, name));

describe("JC-12 text extraction", () => {
  it("merges equivalent source facts into one coverage unit and excludes inferences", () => {
    const base = {
      semantic_key: "experience-acme-delivery",
      field_key: null,
      field_value: null,
      field_label: null,
      role: "PM - Acme",
      machine_touch: "verbatim" as const,
      classification: "Verified" as const,
      source_quote: "Led delivery",
      needs_grill: false,
      grill_hint: null,
    };
    const proof = buildImportProof([
      { ...base, id: "a", text: "Led Acme delivery." },
      { ...base, id: "b", text: "Led Acme delivery" },
      {
        ...base,
        id: "c",
        semantic_key: "inferred-communication",
        text: "Likely strong communicator",
        machine_touch: "inferred",
        classification: "Partially-Supported",
        needs_grill: true,
        grill_hint: "Confirm communication evidence",
      },
    ]);

    expect(proof).toMatchObject({
      outcome: "success",
      usefulFactCount: 1,
      skippedQuestionCount: 0,
      representativeFacts: [
        { id: "experience-acme-delivery", text: "Led Acme delivery.", provenance: "cv" },
      ],
    });
  });

  it("isolates a structured field conflict and reports truthful partial retained facts", () => {
    const base = {
      role: "Acme",
      machine_touch: "verbatim" as const,
      classification: "Verified" as const,
      source_quote: "Acme role",
      needs_grill: false,
      grill_hint: null,
    };
    const proof = buildImportProof(
      [
        {
          ...base,
          id: "location-bangkok",
          semantic_key: "search-area-bangkok",
          field_key: "search-area",
          field_value: "Bangkok",
          field_label: "Search area",
          text: "Searching in Bangkok",
        },
        {
          ...base,
          id: "location-london",
          semantic_key: "search-area-london",
          field_key: "search-area",
          field_value: "London",
          field_label: "Search area",
          text: "Searching in London",
        },
        {
          ...base,
          id: "skill-sql",
          semantic_key: "skill-sql",
          field_key: null,
          field_value: null,
          field_label: null,
          text: "Used SQL",
        },
      ],
      ["uncovered-section: education"],
    );

    expect(proof.outcome).toBe("partial");
    expect(proof.usefulFactCount).toBe(3);
    expect(proof.conflict).toEqual({
      fieldId: "search-area",
      label: "Search area",
      userResolvedValue: null,
    });
    expect(proof.representativeFacts).toContainEqual({
      id: "skill-sql",
      text: "Used SQL",
      provenance: "cv",
    });
  });

  it("reports no_useful_facts when mining succeeds with only inferred evidence", () => {
    const proof = buildImportProof([
      {
        id: "inferred-leadership",
        semantic_key: "inferred-leadership",
        field_key: null,
        field_value: null,
        field_label: null,
        role: "profile",
        text: "Likely a strong leader",
        machine_touch: "inferred",
        classification: "Partially-Supported",
        source_quote: "worked with teams",
        needs_grill: true,
        grill_hint: "Confirm leadership scope",
      },
    ]);
    expect(proof).toEqual({
      outcome: "no_useful_facts",
      usefulFactCount: 0,
      skippedQuestionCount: 0,
      representativeFacts: [],
      conflict: null,
    });
  });
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

// #190: deterministic phone/email parse over the already-tagged contact block(s).
describe("#190 extractContact — deterministic phone/email parse", () => {
  it("parses both phone and email out of the tagged contact block, source words as origin", () => {
    const blocks = segment("Jane Doe\njane@example.com | +33 6 00 00 00 00\n\nExperience\nPM at X");
    const contact = extractContact(blocks);
    expect(contact.email).toEqual({ value: "jane@example.com", sourceText: "jane@example.com" });
    expect(contact.phone).toEqual({ value: "+33 6 00 00 00 00", sourceText: "+33 6 00 00 00 00" });
  });

  it("a CV with no phone yields an honest absence, never invented", () => {
    const blocks = segment("Jane Doe\njane@example.com\n\nExperience\nPM at X");
    const contact = extractContact(blocks);
    expect(contact.email).toEqual({ value: "jane@example.com", sourceText: "jane@example.com" });
    expect(contact.phone).toBeNull();
  });

  // QA #190 blocking: PHONE_RE could not start on "(", so a bracketed area/country code mined from
  // INSIDE the bracket ("852) 1234 5678") — a value pointing at words the document never contained
  // (ADR-0004 clause 1a defect). Each of these must mine the EXACT source span, bracket included.
  it("a Hong Kong bracketed number mines exactly, bracket included — never from inside it", () => {
    const blocks = segment("Jane Doe\njane@example.com\n(852) 1234 5678\n\nExperience\nPM at X");
    expect(extractContact(blocks).phone).toEqual({ value: "(852) 1234 5678", sourceText: "(852) 1234 5678" });
  });

  it("a standard AU landline format mines exactly, bracket included", () => {
    const blocks = segment("Jane Doe\njane@example.com\n(02) 9000 1000\n\nExperience\nPM at X");
    expect(extractContact(blocks).phone).toEqual({ value: "(02) 9000 1000", sourceText: "(02) 9000 1000" });
  });

  it("a bracketed number with a leading + inside the bracket mines exactly", () => {
    const blocks = segment("Jane Doe\njane@example.com\n(+852) 1234 5678\n\nExperience\nPM at X");
    expect(extractContact(blocks).phone).toEqual({ value: "(+852) 1234 5678", sourceText: "(+852) 1234 5678" });
  });

  it("a CV with no contact block at all yields both absent", () => {
    const contact = extractContact([{ kind: "role", text: "PM at X", confidence: 0.9 }]);
    expect(contact.phone).toBeNull();
    expect(contact.email).toBeNull();
  });
});

describe("JC-12 pipeline job (extract stage over the JC-9 machinery)", () => {
  it("fails safely when every mined claim violates the complete contract", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding", "sess");
    await runOnboardingJob(
      store,
      job.id,
      { type: "paste", text: "Jane Doe\nProject Manager at Acme" },
      [],
      {
        mine: async () => ({
          claims: [{ id: "partial-only", text: "Missing required fields" }],
          needsGrill: 0,
          roles: 1,
        }),
      },
    );
    expect(await store.get(job.id)).toMatchObject({
      status: "failed",
      progress: {
        importProof: {
          outcome: "failed",
          usefulFactCount: 0,
          skippedQuestionCount: 0,
          representativeFacts: [],
        },
      },
    });
  });
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
