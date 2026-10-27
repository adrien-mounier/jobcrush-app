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
    // #323: a genuine contradiction reads as a question naming both values as the choices.
    expect(proof.conflict).toEqual({
      fieldId: "search-area",
      label: "Search area: your CV says Bangkok and also London. Which one is right?",
      values: ["Bangkok", "London"],
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

  // #310 (QA gate D1): the letterhead is kept whole — it is what the draft engine prints the name
  // and city from, long after the raw CV is gone. Same block slice the old draft caller fed it.
  it("captures the CV's letterhead (contact/preamble blocks) whole, and an honest empty when none", () => {
    const blocks = segment("Jane Doe\nParis, France\njane@example.com\n\nExperience\nPM at X");
    expect(extractContact(blocks).header).toContain("Jane Doe");
    expect(extractContact(blocks).header).toContain("Paris, France");
    expect(extractContact([{ kind: "role", text: "PM at X", confidence: 0.9 }]).header).toBe("");
  });

  // #360: a PDF whose title and summary sit right under the contact line used to arrive as ONE
  // preamble block, so the letterhead swallowed the summary heading and its hard-wrapped lines and
  // the 600-char cap cut it mid-word. The letterhead is name, title and contact details only; the
  // summary stays in the raw CV as its own block, whole, for the miner (#371 reads it sentence by
  // sentence).
  describe("#360 the letterhead stops where the summary starts", () => {
    const SUMMARY_LINES = [
      "Delivery lead with twelve years across retail and logistics platforms. Brings",
      "a track record of landing multi-vendor programmes on time, building teams from",
      "three to thirty, and keeping stakeholders aligned through every change of scope.",
    ];
    const PDF_TEXT = [
      "Priya Raman",
      "priya.raman@example.com | +44 7700 900123 | Manchester, UK",
      "SENIOR PROJECT MANAGER",
      "PROFESSIONAL SUMMARY",
      ...SUMMARY_LINES,
      "",
      "PROFESSIONAL EXPERIENCE",
      "Project Manager — Northwind Retail (2019 – present)",
      "- Led the till replacement across 140 stores.",
    ].join("\n");

    it("yields a letterhead holding only name, title and contact details", () => {
      const { header } = extractContact(segment(PDF_TEXT));
      expect(header).toBe(
        "Priya Raman\npriya.raman@example.com | +44 7700 900123 | Manchester, UK\nSENIOR PROJECT MANAGER",
      );
      expect(header).not.toContain("SUMMARY");
    });

    it("keeps the summary whole in its own block, once, untouched by the letterhead", () => {
      const blocks = segment(PDF_TEXT);
      const summary = blocks.filter((b) => b.text.includes("PROFESSIONAL SUMMARY"));
      expect(summary).toHaveLength(1);
      expect(summary[0].text).toBe(["PROFESSIONAL SUMMARY", ...SUMMARY_LINES].join("\n"));
      expect(summary[0].kind).toBe("other");
    });

    it("never cuts the letterhead mid-word, even when the cap bites", () => {
      const longLine = Array.from({ length: 70 }, (_, i) => `wordnumber${i}`).join(" "); // > 600 chars
      const { header } = extractContact(segment(`Priya Raman\npriya.raman@example.com\n${longLine}\n\nExperience\nPM at X`));
      expect(header.length).toBeLessThanOrEqual(600);
      // the last token is one of the source's whole words, not a fragment of one
      expect(longLine.split(" ")).toContain(header.split(/\s/).at(-1));
    });
  });

  // #381: the letterhead arrives as fields — name, title, location — so check mode's Your details
  // can show each in its own box. An owner-shaped letterhead (name, then a contact line with the
  // city, then the title, then the summary heading): the title is the title, never the summary.
  describe("#381 the letterhead splits into name, title and location", () => {
    const OWNER_SHAPED = [
      "Priya Raman",
      "priya.raman@example.com | +44 7700 900123 | Manchester, UK",
      "SENIOR PROJECT MANAGER",
      "PROFESSIONAL SUMMARY",
      "Delivery lead with twelve years across retail and logistics platforms.",
      "",
      "PROFESSIONAL EXPERIENCE",
      "Project Manager — Northwind Retail (2019 – present)",
      "- Led the till replacement across 140 stores.",
    ].join("\n");

    it("yields the five fields, the title being the title and not the summary", () => {
      const contact = extractContact(segment(OWNER_SHAPED));
      expect(contact.name).toEqual({ value: "Priya Raman", sourceText: "Priya Raman" });
      expect(contact.title).toEqual({ value: "SENIOR PROJECT MANAGER", sourceText: "SENIOR PROJECT MANAGER" });
      expect(contact.location).toEqual({ value: "Manchester, UK", sourceText: "Manchester, UK" });
      expect(contact.email?.value).toBe("priya.raman@example.com");
      expect(contact.phone?.value).toBe("+44 7700 900123");
      expect(contact.title?.value).not.toContain("Delivery lead");
    });

    it("a location on its own line, and a known market without a comma, both read as the location", () => {
      expect(extractContact(segment("Jane Doe\nParis, France\njane@example.com\n\nExperience\nPM at X")).location?.value).toBe("Paris, France");
      expect(extractContact(segment("Jane Doe\njane@example.com · Singapore\n\nExperience\nPM at X")).location?.value).toBe("Singapore");
    });

    it("a CV with no location or title yields honest nulls, never a guess", () => {
      const contact = extractContact(segment("Jane Doe\njane@example.com | +33 6 00 00 00 00\n\nExperience\nPM at X"));
      expect(contact.name?.value).toBe("Jane Doe");
      expect(contact.title).toBeNull();
      expect(contact.location).toBeNull();
      const none = extractContact([{ kind: "role", text: "PM at X", confidence: 0.9 }]);
      expect(none.name).toBeNull();
      expect(none.title).toBeNull();
      expect(none.location).toBeNull();
    });

    // #398: the owner's real letterhead labels its phone ("email - Mobile: <number>") — with the
    // number taken out, the bare label used to be read as the title.
    it("a labelled contact line never yields its label as the title", () => {
      const header = "Sam Okafor\nsam.okafor@example.com - Mobile: (+66) 80-000-0000\nSENIOR PROJECT MANAGER";
      const contact = extractContact(segment(`${header}\n\nExperience\nPM at X`));
      expect(contact.title?.value).toBe("SENIOR PROJECT MANAGER");
      expect(extractContact(segment("Jane Doe\nEmail: jane@example.com | Tel: +33 6 00 00 00 00\n\nExperience\nPM at X")).title).toBeNull();
    });

    // #404: the owner's letterhead separates its parts with a spaced hyphen — the location used to
    // keep the leftover dashes ("Bangkok, Thailand -  -"). An unspaced hyphen is part of a word.
    it("a spaced hyphen or dash separates parts; an unspaced one does not", () => {
      const spaced = extractContact(segment("Sam Okafor\nBangkok, Thailand - Mobile: +66 81 234 5678 - Email: a@b.com\n\nExperience\nPM at X"));
      expect(spaced.location?.value).toBe("Bangkok, Thailand");
      expect(spaced.title).toBeNull();
      const dashes = extractContact(segment("Sam Okafor\nLyon, France – sam@example.com — +33 6 00 00 00 00\n\nExperience\nPM at X"));
      expect(dashes.location?.value).toBe("Lyon, France");
      expect(dashes.title).toBeNull();
      const hyphenated = extractContact(segment("Jean-Pierre Dupont\nAix-en-Provence, France | jp@example.com\nChef de projet\n\nExperience\nPM at X"));
      expect(hyphenated.name?.value).toBe("Jean-Pierre Dupont");
      expect(hyphenated.location?.value).toBe("Aix-en-Provence, France");
      expect(hyphenated.title?.value).toBe("Chef de projet");
    });

    // #402: a contact label the reader has no word list for ("Natel:", "Portable :") is one word
    // and a colon once its value is gone — never a title.
    it("a one-word label left behind by a removed phone or email never yields a title", () => {
      expect(extractContact(segment("Jane Doe\nNatel: +41 79 000 00 00\n\nExperience\nPM at X")).title).toBeNull();
      expect(extractContact(segment("Jane Doe\nPortable : +33 6 00 00 00 00 | Courriel : jane@example.com\n\nExperience\nPM at X")).title).toBeNull();
    });

    // #402 follow-up: two labelled contacts on one line with no separator between them leave a run
    // of bare labels ("Mobile:  Email:") once the values are gone — still never a title.
    it("a run of labels left behind on one unseparated line never yields a title", () => {
      expect(extractContact(segment("Jane Doe\nMobile: +33 6 12 34 56 78 Email: a@b.com\n\nExperience\nPM at X")).title).toBeNull();
      expect(extractContact(segment("Jane Doe\nNatel: +41 79 123 45 67 Courriel : a@b.com\n\nExperience\nPM at X")).title).toBeNull();
    });

    // Pinned: a colon INSIDE a title is a word, not a label. Only a label with nothing after it (its
    // value was a removed email/phone) is dropped, so "Head of Delivery: EMEA" stays whole.
    it("a title with a colon in the middle is kept whole", () => {
      expect(extractContact(segment("Jane Doe\nHead of Delivery: EMEA\njane@example.com\n\nExperience\nPM at X")).title?.value).toBe("Head of Delivery: EMEA");
    });

    // QA on #404: the phone regex swallowed the spaced separator after the number, so Your details
    // read "+66 81 234 5678 -". A phone ends on a digit or a closing bracket, never on a separator.
    it("a phone followed by a spaced separator ends on its last digit", () => {
      expect(extractContact(segment("Sam Okafor\nBangkok, Thailand - Mobile: +66 81 234 5678 - Email: a@b.com\n\nExperience\nPM at X")).phone?.value).toBe("+66 81 234 5678");
      expect(extractContact(segment("Jane Doe\nNatel: +41 79 123 45 67 - Email: a@b.com\n\nExperience\nPM at X")).phone?.value).toBe("+41 79 123 45 67");
      expect(extractContact(segment("Jane Doe\n(852) 1234 5678 - a@b.com\n\nExperience\nPM at X")).phone?.value).toBe("(852) 1234 5678");
    });

    // QA on #404 (a real CV): a spaced dash inside a title-only line is punctuation, not a part
    // separator — "Purchasing Manager - Ingredients & Packaging" was cut to "Purchasing Manager".
    // Only a line that carries an email or phone (the contact line) is split on a spaced dash.
    it("a spaced dash on a line with no contact details does not split a title", () => {
      const c = extractContact(segment("Giuliana Delre\nPurchasing Manager - Ingredients & Packaging\ng@example.com | +41 79 000 00 00\n\nExperience\nPM at X"));
      expect(c.title?.value).toBe("Purchasing Manager - Ingredients & Packaging");
      expect(c.location).toBeNull();
    });

    // QA on #402: with the labels stripped before the edge trim, "E-mail: x, Phone: +33…" left
    // "E-mail:" as the title — the trailing comma hid the first label. Strip and trim until stable.
    it("a label hidden behind a trailing comma is still never a title", () => {
      expect(extractContact(segment("Jane Doe\nE-mail: x@y.com, Phone: +33 6 12 34 56 78\n\nExperience\nPM at X")).title).toBeNull();
    });

    // #410: only the first phone was taken out of a part, so a second one kept its label alive
    // ("E-mail:  , Tel: , Mobile: +33 7 …" became the title). Every phone and email goes; the
    // first of each is still the stored value.
    it("a contact line with two phone numbers leaves no title, and keeps the first phone", () => {
      const c = extractContact(segment("Jane Doe\nE-mail: x@y.com , Tel: +33 6 00 00 00 00, Mobile: +33 7 00 00 00 00\n\nExperience\nPM at X"));
      expect(c.title).toBeNull();
      expect(c.phone?.value).toBe("+33 6 00 00 00 00");
      expect(c.email?.value).toBe("x@y.com");
    });
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
          representativeFacts: [],
        },
      },
    });
  });
  it("upload input runs to completion with a humanized feed and a rawCv checkpoint", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding");
    await runOnboardingJob(store, job.id, { type: "upload", data: await fx("clean.pdf"), kind: "pdf" });
    const done = await store.get(job.id);
    expect(done?.status).toBe("completed");
    expect((done?.progress.rawCv as { status: string }).status).toBe("ok");
    const feed = done?.progress.feed as string[];
    expect(feed.some((l) => l.match(/Found 2 dated roles/))).toBe(true);
  });

  it("scanned upload fails the job with the unparseable signal (JC-17 trigger)", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding");
    await runOnboardingJob(store, job.id, { type: "upload", data: await fx("scanned.pdf"), kind: "pdf" });
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
    await runOnboardingJob(store, job.id, { type: "upload", data: await fx("scanned.pdf"), kind: "pdf" });
    const done = await store.get(job.id);
    expect(done?.status).toBe("completed");
    expect((done?.progress.rawCv as { fullText: string }).fullText).toContain("Role A");
  });
});

// Review fix #6 — an unreadable work history must never fail the whole upload. Binding UX intent:
// "an unreadable history reads as a question, never as a failure."
describe("#161 job-block mining failure isolation", () => {
  it("a job-block miner throw is caught — claims still mine and the job still completes", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding", "sess-1");
    let failureRecordedFor: string | null = null;
    await runOnboardingJob(
      store,
      job.id,
      { type: "paste", text: "Jane Doe\nProject Manager at Acme, 2020-2024" },
      {
        mineJobBlocks: async () => {
          throw new Error("miner output failed validation twice");
        },
        recordJobBlocksFailed: async (sessionId) => {
          failureRecordedFor = sessionId;
        },
        mine: async () => ({
          claims: [
            {
              id: "acme-pm",
              semantic_key: "acme-pm",
              field_key: null,
              field_value: null,
              field_label: null,
              role: "PM - Acme",
              text: "Project Manager at Acme",
              machine_touch: "verbatim",
              classification: "Verified",
              source_quote: "Project Manager at Acme",
              needs_grill: false,
              grill_hint: null,
            },
          ],
          needsGrill: 0,
          roles: 1,
        }),
      },
    );
    const done = await store.get(job.id);
    expect(done?.status).toBe("completed"); // the whole upload did NOT fail
    expect(failureRecordedFor).toBe("sess-1"); // the failure was recorded, not swallowed silently
    const feed = done?.progress.feed as string[];
    expect(feed.some((l) => l.match(/Could not read your work history/))).toBe(true);
  });
});
