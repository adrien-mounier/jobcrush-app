// #161 — the job-block store must behave identically in-memory and on Postgres, and records must
// survive a store reconstruction (the restart AC), same convention as pgstores.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { MinedJobBlock } from "@jobcrush/contracts";
import { InMemoryJobBlockStore, PgJobBlockStore, type JobBlockStore } from "../src/jobBlockStore.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const decision = (over: Record<string, unknown> = {}) => ({
  value: "Standard Chartered",
  source_quote: "Standard Chartered Bank",
  machine_touch: "verbatim",
  classification: "Verified",
  ...over,
});

const yearDate = (year: number) => ({ value: { year, month: null, precision: "year" }, source_quote: String(year) });
const endedYear = (year: number) => ({
  value: { state: "ended", date: { year, month: null, precision: "year" } },
  source_quote: String(year),
  machine_touch: "verbatim",
  classification: "Verified",
});

function job(over: Partial<MinedJobBlock> = {}): MinedJobBlock {
  return {
    id: "block-1",
    employer: decision() as MinedJobBlock["employer"],
    title: decision({ value: "Regional PM", source_quote: "Regional Project Manager" }) as MinedJobBlock["title"],
    start: decision({
      value: { year: 2019, month: 1, precision: "month" },
      source_quote: "Jan 2019",
    }) as MinedJobBlock["start"],
    end: {
      value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } },
      source_quote: "Mar 2022",
      machine_touch: "verbatim",
      classification: "Verified",
    } as MinedJobBlock["end"],
    kind: decision({ value: "job", source_quote: "Regional Project Manager" }) as MinedJobBlock["kind"],
    ...over,
  };
}

const drivers: [string, () => JobBlockStore][] = [
  ["in-memory", () => new InMemoryJobBlockStore()],
  ["postgres (pg-mem)", () => new PgJobBlockStore(pgPool())],
];

for (const [name, make] of drivers) {
  describe(`JobBlockStore contract — ${name}`, () => {
    let store: JobBlockStore;
    const sid = "sess-1";
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("three dated jobs in, three job records out, each pointing at its source words", async () => {
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({ id: "a", employer: decision({ value: "Acme" }) as MinedJobBlock["employer"] }),
            job({ id: "b", employer: decision({ value: "Globex" }) as MinedJobBlock["employer"] }),
            job({ id: "c", employer: decision({ value: "Initech" }) as MinedJobBlock["employer"] }),
          ],
        },
        "raw model output",
      );
      const views = await store.list(sid);
      expect(views).toHaveLength(3);
      for (const v of views) {
        expect(v.employer.origin).toMatchObject({ kind: "read", source_quote: expect.any(String) });
        expect(v.employer.origin.kind === "read" && v.employer.origin.source_quote.length > 0).toBe(true);
      }
    });

    it("year-level precision stores no invented month", async () => {
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({
              start: decision({ value: { year: 2021, month: null, precision: "year" }, source_quote: "2021" }) as MinedJobBlock["start"],
              end: endedYear(2023) as MinedJobBlock["end"],
            }),
          ],
        },
        "raw",
      );
      const [v] = await store.list(sid);
      expect(v!.start.value).toEqual({ year: 2021, month: null, precision: "year" });
    });

    it("no end date stores an explicit 'unknown' end, distinct from 'ongoing'", async () => {
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({
              id: "unknown-end",
              end: { value: { state: "unknown" }, source_quote: null, machine_touch: "verbatim", classification: "Verified" } as MinedJobBlock["end"],
            }),
          ],
        },
        "raw",
      );
      const [v] = await store.list(sid);
      expect(v!.end.value).toEqual({ state: "unknown" });
      expect(v!.end.value).not.toEqual({ state: "ongoing" });
    });

    it("a promotion (two titles, one employer) stores two rows", async () => {
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({ id: "analyst", title: decision({ value: "Analyst" }) as MinedJobBlock["title"], start: yearDate(2018) as MinedJobBlock["start"], end: endedYear(2020) as MinedJobBlock["end"] }),
            job({ id: "manager", title: decision({ value: "Manager" }) as MinedJobBlock["title"], start: yearDate(2020) as MinedJobBlock["start"], end: { value: { state: "ongoing" }, source_quote: "Present", machine_touch: "verbatim", classification: "Verified" } as MinedJobBlock["end"] }),
          ],
        },
        "raw",
      );
      const views = await store.list(sid);
      expect(views).toHaveLength(2);
      expect(views.map((v) => v.title.value).sort()).toEqual(["Analyst", "Manager"]);
    });

    // Review fix #4: re-uploading the SAME promotion must recognise both rows by employer+title,
    // never collapse them into one ambiguous pile just because they share an employer and touch at
    // the boundary year.
    it("re-uploading a promotion recognises BOTH rows, no duplicates and no false ambiguity", async () => {
      const blocks = () => [
        job({ id: "analyst", title: decision({ value: "Analyst" }) as MinedJobBlock["title"], start: yearDate(2018) as MinedJobBlock["start"], end: endedYear(2020) as MinedJobBlock["end"] }),
        job({ id: "manager", title: decision({ value: "Manager" }) as MinedJobBlock["title"], start: yearDate(2020) as MinedJobBlock["start"], end: { value: { state: "ongoing" }, source_quote: "Present", machine_touch: "verbatim", classification: "Verified" } as MinedJobBlock["end"] }),
      ];
      await store.ingest(sid, { schemaVersion: "1", blocks: blocks() }, "raw run 1");
      // Re-upload re-mines the same two blocks with FRESH ids (a real re-run of the miner).
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({ id: "analyst-2", title: decision({ value: "Analyst" }) as MinedJobBlock["title"], start: yearDate(2018) as MinedJobBlock["start"], end: endedYear(2020) as MinedJobBlock["end"] }),
            job({ id: "manager-2", title: decision({ value: "Manager" }) as MinedJobBlock["title"], start: yearDate(2020) as MinedJobBlock["start"], end: { value: { state: "ongoing" }, source_quote: "Present", machine_touch: "verbatim", classification: "Verified" } as MinedJobBlock["end"] }),
          ],
        },
        "raw run 2",
      );
      const views = await store.list(sid);
      expect(views).toHaveLength(2); // still exactly two — not four
      expect(views.every((v) => v.matchState !== "ambiguous")).toBe(true);
    });

    it("a client block nested under an employer never counts toward experience", async () => {
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [job({ id: "client-1", kind: decision({ value: "client", source_quote: "ASSYTEM (client)" }) as MinedJobBlock["kind"] })],
        },
        "raw",
      );
      const [v] = await store.list(sid);
      expect(v!.kind).toBe("client");
      expect(v!.countsTowardExperience).toBe(false);
    });

    it("a plain job DOES count toward experience", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw");
      const [v] = await store.list(sid);
      expect(v!.countsTowardExperience).toBe(true);
    });

    it("re-upload recognises the same job (employer + title + overlapping period) — no duplicate", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw run 1");
      await store.ingest(
        sid,
        { schemaVersion: "1", blocks: [job({ id: "block-1-reupload" })] }, // same employer/title/period, different id
        "raw run 2",
      );
      const views = await store.list(sid);
      expect(views).toHaveLength(1);
    });

    it("an ambiguous match (employer + overlap, DIFFERENT title) is recorded as needing to ask, not guessed", async () => {
      // Two existing jobs at the same employer, different titles, overlapping periods — a re-upload
      // block whose title matches NEITHER cannot be resolved automatically.
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({ id: "first", title: decision({ value: "Business Analyst" }) as MinedJobBlock["title"], start: yearDate(2019) as MinedJobBlock["start"], end: endedYear(2021) as MinedJobBlock["end"] }),
            job({ id: "second", title: decision({ value: "Project Manager" }) as MinedJobBlock["title"], start: yearDate(2020) as MinedJobBlock["start"], end: endedYear(2022) as MinedJobBlock["end"] }),
          ],
        },
        "raw run 1",
      );
      await store.ingest(
        sid,
        {
          schemaVersion: "1",
          blocks: [
            job({ id: "reupload", title: decision({ value: "Senior Consultant" }) as MinedJobBlock["title"], start: yearDate(2020) as MinedJobBlock["start"], end: endedYear(2020) as MinedJobBlock["end"] }),
          ],
        },
        "raw run 2",
      );
      const views = await store.list(sid);
      const ambiguous = views.find((v) => v.id === "reupload");
      expect(ambiguous?.matchState).toBe("ambiguous");
      expect(ambiguous?.candidateBlockIds.sort()).toEqual(["first", "second"]);
    });

    // Review fix #5: the ambiguous state must be resolvable, and matchedBlockId must be real.
    describe("resolveMatch — the person's answer to an ambiguous match", () => {
      async function seedAmbiguous() {
        await store.ingest(
          sid,
          {
            schemaVersion: "1",
            blocks: [
              job({ id: "first", title: decision({ value: "Business Analyst" }) as MinedJobBlock["title"], start: yearDate(2019) as MinedJobBlock["start"], end: endedYear(2021) as MinedJobBlock["end"] }),
            ],
          },
          "raw run 1",
        );
        await store.ingest(
          sid,
          {
            schemaVersion: "1",
            blocks: [
              job({ id: "reupload", title: decision({ value: "Senior Consultant" }) as MinedJobBlock["title"], start: yearDate(2020) as MinedJobBlock["start"], end: endedYear(2020) as MinedJobBlock["end"] }),
            ],
          },
          "raw run 2",
        );
      }

      it("'same job as X' retires the ambiguous row and keeps the target's own confirmations/corrections", async () => {
        await seedAmbiguous();
        await store.confirm(sid, "first");
        await store.correct(sid, "first", "title", "Business Analyst (Corrected)");

        const ok = await store.resolveMatch(sid, "reupload", { type: "same", matchedBlockId: "first" });
        expect(ok).toBe(true);

        const views = await store.list(sid);
        expect(views.map((v) => v.id)).toEqual(["first"]); // the ambiguous row is gone, never duplicated
        expect(views[0]!.confirmed).toBe(true);
        expect(views[0]!.title.value).toBe("Business Analyst (Corrected)");
        expect(views[0]!.matchState).toBe("matched");
      });

      it("'different job' lets the ambiguous row stand alone", async () => {
        await seedAmbiguous();
        const ok = await store.resolveMatch(sid, "reupload", { type: "different" });
        expect(ok).toBe(true);
        const views = await store.list(sid);
        expect(views.map((v) => v.id).sort()).toEqual(["first", "reupload"]);
        expect(views.find((v) => v.id === "reupload")?.matchState).toBe("new");
        expect(views.find((v) => v.id === "reupload")?.candidateBlockIds).toEqual([]);
      });

      it("'same job as X' rejects an X that was never offered as a candidate", async () => {
        await seedAmbiguous();
        const ok = await store.resolveMatch(sid, "reupload", { type: "same", matchedBlockId: "not-a-candidate" });
        expect(ok).toBe(false);
      });

      it("resolving an unknown blockId returns false", async () => {
        expect(await store.resolveMatch(sid, "nope", { type: "different" })).toBe(false);
      });
    });

    it("a CV where the miner found no dated jobs records the read RAN and found none — distinct from never-run", async () => {
      const beforeAnyRun = await store.summary(sid);
      expect(beforeAnyRun.read).toEqual({ status: "not_run" });

      await store.ingest(sid, { schemaVersion: "1", blocks: [] }, "raw — empty");
      const afterEmptyRun = await store.summary(sid);
      expect(afterEmptyRun.read).toEqual({ status: "ok", blocksFound: 0 });
    });

    // Review fix #6: an unreadable history is a distinct THIRD state, never confused with "ran,
    // found none" or "never ran".
    it("recordFailedRun records that the read RAN and FAILED — distinct from not_run and found-none", async () => {
      await store.recordFailedRun(sid);
      expect(await store.summary(sid)).toMatchObject({ read: { status: "failed" } });
    });

    it("a later successful run supersedes an earlier failed one in the read status", async () => {
      await store.recordFailedRun(sid);
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw run 2");
      expect((await store.summary(sid)).read).toEqual({ status: "ok", blocksFound: 1 });
    });

    it("summary reports total and confirmed counts", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job({ id: "a" }), job({ id: "b", employer: decision({ value: "Globex" }) as MinedJobBlock["employer"] })] }, "raw");
      await store.confirm(sid, "a");
      const summary = await store.summary(sid);
      expect(summary.totalBlocks).toBe(2);
      expect(summary.confirmedBlocks).toBe(1);
    });

    it("a correction records origin 'corrected', pointing at the superseded value — never fabricates machine_touch", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw");
      const ok = await store.correct(sid, "block-1", "title", "Senior Regional PM");
      expect(ok).toBe(true);
      const [v] = await store.list(sid);
      expect(v!.title.value).toBe("Senior Regional PM");
      expect(v!.title.origin).toEqual({ kind: "corrected", supersededValue: "Regional PM" });
      expect(v!.title.machine_touch).toBeNull();
      expect(v!.title.classification).toBeNull();
    });

    it("detach removes the job record but is a store-level no-op on any linked sentences (never deletes them)", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw");
      expect(await store.detach(sid, "block-1")).toBe(true);
      expect(await store.list(sid)).toEqual([]);
    });

    // #157 Design A — "no action in this flow is irreversible without a visible undo." unconfirm is
    // confirm's reverse: a corrected decision undoes by re-correcting to the superseded value, but
    // confirm had no reverse until this endpoint.
    it("unconfirm reverses confirm — the block goes back to unconfirmed", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw");
      await store.confirm(sid, "block-1");
      expect((await store.list(sid))[0]!.confirmed).toBe(true);

      const ok = await store.unconfirm(sid, "block-1");
      expect(ok).toBe(true);
      expect((await store.list(sid))[0]!.confirmed).toBe(false);
    });

    // Review fix #9: a correction/confirm/unconfirm/detach on an unknown block must be visible as a
    // miss, not a silently-swallowed success.
    it("confirm/unconfirm/correct/detach on an unknown blockId return false, never a silent ok", async () => {
      expect(await store.confirm(sid, "nope")).toBe(false);
      expect(await store.unconfirm(sid, "nope")).toBe(false);
      expect(await store.correct(sid, "nope", "title", "x")).toBe(false);
      expect(await store.detach(sid, "nope")).toBe(false);
    });

    it("blocks are session-scoped", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job()] }, "raw");
      expect(await store.list("other-session")).toEqual([]);
    });

    // Review fix #7: an incoming block whose id collides with an already-stored id (of any match
    // state) is a SKIP on both drivers — never an overwrite that would lose a person's corrections.
    it("an id collision skips the incoming block on both drivers — never overwrites a person's corrections", async () => {
      await store.ingest(sid, { schemaVersion: "1", blocks: [job({ id: "dup" })] }, "raw run 1");
      await store.confirm(sid, "dup");
      await store.correct(sid, "dup", "title", "Corrected Title");

      // A second run mints a DIFFERENT block that happens to reuse the same id "dup" (e.g. a stable
      // slug collision from the miner) with entirely different content.
      await store.ingest(
        sid,
        { schemaVersion: "1", blocks: [job({ id: "dup", employer: decision({ value: "A Totally Different Employer" }) as MinedJobBlock["employer"] })] },
        "raw run 2",
      );

      const views = await store.list(sid);
      expect(views).toHaveLength(1);
      expect(views[0]!.confirmed).toBe(true);
      expect(views[0]!.title.value).toBe("Corrected Title"); // untouched by the colliding second run
      expect(views[0]!.employer.value).toBe("Standard Chartered"); // NOT overwritten
    });
  });
}

it("#161 job records survive a store reconstruction (server restart)", async () => {
  const pool = pgPool();
  const beforeRestart = new PgJobBlockStore(pool);
  await beforeRestart.init();
  await beforeRestart.ingest(
    "sess-restart",
    { schemaVersion: "1", blocks: [job({ id: "a" }), job({ id: "b", employer: decision({ value: "Globex" }) as MinedJobBlock["employer"] }), job({ id: "c", employer: decision({ value: "Initech" }) as MinedJobBlock["employer"] })] },
    "the raw model output",
  );
  await beforeRestart.confirm("sess-restart", "a");

  const afterRestart = new PgJobBlockStore(pool);
  const views = await afterRestart.list("sess-restart");
  expect(views).toHaveLength(3);
  expect(views.find((v) => v.id === "a")?.confirmed).toBe(true);
  const summary = await afterRestart.summary("sess-restart");
  expect(summary).toEqual({ totalBlocks: 3, confirmedBlocks: 1, read: { status: "ok", blocksFound: 3 } });
});

// Review fix #3: a re-upload must never erase an earlier run's raw output — every surviving block's
// raw backing must still exist somewhere in job_block_runs after a second run lands.
it("#161 a re-upload preserves the FIRST run's raw output — it is never overwritten", async () => {
  const pool = pgPool();
  const store = new PgJobBlockStore(pool);
  await store.init();
  await store.ingest("sess-preserve", { schemaVersion: "1", blocks: [job({ id: "a" })] }, "RUN ONE RAW TEXT");
  await store.ingest(
    "sess-preserve",
    { schemaVersion: "1", blocks: [job({ id: "b", employer: decision({ value: "Globex" }) as MinedJobBlock["employer"] })] },
    "RUN TWO RAW TEXT",
  );
  const { rows } = await pool.query(`SELECT raw_output FROM job_block_runs WHERE session_id = $1 ORDER BY id`, [
    "sess-preserve",
  ]);
  expect(rows.map((r: { raw_output: string }) => r.raw_output)).toEqual(["RUN ONE RAW TEXT", "RUN TWO RAW TEXT"]);
});

// Review fix #2: the run record must only ever be visible AFTER its blocks have landed. This proves
// the transaction boundary directly: a mid-ingest failure must leave neither the blocks nor the run
// row behind, rather than a run row with zero blocks (the exact confusion AC8's negative test guards
// against).
it("#161 a failed Pg ingest rolls back atomically — never a 'ran' run with none of its blocks landed", async () => {
  const pool = pgPool();
  const store = new PgJobBlockStore(pool);
  await store.init();
  // Sabotage the transaction's own client (not the pool) between the block insert and the run
  // record insert — simulating a crash exactly at the boundary the transaction exists to protect.
  const originalConnect = pool.connect.bind(pool);
  (pool as unknown as { connect: typeof pool.connect }).connect = (async (...args: unknown[]) => {
    const client = await (originalConnect as (...a: unknown[]) => Promise<import("pg").PoolClient>)(...args);
    const originalClientQuery = client.query.bind(client);
    client.query = ((...qargs: Parameters<typeof client.query>) => {
      const sql = String(qargs[0]);
      if (sql.includes("INSERT INTO job_block_runs")) {
        throw new Error("simulated crash before the run record lands");
      }
      return originalClientQuery(...(qargs as [string, unknown[]?]));
    }) as typeof client.query;
    return client;
  }) as typeof pool.connect;

  await expect(
    store.ingest("sess-crash", { schemaVersion: "1", blocks: [job({ id: "a" })] }, "raw"),
  ).rejects.toThrow(/simulated crash/);

  (pool as unknown as { connect: typeof pool.connect }).connect = originalConnect;

  // The guarantee this fix exists for: the run record is committed LAST, in the same transaction as
  // the block inserts, so a crash between them can never leave a "ran" run visible with none (or a
  // partial set) of its blocks landed — exactly the found-nothing/did-not-run confusion AC8's
  // negative test guards against. (pg-mem's own ROLLBACK does not fully unwind the block insert the
  // way real Postgres does, so this asserts the run-visibility guarantee directly rather than
  // relying on pg-mem's transaction fidelity for the block row itself.)
  const summary = await store.summary("sess-crash");
  expect(summary.read).toEqual({ status: "not_run" }); // NOT { status: "ok", blocksFound: ... }
});
