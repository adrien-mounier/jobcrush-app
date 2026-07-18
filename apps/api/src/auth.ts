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

export interface AuthStore {
  init(): Promise<void>;
  /** Store a token hash for an email, invalidating any prior token for that email (one live link). */
  createToken(email: string, tokenHash: string, expiresAt: string): Promise<void>;
  /** If the hash is an unused, unexpired token: mark it used and return its email; else null. */
  consumeToken(tokenHash: string): Promise<string | null>;
  /** Create-or-get the user for an email. */
  upsertUser(email: string): Promise<User>;
  getUserById(id: string): Promise<User | null>;
}

interface TokenRow {
  email: string;
  expiresAt: string;
  usedAt: string | null;
}

export class InMemoryAuthStore implements AuthStore {
  private usersByEmail = new Map<string, User>();
  private usersById = new Map<string, User>();
  private tokens = new Map<string, TokenRow>();

  async init(): Promise<void> {}

  async createToken(email: string, tokenHash: string, expiresAt: string): Promise<void> {
    for (const [hash, t] of this.tokens) if (t.email === email) this.tokens.delete(hash);
    this.tokens.set(tokenHash, { email, expiresAt, usedAt: null });
  }

  async consumeToken(tokenHash: string): Promise<string | null> {
    const t = this.tokens.get(tokenHash);
    if (!t || t.usedAt || t.expiresAt <= new Date().toISOString()) return null;
    t.usedAt = new Date().toISOString();
    return t.email;
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
     token_hash text PRIMARY KEY,
     email      text NOT NULL,
     expires_at timestamptz NOT NULL,
     used_at    timestamptz
   )`,
];

export class PgAuthStore implements AuthStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    for (const ddl of AUTH_TABLES) await this.pool.query(ddl);
  }

  async createToken(email: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.pool.query(`DELETE FROM login_tokens WHERE email = $1`, [email]);
    await this.pool.query(
      `INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, $3)`,
      [tokenHash, email, expiresAt],
    );
  }

  async consumeToken(tokenHash: string): Promise<string | null> {
    // Single-use + unexpired, atomically: only an unused, live token flips to used and returns email.
    const { rows } = await this.pool.query(
      `UPDATE login_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING email`,
      [tokenHash],
    );
    return rows[0] ? (rows[0].email as string) : null;
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
