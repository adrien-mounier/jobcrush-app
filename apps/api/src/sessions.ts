// JC-10 anonymous device sessions. Behind an interface with two drivers: in-memory (dev/tests) and
// Postgres (JC-6 — `DATABASE_URL` set). TTL fields feed the JC-20 purge job later; claimedByUserId is
// the JC-19 merge hook.
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { getPool, iso } from "./db.js";

// Where a session sits in the onboarding loop; the client reads it on load to pick a screen.
// front-door (screen 0) → discovery (#16) → deck → tailor (#21/#23) → grill (JC-24) → ready | loopback.
export type OnboardingStage = "front-door" | "discovery" | "deck" | "tailor" | "grill" | "ready" | "loopback";

export interface SessionRecord {
  id: string;
  token: string;
  createdAt: string;
  lastSeenAt: string;
  claimedByUserId: string | null;
  targetTitles: string[];
  stage: OnboardingStage;
  tailorAdId: string | null;
}

export interface SessionStore {
  /** Create the backing table if needed (no-op for in-memory). Call once at startup. */
  init(): Promise<void>;
  create(): Promise<SessionRecord>;
  getByToken(token: string): Promise<SessionRecord | null>;
  getById(id: string): Promise<SessionRecord | null>;
  touch(id: string): Promise<void>;
  setTargetTitles(id: string, titles: string[]): Promise<void>;
  setStage(id: string, stage: OnboardingStage): Promise<void>;
  setTailorTarget(id: string, adId: string): Promise<void>;
  /** JC-19 merge: claim this anonymous session for a user (the whole merge is this one update). */
  setClaimedByUserId(id: string, userId: string): Promise<void>;
}

function newSession(): SessionRecord {
  const now = new Date().toISOString();
  return {
    id: randomBytes(8).toString("hex"),
    token: randomBytes(32).toString("base64url"),
    createdAt: now,
    lastSeenAt: now,
    claimedByUserId: null,
    targetTitles: [],
    stage: "deck",
    tailorAdId: null,
  };
}

export class InMemorySessionStore implements SessionStore {
  private byToken = new Map<string, SessionRecord>();
  private byId = new Map<string, SessionRecord>();

  async init(): Promise<void> {}

  async create(): Promise<SessionRecord> {
    const session = newSession();
    this.byToken.set(session.token, session);
    this.byId.set(session.id, session);
    return session;
  }

  async getByToken(token: string): Promise<SessionRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async getById(id: string): Promise<SessionRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async touch(id: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.lastSeenAt = new Date().toISOString();
  }

  async setTargetTitles(id: string, titles: string[]): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.targetTitles = titles;
  }

  async setStage(id: string, stage: OnboardingStage): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.stage = stage;
  }

  async setTailorTarget(id: string, adId: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) {
      s.stage = "tailor";
      s.tailorAdId = adId;
    }
  }

  async setClaimedByUserId(id: string, userId: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.claimedByUserId = userId;
  }
}

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id                 text PRIMARY KEY,
  token              text UNIQUE NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  claimed_by_user_id text,
  target_titles      jsonb NOT NULL DEFAULT '[]',
  stage              text NOT NULL DEFAULT 'deck',
  tailor_ad_id       text
)`;

const SESSIONS_ALTERS = [
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tailor_ad_id text",
];

function toSession(r: Record<string, unknown>): SessionRecord {
  const titles = r.target_titles;
  return {
    id: r.id as string,
    token: r.token as string,
    createdAt: iso(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
    claimedByUserId: (r.claimed_by_user_id as string) ?? null,
    targetTitles: Array.isArray(titles) ? (titles as string[]) : JSON.parse((titles as string) ?? "[]"),
    stage: (r.stage as OnboardingStage) ?? "deck",
    tailorAdId: (r.tailor_ad_id as string) ?? null,
  };
}

export class PgSessionStore implements SessionStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(SESSIONS_TABLE);
    for (const alter of SESSIONS_ALTERS) await this.pool.query(alter);
  }

  async create(): Promise<SessionRecord> {
    const s = newSession();
    await this.pool.query(
      `INSERT INTO sessions (id, token, created_at, last_seen_at, claimed_by_user_id, target_titles, stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.id, s.token, s.createdAt, s.lastSeenAt, s.claimedByUserId, JSON.stringify(s.targetTitles), s.stage],
    );
    return s;
  }

  private async one(column: "id" | "token", value: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM sessions WHERE ${column} = $1`, [value]);
    return rows[0] ? toSession(rows[0]) : null;
  }
  getByToken(token: string) { return this.one("token", token); }
  getById(id: string) { return this.one("id", id); }

  async touch(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [id]);
  }
  async setTargetTitles(id: string, titles: string[]): Promise<void> {
    await this.pool.query(`UPDATE sessions SET target_titles = $2 WHERE id = $1`, [id, JSON.stringify(titles)]);
  }
  async setStage(id: string, stage: OnboardingStage): Promise<void> {
    await this.pool.query(`UPDATE sessions SET stage = $2 WHERE id = $1`, [id, stage]);
  }
  async setTailorTarget(id: string, adId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET stage = 'tailor', tailor_ad_id = $2 WHERE id = $1`, [id, adId]);
  }

  async setClaimedByUserId(id: string, userId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET claimed_by_user_id = $2 WHERE id = $1`, [id, userId]);
  }
}

/** Postgres when DATABASE_URL is set (JC-6), in-memory otherwise (dev/tests). */
export function sessionStoreFromEnv(databaseUrl?: string): SessionStore {
  return databaseUrl ? new PgSessionStore(getPool(databaseUrl)) : new InMemorySessionStore();
}

// Per-IP creation rate limit: a dozen per hour is plenty (s1-kickoff). Fixed window.
// ponytail: in-memory fixed window; move to Redis alongside the BullMQ driver if multi-instance.
export class IpRateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private limit = 12,
    private windowMs = 60 * 60 * 1000,
  ) {}

  allow(ip: string): boolean {
    const now = Date.now();
    const w = this.windows.get(ip);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(ip, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}
