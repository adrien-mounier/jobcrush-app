import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getPool, iso } from "./db.js";
import { z } from "zod";
import type { LlmClient } from "./llm.js";

export type FamilyScreeningOutcome =
  | "accepted"
  | "abuse"
  | "non_job"
  | "duplicate"
  | "equivalent"
  | "covered_role";

export type FamilyLearningStatus =
  | "research_started"
  | "rejected"
  | "validation_passed"
  | "validation_failed"
  | "family_published"
  | "search_resumed"
  | "match_found"
  | "notification_pending"
  | "user_notified";

export interface FamilyScreeningDecision {
  outcome: Exclude<FamilyScreeningOutcome, "duplicate">;
  rationale: string;
  indicators: string[];
  canonicalAttemptId?: string;
  coveredFamily?: { familyId: string; version: number };
}

export interface FamilyLearningAttempt {
  id: string;
  sessionId: string;
  targetRole: string;
  searchArea: string | null;
  normalizedTargetRole: string;
  screeningOutcome: FamilyScreeningOutcome;
  screeningRationale: string;
  screeningIndicators: string[];
  canonicalAttemptId: string | null;
  coveredFamily: { familyId: string; version: number } | null;
  status: FamilyLearningStatus;
  duplicateOfAttemptId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FamilyCandidateScreen = (
  candidate: Readonly<{
    targetRole: string;
    searchArea: string | null;
    canonicalCandidates: Array<{ id: string; targetRole: string; normalizedTargetRole: string }>;
    knownFamilies: Array<{ familyId: string; version: number }>;
  }>,
) => Promise<FamilyScreeningDecision>;

const ScreeningOutput = z
  .object({
    outcome: z.enum(["accepted", "abuse", "non_job", "equivalent", "covered_role"]),
    rationale: z.string().trim().min(1).max(300),
    indicators: z.array(z.string().trim().min(1).max(80)).max(8),
    canonicalAttemptId: z.string().uuid().optional(),
    coveredFamily: z
      .object({ familyId: z.string().min(1), version: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "equivalent" && !value.canonicalAttemptId) {
      ctx.addIssue({ code: "custom", message: "equivalent requires canonicalAttemptId" });
    }
    if (value.outcome === "covered_role" && !value.coveredFamily) {
      ctx.addIssue({ code: "custom", message: "covered_role requires coveredFamily" });
    }
    if (value.outcome !== "equivalent" && value.canonicalAttemptId) {
      ctx.addIssue({ code: "custom", message: "canonicalAttemptId is only valid for equivalent" });
    }
    if (value.outcome !== "covered_role" && value.coveredFamily) {
      ctx.addIssue({ code: "custom", message: "coveredFamily is only valid for covered_role" });
    }
  });

export function makeFamilyCandidateScreen(llm: LlmClient): FamilyCandidateScreen {
  return async ({ targetRole, searchArea, canonicalCandidates, knownFamilies }) => {
    const raw = await llm.complete(
      `Classify a proposed job target for reusable job-family research.
Return JSON only: {"outcome":"accepted|abuse|non_job|equivalent|covered_role","rationale":"privacy-safe reason","indicators":["privacy-safe signal"]}.
Never include contact details, CV content, employment history, or unrelated personal facts.
Rules:
- equivalent: include canonicalAttemptId exactly equal to one id in Canonical candidates; omit coveredFamily.
- covered_role: include coveredFamily exactly equal to one {familyId,version} in Known published families; omit canonicalAttemptId.
- accepted, abuse, non_job: omit both canonicalAttemptId and coveredFamily.
Examples: {"outcome":"equivalent","rationale":"Same role family title.","indicators":["semantic_equivalent"],"canonicalAttemptId":"<supplied id>"}
{"outcome":"covered_role","rationale":"Already covered.","indicators":["published_family_match"],"coveredFamily":{"familyId":"<supplied familyId>","version":1}}
Target role: ${JSON.stringify(targetRole)}
Search area: ${JSON.stringify(searchArea)}
Canonical candidates: ${JSON.stringify(canonicalCandidates.slice(0, 100))}
Known published families: ${JSON.stringify(knownFamilies.slice(0, 100))}`,
      { maxTokens: 500 },
    );
    const decision = ScreeningOutput.parse(JSON.parse(raw));
    if (
      decision.canonicalAttemptId &&
      !canonicalCandidates.some((candidate) => candidate.id === decision.canonicalAttemptId)
    ) {
      throw new Error("screening referenced unknown canonical attempt");
    }
    if (
      decision.coveredFamily &&
      !knownFamilies.some(
        (family) =>
          family.familyId === decision.coveredFamily!.familyId &&
          family.version === decision.coveredFamily!.version,
      )
    ) {
      throw new Error("screening referenced unknown family");
    }
    return decision;
  };
}

export interface FamilyLearningEvent {
  attemptId: string;
  event: string;
  occurredAt: string;
  notificationSent: boolean;
}

export interface FamilyLearningStore {
  init(): Promise<void>;
  submit(
    sessionId: string,
    targetRole: string,
    screening: FamilyScreeningDecision,
    searchArea: string | null,
  ): Promise<FamilyLearningAttempt>;
  get(id: string): Promise<FamilyLearningAttempt | null>;
  latestForSession(sessionId: string): Promise<FamilyLearningAttempt | null>;
  acceptedCanonicalCandidates(): Promise<
    Array<{ id: string; targetRole: string; normalizedTargetRole: string }>
  >;
  advance(
    id: string,
    expected: FamilyLearningStatus,
    status: FamilyLearningStatus,
  ): Promise<FamilyLearningAttempt>;
  recordEvent(event: FamilyLearningEvent): Promise<void>;
}

const normalizeTargetRole = (targetRole: string) =>
  targetRole.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

const publicStatus = (outcome: FamilyScreeningOutcome): FamilyLearningStatus =>
  outcome === "accepted" ? "research_started" : "rejected";

const allowedTransitions: Record<FamilyLearningStatus, FamilyLearningStatus[]> = {
  research_started: ["validation_passed", "validation_failed"],
  rejected: [],
  validation_passed: ["family_published"],
  validation_failed: [],
  family_published: ["search_resumed", "match_found"],
  search_resumed: ["match_found"],
  match_found: ["notification_pending"],
  notification_pending: ["user_notified"],
  user_notified: [],
};

function assertTransition(from: FamilyLearningStatus, to: FamilyLearningStatus) {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`invalid family learning transition: ${from} -> ${to}`);
  }
}

export class InMemoryFamilyLearningStore implements FamilyLearningStore {
  private readonly attempts = new Map<string, FamilyLearningAttempt>();
  private readonly events: FamilyLearningEvent[] = [];

  async init() {}

  async submit(
    sessionId: string,
    targetRole: string,
    screening: FamilyScreeningDecision,
    searchArea: string | null,
  ) {
    const normalizedTargetRole = normalizeTargetRole(targetRole);
    const existing = [...this.attempts.values()].find(
      (attempt) =>
        attempt.normalizedTargetRole === normalizedTargetRole &&
        attempt.screeningOutcome === "accepted",
    );
    const outcome: FamilyScreeningOutcome = existing ? "duplicate" : screening.outcome;
    const now = new Date().toISOString();
    const attempt: FamilyLearningAttempt = {
      id: randomUUID(),
      sessionId,
      targetRole: targetRole.trim(),
      searchArea,
      normalizedTargetRole,
      screeningOutcome: outcome,
      screeningRationale: existing
        ? "Equivalent normalized target already has a reusable research attempt."
        : screening.rationale,
      screeningIndicators: existing ? ["normalized_duplicate"] : [...screening.indicators],
      canonicalAttemptId: existing?.id ?? screening.canonicalAttemptId ?? null,
      coveredFamily: screening.coveredFamily ?? null,
      status: publicStatus(outcome),
      duplicateOfAttemptId: existing?.id ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.attempts.set(attempt.id, attempt);
    await this.recordEvent({
      attemptId: attempt.id,
      event: "submitted",
      occurredAt: now,
      notificationSent: false,
    });
    await this.recordEvent({
      attemptId: attempt.id,
      event: "screened",
      occurredAt: now,
      notificationSent: false,
    });
    await this.recordEvent({
      attemptId: attempt.id,
      event: attempt.status,
      occurredAt: now,
      notificationSent: false,
    });
    return attempt;
  }

  async get(id: string) {
    return this.attempts.get(id) ?? null;
  }

  async latestForSession(sessionId: string) {
    return (
      [...this.attempts.values()]
        .filter((attempt) => attempt.sessionId === sessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }
  async acceptedCanonicalCandidates() {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.screeningOutcome === "accepted")
      .map(({ id, targetRole, normalizedTargetRole }) => ({ id, targetRole, normalizedTargetRole }));
  }

  async advance(
    id: string,
    expected: FamilyLearningStatus,
    status: FamilyLearningStatus,
  ) {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error("family learning attempt not found");
    if (attempt.status !== expected) throw new Error("family learning attempt changed");
    assertTransition(expected, status);
    const updated = { ...attempt, status, updatedAt: new Date().toISOString() };
    this.attempts.set(id, updated);
    await this.recordEvent({
      attemptId: id,
      event: status,
      occurredAt: updated.updatedAt,
      notificationSent: status === "user_notified",
    });
    return updated;
  }

  async recordEvent(event: FamilyLearningEvent) {
    this.events.push(event);
  }
}

const TABLES = `
  CREATE TABLE IF NOT EXISTS family_learning_attempts (
    id text PRIMARY KEY,
    session_id text NOT NULL,
    target_role text NOT NULL,
    search_area text,
    normalized_target_role text NOT NULL,
    screening_outcome text NOT NULL,
    screening_rationale text NOT NULL,
    screening_indicators jsonb NOT NULL DEFAULT '[]',
    canonical_attempt_id text,
    covered_family jsonb,
    status text NOT NULL,
    duplicate_of_attempt_id text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS family_learning_attempts_session_created
    ON family_learning_attempts (session_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS family_learning_one_accepted_normalized_role
    ON family_learning_attempts (normalized_target_role)
    WHERE screening_outcome = 'accepted';
  CREATE TABLE IF NOT EXISTS family_learning_events (
    attempt_id text NOT NULL,
    event text NOT NULL,
    occurred_at timestamptz NOT NULL,
    notification_sent boolean NOT NULL DEFAULT false
  );
`;

function toAttempt(row: Record<string, unknown>): FamilyLearningAttempt {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    targetRole: row.target_role as string,
    searchArea: (row.search_area as string) ?? null,
    normalizedTargetRole: row.normalized_target_role as string,
    screeningOutcome: row.screening_outcome as FamilyScreeningOutcome,
    screeningRationale: row.screening_rationale as string,
    screeningIndicators: Array.isArray(row.screening_indicators)
      ? (row.screening_indicators as string[])
      : JSON.parse((row.screening_indicators as string) ?? "[]"),
    canonicalAttemptId: (row.canonical_attempt_id as string) ?? null,
    coveredFamily: (row.covered_family as FamilyLearningAttempt["coveredFamily"]) ?? null,
    status: row.status as FamilyLearningStatus,
    duplicateOfAttemptId: (row.duplicate_of_attempt_id as string) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PgFamilyLearningStore implements FamilyLearningStore {
  constructor(private readonly pool: Pool) {}

  async init() {
    await this.pool.query(TABLES);
  }

  async submit(
    sessionId: string,
    targetRole: string,
    screening: FamilyScreeningDecision,
    searchArea: string | null,
  ) {
    const normalizedTargetRole = normalizeTargetRole(targetRole);
    const now = new Date().toISOString();
    let outcome: FamilyScreeningOutcome = screening.outcome;
    let duplicateOfAttemptId: string | null = null;
    const attempt: FamilyLearningAttempt = {
      id: randomUUID(),
      sessionId,
      targetRole: targetRole.trim(),
      searchArea,
      normalizedTargetRole,
      screeningOutcome: outcome,
      screeningRationale: screening.rationale,
      screeningIndicators: [...screening.indicators],
      canonicalAttemptId: screening.canonicalAttemptId ?? null,
      coveredFamily: screening.coveredFamily ?? null,
      status: publicStatus(outcome),
      duplicateOfAttemptId,
      createdAt: now,
      updatedAt: now,
    };
    const client = await this.pool.connect();
    const insert = (ignoreAcceptedConflict = false) =>
      client.query(
        `INSERT INTO family_learning_attempts
         (id, session_id, target_role, search_area, normalized_target_role,
          screening_outcome, screening_rationale, screening_indicators,
          canonical_attempt_id, covered_family, status,
          duplicate_of_attempt_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ${ignoreAcceptedConflict ? "ON CONFLICT DO NOTHING" : ""}
         RETURNING id`,
        [
        attempt.id,
        sessionId,
        attempt.targetRole,
        searchArea,
        normalizedTargetRole,
        outcome,
        attempt.screeningRationale,
        JSON.stringify(attempt.screeningIndicators),
        attempt.canonicalAttemptId,
        JSON.stringify(attempt.coveredFamily),
        attempt.status,
        duplicateOfAttemptId,
        now,
        now,
        ],
      );
    try {
      await client.query("BEGIN");
      const inserted = await insert(screening.outcome === "accepted");
      if (screening.outcome === "accepted" && inserted.rows.length === 0) {
        const { rows } = await client.query(
          `SELECT id FROM family_learning_attempts
           WHERE normalized_target_role = $1 AND screening_outcome = 'accepted'`,
          [normalizedTargetRole],
        );
        duplicateOfAttemptId = rows[0]?.id as string;
        outcome = "duplicate";
        attempt.screeningOutcome = outcome;
        attempt.status = "rejected";
        attempt.duplicateOfAttemptId = duplicateOfAttemptId;
        attempt.screeningRationale =
          "Equivalent normalized target already has a reusable research attempt.";
        attempt.screeningIndicators = ["normalized_duplicate"];
        attempt.canonicalAttemptId = duplicateOfAttemptId;
        await insert();
      }
      for (const event of ["submitted", "screened", attempt.status]) {
        await client.query(
          `INSERT INTO family_learning_events
           (attempt_id, event, occurred_at, notification_sent) VALUES ($1,$2,$3,false)`,
          [attempt.id, event, now],
        );
      }
      await client.query("COMMIT");
      return attempt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      "SELECT * FROM family_learning_attempts WHERE id = $1",
      [id],
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }

  async latestForSession(sessionId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM family_learning_attempts
       WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }
  async acceptedCanonicalCandidates() {
    const { rows } = await this.pool.query(
      `SELECT id, target_role, normalized_target_role FROM family_learning_attempts
       WHERE screening_outcome = 'accepted' ORDER BY created_at ASC LIMIT 100`,
    );
    return rows.map((row) => ({
      id: row.id as string,
      targetRole: row.target_role as string,
      normalizedTargetRole: row.normalized_target_role as string,
    }));
  }

  async advance(
    id: string,
    expected: FamilyLearningStatus,
    status: FamilyLearningStatus,
  ) {
    assertTransition(expected, status);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE family_learning_attempts SET status = $2, updated_at = now()
         WHERE id = $1 AND status = $3 RETURNING *`,
        [id, status, expected],
      );
      if (!rows[0]) throw new Error("family learning attempt changed");
      const attempt = toAttempt(rows[0]);
      await client.query(
        `INSERT INTO family_learning_events
         (attempt_id, event, occurred_at, notification_sent) VALUES ($1,$2,$3,$4)`,
        [id, status, attempt.updatedAt, status === "user_notified"],
      );
      await client.query("COMMIT");
      return attempt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordEvent(event: FamilyLearningEvent) {
    await this.pool.query(
      `INSERT INTO family_learning_events
       (attempt_id, event, occurred_at, notification_sent) VALUES ($1,$2,$3,$4)`,
      [event.attemptId, event.event, event.occurredAt, event.notificationSent],
    );
  }
}

export function familyLearningStoreFromEnv(databaseUrl?: string): FamilyLearningStore {
  return databaseUrl
    ? new PgFamilyLearningStore(getPool(databaseUrl))
    : new InMemoryFamilyLearningStore();
}

export type FamilyLearningProgress =
  | { event: "validation_passed" | "validation_failed" | "family_published" }
  | { event: "fulfillment_evaluated"; relevantVacancy: boolean };

export type FamilyMatchNotifier = (
  attempt: Readonly<FamilyLearningAttempt>,
  options: Readonly<{ idempotencyKey: string }>,
) => Promise<void>;

export async function progressFamilyLearning(
  store: FamilyLearningStore,
  id: string,
  progress: FamilyLearningProgress,
  notify?: FamilyMatchNotifier,
) {
  let attempt = await store.get(id);
  if (!attempt) throw new Error("family learning attempt not found");
  if (progress.event !== "fulfillment_evaluated") {
    return store.advance(id, attempt.status, progress.event);
  }
  if (!progress.relevantVacancy) {
    return store.advance(id, attempt.status, "search_resumed");
  }
  if (attempt.status === "family_published" || attempt.status === "search_resumed") {
    attempt = await store.advance(id, attempt.status, "match_found");
  }
  if (!notify) throw new Error("family match notification unavailable");
  if (attempt.status === "match_found") {
    attempt = await store.advance(id, "match_found", "notification_pending");
  }
  if (attempt.status !== "notification_pending") return attempt;
  await notify(attempt, { idempotencyKey: `family-learning:${attempt.id}` });
  return store.advance(id, "notification_pending", "user_notified");
}
