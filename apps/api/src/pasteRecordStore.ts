// #303 (#294 clause 11) — who pasted which advert, and when. The first record in this app that says
// a PERSON saw a POSTING at a TIME: `/want` stores a bare `sessions.tailor_ad_id` with no timestamp,
// overwritten by the next swipe, and `postingStore.ts`'s capturedAt is deliberately cross-session
// ("when JobCrush first retrieved this record", shared by everyone who ever pasted the same text).
//
// Why it has to exist rather than reusing capturedAt: one advert has ONE reading, shared by whoever
// pastes it (#294 ruling 1), so the global capture time answers "when did anyone first paste this",
// never "how long ago did HE paste it". The ageing line (#305) and the pinned band (#305) both ask
// the second question. Free today with one user, a plain falsehood the moment there are two — the
// golden rule's own case.
//
// FIRST-WRITE-WINS, not last: the clock this feeds counts from when this person brought the job in.
// Pasting the same advert again is a re-visit, not a new arrival, and must not reset it.
//
// #448: the apply link lives here too, not on the shared advert. A copied link often carries a
// tracking or referral code tied to whoever copied it, so one person's link must never reach another
// person's screen or email. The opposite rule from the clock: the person's LATEST link wins, and a
// re-paste with no link keeps the one they already gave.
//
// Same driver-split shape as every other store here (InMemory + Pg + …FromEnv), and storage stays
// dumb — the paste path (pastedAdvert.ts) decides what to write; this only remembers it.
import type { Pool } from "pg";
import { getPool, iso } from "./db.js";

export interface PasteRecord {
  sessionId: string;
  /** The canonical posting id (`posting:<canonicalKey>`) — the same `adId` the card, the ad
   *  requirements cache and the judgement cache are all keyed on, never the text fingerprint. */
  adId: string;
  pastedAt: string; // ISO 8601
  /** #448 — where THIS person applies: the link they gave the paste door, or added on the job's own
   *  screen. Null until they give one; never another person's. */
  applicationUrl: string | null;
}

export interface PasteRecordStore {
  readonly durable: boolean;
  init(): Promise<void>;
  /** First-write-wins for the time; latest-non-null-wins for the link (#448). Returns the STORED
   *  time, which is `pastedAt` on a first write and the earlier, already-stored time on every repeat. */
  record(sessionId: string, adId: string, pastedAt: string, applicationUrl?: string | null): Promise<string>;
  /** #448's one-off upgrade: hands a link that used to sit on the shared advert to the person who
   *  pasted that advert first, unless they already have one. Returns whether it was written. */
  adoptLink(adId: string, applicationUrl: string): Promise<boolean>;
  /** Every advert this session pasted, newest first — what #305's pinned band and ageing line read. */
  listBySession(sessionId: string): Promise<PasteRecord[]>;
}

const keyOf = (sessionId: string, adId: string) => `${sessionId}:${adId}`;
const newestFirst = (a: PasteRecord, b: PasteRecord) => (a.pastedAt < b.pastedAt ? 1 : a.pastedAt > b.pastedAt ? -1 : 0);

export class InMemoryPasteRecordStore implements PasteRecordStore {
  readonly durable = false;
  private byKey = new Map<string, PasteRecord>();

  async init(): Promise<void> {}

  async record(sessionId: string, adId: string, pastedAt: string, applicationUrl: string | null = null): Promise<string> {
    const key = keyOf(sessionId, adId);
    const existing = this.byKey.get(key);
    if (existing) {
      if (applicationUrl) existing.applicationUrl = applicationUrl;
      return existing.pastedAt;
    }
    this.byKey.set(key, { sessionId, adId, pastedAt, applicationUrl });
    return pastedAt;
  }

  async adoptLink(adId: string, applicationUrl: string): Promise<boolean> {
    // Same order as the Pg driver: earliest paste, ties broken by session id.
    const [first] = [...this.byKey.values()]
      .filter((r) => r.adId === adId)
      .sort((a, b) => a.pastedAt.localeCompare(b.pastedAt) || a.sessionId.localeCompare(b.sessionId));
    if (!first || first.applicationUrl) return false;
    first.applicationUrl = applicationUrl;
    return true;
  }

  async listBySession(sessionId: string): Promise<PasteRecord[]> {
    return [...this.byKey.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort(newestFirst)
      .map((r) => ({ ...r }));
  }
}

/** #448: a table created before the link moved here gains the column. Exported for the upgrade test
 *  (pg-mem cannot re-run the CREATE TABLE IF NOT EXISTS above against an existing table). */
export const PASTE_RECORDS_LINK_COLUMN = "ALTER TABLE paste_records ADD COLUMN IF NOT EXISTS application_url text";

const PASTE_RECORDS_TABLE = `
CREATE TABLE IF NOT EXISTS paste_records (
  session_id text NOT NULL,
  ad_id      text NOT NULL,
  pasted_at  timestamptz NOT NULL,
  application_url text,
  PRIMARY KEY (session_id, ad_id)
)`;

export class PgPasteRecordStore implements PasteRecordStore {
  readonly durable = true;
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(PASTE_RECORDS_TABLE);
    await this.pool.query(PASTE_RECORDS_LINK_COLUMN);
  }

  async record(sessionId: string, adId: string, pastedAt: string, applicationUrl: string | null = null): Promise<string> {
    // DO UPDATE writing the row's own value back, not DO NOTHING: both preserve the first write, but
    // DO NOTHING returns no row at all on a conflict, so the caller could not read back the time it
    // is meant to count from without a second round trip. Same idiom postingStore.ts's §2.6 merge
    // uses for exactly this reason.
    const { rows } = await this.pool.query(
      `INSERT INTO paste_records (session_id, ad_id, pasted_at, application_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, ad_id) DO UPDATE SET pasted_at = paste_records.pasted_at,
         application_url = COALESCE(EXCLUDED.application_url, paste_records.application_url)
       RETURNING pasted_at`,
      [sessionId, adId, pastedAt, applicationUrl],
    );
    return iso(rows[0].pasted_at);
  }

  async adoptLink(adId: string, applicationUrl: string): Promise<boolean> {
    // The earliest paster alone, read first: a single UPDATE ... WHERE pasted_at = MIN(...) would
    // hand the link to everyone who tied on the time.
    const { rows } = await this.pool.query(
      `SELECT session_id, application_url FROM paste_records WHERE ad_id = $1 ORDER BY pasted_at, session_id LIMIT 1`,
      [adId],
    );
    if (rows.length === 0 || rows[0].application_url) return false;
    const updated = await this.pool.query(
      `UPDATE paste_records SET application_url = $3 WHERE session_id = $1 AND ad_id = $2 AND application_url IS NULL`,
      [rows[0].session_id, adId, applicationUrl],
    );
    return (updated.rowCount ?? 0) > 0;
  }

  async listBySession(sessionId: string): Promise<PasteRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT session_id, ad_id, pasted_at, application_url FROM paste_records WHERE session_id = $1 ORDER BY pasted_at DESC`,
      [sessionId],
    );
    return rows.map((row) => ({
      sessionId: row.session_id,
      adId: row.ad_id,
      pastedAt: iso(row.pasted_at),
      applicationUrl: row.application_url ?? null,
    }));
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store. */
export function pasteRecordStoreFromEnv(databaseUrl?: string): PasteRecordStore {
  return databaseUrl ? new PgPasteRecordStore(getPool(databaseUrl)) : new InMemoryPasteRecordStore();
}
