// E2/JC-18/19 accounts + magic-link tokens. Two drivers (same pattern as sessions/claims): in-memory
// (dev/tests) and Postgres (DATABASE_URL). Security lives here: tokens are single-use and time-boxed,
// and only their SHA-256 is ever stored — the raw token exists only in the email link.
//
// A "user" is just an email with an id. Signup == the first successful verify (magic-link collapses
// signup and verification into one act), so a token may exist before its user row.
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { getPool } from "./db.js";

export interface User {
  id: string;
  email: string;
}

/** What a consumed magic-link token yields: the email, and the anonymous session that requested it. */
export interface ConsumedToken {
  email: string;
  /** The session that was active when the link was requested — the one holding the job/claims.
      null when the link was requested with no session. See routes/auth.ts verify for why this matters. */
  pendingSessionId: string | null;
}

export interface AuthStore {
  init(): Promise<void>;
  /** Store a token hash for an email, invalidating any prior token for that email (one live link).
      `pendingSessionId` is the requesting session, carried so verify can claim the RIGHT session even
      when the link is opened in a different browser (the JC-18 cross-browser fix). */
  createToken(
    email: string,
    tokenHash: string,
    expiresAt: string,
    pendingSessionId?: string | null,
  ): Promise<void>;
  /** If the hash is an unused, unexpired token: mark it used and return {email, pendingSessionId}; else null. */
  consumeToken(tokenHash: string): Promise<ConsumedToken | null>;
  /** Create-or-get the user for an email. */
  upsertUser(email: string): Promise<User>;
  getUserById(id: string): Promise<User | null>;
}

interface TokenRow {
  email: string;
  expiresAt: string;
  usedAt: string | null;
  pendingSessionId: string | null;
}

export class InMemoryAuthStore implements AuthStore {
  private usersByEmail = new Map<string, User>();
  private usersById = new Map<string, User>();
  private tokens = new Map<string, TokenRow>();

  async init(): Promise<void> {}

  async createToken(
    email: string,
    tokenHash: string,
    expiresAt: string,
    pendingSessionId: string | null = null,
  ): Promise<void> {
    for (const [hash, t] of this.tokens) if (t.email === email) this.tokens.delete(hash);
    this.tokens.set(tokenHash, { email, expiresAt, usedAt: null, pendingSessionId });
  }

  async consumeToken(tokenHash: string): Promise<ConsumedToken | null> {
    const t = this.tokens.get(tokenHash);
    if (!t || t.usedAt || t.expiresAt <= new Date().toISOString()) return null;
    t.usedAt = new Date().toISOString();
    return { email: t.email, pendingSessionId: t.pendingSessionId };
  }

  async upsertUser(email: string): Promise<User> {
    const existing = this.usersByEmail.get(email);
    if (existing) return existing;
    const user: User = { id: randomBytes(8).toString("hex"), email };
    this.usersByEmail.set(email, user);
    this.usersById.set(user.id, user);
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.usersById.get(id) ?? null;
  }
}

const AUTH_TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
     id         text PRIMARY KEY,
     email      text UNIQUE NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS login_tokens (
     token_hash         text PRIMARY KEY,
     email              text NOT NULL,
     expires_at         timestamptz NOT NULL,
     used_at            timestamptz,
     pending_session_id text
   )`,
];

export class PgAuthStore implements AuthStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    for (const ddl of AUTH_TABLES) await this.pool.query(ddl);
    // Additive migration for token tables created before JC-18's cross-browser fix. Idempotent;
    // best-effort so it never blocks startup (and pg-mem, which lacks ADD COLUMN IF NOT EXISTS on
    // older builds, just no-ops — the fresh CREATE TABLE above already has the column).
    await this.pool
      .query(`ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS pending_session_id text`)
      .catch(() => {});
  }

  async createToken(
    email: string,
    tokenHash: string,
    expiresAt: string,
    pendingSessionId: string | null = null,
  ): Promise<void> {
    await this.pool.query(`DELETE FROM login_tokens WHERE email = $1`, [email]);
    await this.pool.query(
      `INSERT INTO login_tokens (token_hash, email, expires_at, pending_session_id) VALUES ($1, $2, $3, $4)`,
      [tokenHash, email, expiresAt, pendingSessionId],
    );
  }

  async consumeToken(tokenHash: string): Promise<ConsumedToken | null> {
    // Single-use + unexpired, atomically: only an unused, live token flips to used and returns email.
    const { rows } = await this.pool.query(
      `UPDATE login_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING email, pending_session_id`,
      [tokenHash],
    );
    return rows[0]
      ? { email: rows[0].email as string, pendingSessionId: (rows[0].pending_session_id as string) ?? null }
      : null;
  }

  async upsertUser(email: string): Promise<User> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, email`,
      [randomBytes(8).toString("hex"), email],
    );
    return { id: rows[0].id as string, email: rows[0].email as string };
  }

  async getUserById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query(`SELECT id, email FROM users WHERE id = $1`, [id]);
    return rows[0] ? { id: rows[0].id as string, email: rows[0].email as string } : null;
  }
}

/** Postgres when DATABASE_URL is set (JC-6), in-memory otherwise (dev/tests). */
export function authStoreFromEnv(databaseUrl?: string): AuthStore {
  return databaseUrl ? new PgAuthStore(getPool(databaseUrl)) : new InMemoryAuthStore();
}
