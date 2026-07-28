import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import {
  InMemoryFamilyLearningStore,
  PgFamilyLearningStore,
  makeFamilyCandidateScreen,
  progressFamilyLearning,
  type FamilyLearningStore,
} from "../src/familyLearning.js";
import type { LlmClient } from "../src/llm.js";
import type { Pool } from "pg";

const drivers: Array<[string, () => FamilyLearningStore]> = [
  ["in-memory", () => new InMemoryFamilyLearningStore()],
  [
    "postgres (pg-mem)",
    () => {
      const { Pool } = newDb().adapters.createPg();
      return new PgFamilyLearningStore(new Pool());
    },
  ],
];
const accepted = {
  outcome: "accepted",
  rationale: "credible job target",
  indicators: ["job_title_shape"],
} as const;

for (const [name, make] of drivers) {
  describe(`FamilyLearningStore contract — ${name}`, () => {
    it("persists privacy-minimized attempts and restores the latest for a session", async () => {
      const store = make();
      await store.init();
      const attempt = await store.submit(
        "session-1",
        "  Orbital   Farm Planner ",
        accepted,
        "Remote",
      );

      expect(await store.latestForSession("session-1")).toEqual(attempt);
      expect(attempt).toMatchObject({
        targetRole: "Orbital   Farm Planner",
        normalizedTargetRole: "orbital farm planner",
        searchArea: "Remote",
        screeningOutcome: "accepted",
        screeningRationale: "credible job target",
        screeningIndicators: ["job_title_shape"],
        status: "research_started",
      });
      expect(JSON.stringify(attempt)).not.toMatch(
        /email|contact|employer|employment|cvContent|history/i,
      );
    });

    it("records a separate traceable duplicate outcome", async () => {
      const store = make();
      await store.init();
      const original = await store.submit("session-1", "Orbital Farm Planner", accepted, null);
      const duplicate = await store.submit(
        "session-2",
        " orbital  farm planner ",
        accepted,
        null,
      );

      expect(duplicate).toMatchObject({
        screeningOutcome: "duplicate",
        status: "rejected",
        duplicateOfAttemptId: original.id,
      });
      expect(duplicate.id).not.toBe(original.id);
    });

    it("persists the ordered validation, publication, and resume lifecycle", async () => {
      const store = make();
      await store.init();
      let attempt = await store.submit("session-1", "Orbital Farm Planner", accepted, null);
      for (const status of [
        "validation_passed",
        "family_published",
        "search_resumed",
      ] as const) {
        attempt = await store.advance(attempt.id, attempt.status, status);
      }
      expect((await store.get(attempt.id))?.status).toBe("search_resumed");
    });

    it("rejects skipped or reversed lifecycle transitions", async () => {
      const store = make();
      await store.init();
      const attempt = await store.submit("session-1", "Orbital Farm Planner", accepted, null);
      await expect(
        store.advance(attempt.id, "research_started", "family_published"),
      ).rejects.toThrow(
        /invalid family learning transition/,
      );
    });
  });
}

it("Postgres atomically accepts one normalized role under concurrent submission", async () => {
  const { Pool } = newDb().adapters.createPg();
  const store = new PgFamilyLearningStore(new Pool());
  await store.init();

  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      store.submit(
        `session-${index}`,
        index % 2 ? " orbital  farm planner " : "Orbital Farm Planner",
        { outcome: "accepted", rationale: "credible job target", indicators: [] },
        "Remote",
      ),
    ),
  );

  expect(attempts.filter((attempt) => attempt.screeningOutcome === "accepted")).toHaveLength(1);
  expect(attempts.filter((attempt) => attempt.screeningOutcome === "duplicate")).toHaveLength(7);
});

it("notification retry reuses its idempotency key after delivery succeeds but persistence fails", async () => {
  const inner = new InMemoryFamilyLearningStore();
  await inner.init();
  let attempt = await inner.submit(
    "session-1",
    "Orbital Farm Planner",
    { outcome: "accepted", rationale: "credible job target", indicators: [] },
    "Remote",
  );
  attempt = await inner.advance(attempt.id, "research_started", "validation_passed");
  attempt = await inner.advance(attempt.id, "validation_passed", "family_published");
  const keys: string[] = [];
  let failPersistenceOnce = true;
  const store: FamilyLearningStore = {
    ...inner,
    init: inner.init.bind(inner),
    submit: inner.submit.bind(inner),
    get: inner.get.bind(inner),
    latestForSession: inner.latestForSession.bind(inner),
    recordEvent: inner.recordEvent.bind(inner),
    advance: async (id, expected, status) => {
      if (expected === "notification_pending" && failPersistenceOnce) {
        failPersistenceOnce = false;
        throw new Error("simulated persistence failure");
      }
      return inner.advance(id, expected, status);
    },
  };
  const notify = async (_attempt: unknown, options: { idempotencyKey: string }) => {
    keys.push(options.idempotencyKey);
  };

  await expect(
    progressFamilyLearning(store, attempt.id, {
      event: "fulfillment_evaluated",
      relevantVacancy: true,
    }, notify),
  ).rejects.toThrow("simulated persistence failure");
  await progressFamilyLearning(
    store,
    attempt.id,
    { event: "fulfillment_evaluated", relevantVacancy: true },
    notify,
  );

  expect(keys).toEqual([`family-learning:${attempt.id}`, `family-learning:${attempt.id}`]);
  expect((await inner.get(attempt.id))?.status).toBe("user_notified");
});

it("model screening accepts only strict privacy-safe structured output", async () => {
  const llm: LlmClient = {
    complete: async () =>
      JSON.stringify({
        outcome: "covered_role",
        rationale: "The target maps to a published family.",
        indicators: ["published_family_match"],
        coveredFamily: { familyId: "delivery", version: 1 },
      }),
  };
  await expect(
    makeFamilyCandidateScreen(llm)({
      targetRole: "Delivery Lead",
      searchArea: "Remote",
      canonicalCandidates: [],
      knownFamilies: [{ familyId: "delivery", version: 1 }],
    }),
  ).resolves.toEqual({
    outcome: "covered_role",
    rationale: "The target maps to a published family.",
    indicators: ["published_family_match"],
    coveredFamily: { familyId: "delivery", version: 1 },
  });
});

it("model screening fails closed on invalid JSON or unsupported outcomes", async () => {
  for (const raw of [
    "not json",
    JSON.stringify({ outcome: "maybe", rationale: "x", indicators: [] }),
  ]) {
    const llm: LlmClient = { complete: async () => raw };
    await expect(
      makeFamilyCandidateScreen(llm)({
        targetRole: "Delivery Lead",
        searchArea: null,
        canonicalCandidates: [],
        knownFamilies: [],
      }),
    ).rejects.toThrow();
  }
});

it("model screening selects the supplied canonical id for a semantic title variant", async () => {
  const canonicalId = "2efaa1f4-5382-4bf8-a76b-01e238bc66a3";
  const llm: LlmClient = {
    complete: async (prompt) => {
      expect(prompt).toContain(canonicalId);
      return JSON.stringify({
        outcome: "equivalent",
        rationale: "Programme Delivery Leader is a semantic variant.",
        indicators: ["semantic_equivalent"],
        canonicalAttemptId: canonicalId,
      });
    },
  };
  await expect(
    makeFamilyCandidateScreen(llm)({
      targetRole: "Programme Delivery Leader",
      searchArea: null,
      canonicalCandidates: [
        {
          id: canonicalId,
          targetRole: "Delivery Lead",
          normalizedTargetRole: "delivery lead",
        },
      ],
      knownFamilies: [],
    }),
  ).resolves.toMatchObject({ outcome: "equivalent", canonicalAttemptId: canonicalId });
});

it("model screening selects the exact supplied published family reference", async () => {
  const llm: LlmClient = {
    complete: async (prompt) => {
      expect(prompt).toContain('"familyId":"delivery-leadership"');
      return JSON.stringify({
        outcome: "covered_role",
        rationale: "The role is already covered.",
        indicators: ["published_family_match"],
        coveredFamily: { familyId: "delivery-leadership", version: 3 },
      });
    },
  };
  await expect(
    makeFamilyCandidateScreen(llm)({
      targetRole: "Delivery Lead",
      searchArea: "Remote",
      canonicalCandidates: [],
      knownFamilies: [{ familyId: "delivery-leadership", version: 3 }],
    }),
  ).resolves.toMatchObject({
    outcome: "covered_role",
    coveredFamily: { familyId: "delivery-leadership", version: 3 },
  });
});

it("semantic equivalent links the canonical attempt and does not start research", async () => {
  const store = new InMemoryFamilyLearningStore();
  await store.init();
  const canonical = await store.submit("s1", "Delivery Lead", accepted, null);
  const equivalent = await store.submit(
    "s2",
    "Programme Delivery Leader",
    {
      outcome: "equivalent",
      rationale: "Semantic title variant of supplied canonical candidate.",
      indicators: ["semantic_equivalent"],
      canonicalAttemptId: canonical.id,
    },
    null,
  );
  expect(equivalent).toMatchObject({
    status: "rejected",
    screeningOutcome: "equivalent",
    canonicalAttemptId: canonical.id,
  });
});

it("known family screening persists its supplied family version and does not start research", async () => {
  const store = new InMemoryFamilyLearningStore();
  await store.init();
  const covered = await store.submit(
    "s1",
    "Delivery Lead",
    {
      outcome: "covered_role",
      rationale: "Maps to supplied published family.",
      indicators: ["published_family_match"],
      coveredFamily: { familyId: "delivery-leadership", version: 1 },
    },
    null,
  );
  expect(covered).toMatchObject({
    status: "rejected",
    screeningOutcome: "covered_role",
    coveredFamily: { familyId: "delivery-leadership", version: 1 },
  });
});

it("Pg status and audit writes roll back together when the audit insert fails", async () => {
  let committedStatus = "research_started";
  let pendingStatus = committedStatus;
  const row = () => ({
    id: "attempt-1",
    session_id: "session-1",
    target_role: "Delivery Lead",
    search_area: null,
    normalized_target_role: "delivery lead",
    screening_outcome: "accepted",
    screening_rationale: "credible",
    screening_indicators: [],
    canonical_attempt_id: null,
    covered_family: null,
    status: committedStatus,
    duplicate_of_attempt_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN") pendingStatus = committedStatus;
      else if (sql.startsWith("UPDATE family_learning_attempts")) {
        pendingStatus = params?.[1] as string;
        return { rows: [{ ...row(), status: pendingStatus }] };
      } else if (sql.includes("INSERT INTO family_learning_events")) {
        throw new Error("forced audit failure");
      } else if (sql === "COMMIT") committedStatus = pendingStatus;
      else if (sql === "ROLLBACK") pendingStatus = committedStatus;
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    connect: async () => client,
    query: async () => ({ rows: [row()] }),
  } as unknown as Pool;
  const store = new PgFamilyLearningStore(pool);

  await expect(
    store.advance("attempt-1", "research_started", "validation_passed"),
  ).rejects.toThrow("forced audit failure");
  expect(committedStatus).toBe("research_started");
});
