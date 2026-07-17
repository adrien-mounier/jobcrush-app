// JC-10 anonymous device sessions. In-memory store behind an interface (same pattern as
// jobs.ts: the Postgres driver lands when JC-6 infra exists). TTL fields exist now so the
// JC-20 purge job can read them later; claimedByUserId is the JC-19 merge hook.
import { randomBytes } from "node:crypto";

export interface SessionRecord {
  id: string;
  token: string;
  createdAt: string;
  lastSeenAt: string;
  claimedByUserId: string | null;
  targetTitles: string[];
}

export interface SessionStore {
  create(): Promise<SessionRecord>;
  getByToken(token: string): Promise<SessionRecord | null>;
  touch(id: string): Promise<void>;
  setTargetTitles(id: string, titles: string[]): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private byToken = new Map<string, SessionRecord>();
  private byId = new Map<string, SessionRecord>();

  async create(): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: randomBytes(8).toString("hex"),
      token: randomBytes(32).toString("base64url"),
      createdAt: now,
      lastSeenAt: now,
      claimedByUserId: null,
      targetTitles: [],
    };
    this.byToken.set(session.token, session);
    this.byId.set(session.id, session);
    return session;
  }

  async getByToken(token: string): Promise<SessionRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async touch(id: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.lastSeenAt = new Date().toISOString();
  }

  async setTargetTitles(id: string, titles: string[]): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.targetTitles = titles;
  }
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
