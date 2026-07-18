// JC-6 — one shared pg pool for the persistent stores (sessions, claims). Fly's attached Postgres is
// on the internal network (no TLS); pg's defaults are correct. Memoized so sessions + claims share a
// single pool rather than opening one each. (The guestbook keeps its own pool — it predates this.)
import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  return pool;
}

/** Postgres returns timestamptz as a Date; normalize to the ISO strings the records carry. */
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
