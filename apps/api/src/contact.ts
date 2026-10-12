// #190 "contact info is a fact" — the phone/email store. Follows eligibility.ts's pattern (#182 /
// ADR-0003 §7): a correction supersedes, never deletes — the prior value stays reachable via
// history(), never returned by get()/getRecord().
//
// ADR-0008 §3: the person's own answer permanently outranks any later re-read of the document. A
// "read" write (mine time, from extract.ts's extractContact) must never clobber a "person-said"
// value (the profile door, routes/contact.ts) — put() enforces that guard itself, so every caller
// gets it for free without having to remember the rule.
import type { Pool } from "pg";
import { getPool } from "./db.js";
import { splitLetterhead } from "./extract.js";

// #381: the letterhead is five fields — name, title, email, phone, location — each read at mine
// time (extract.ts's splitLetterhead) and editable through the same person-said door. They ride
// this store because they share the lifecycle and the origin rules. (#310's one raw "header" row
// is gone: the tailor's candidate header is built from these fields — letterheadText below.)
export type ContactField = "name" | "title" | "email" | "phone" | "location";
export type ContactOrigin = "read" | "person-said";

export interface ContactValue {
  value: string;
  origin: ContactOrigin;
  /** "read": the exact snippet the value was parsed from (ADR-0004 clause 1a). "person-said": the
   *  person's own answer text. */
  sourceText: string;
}

export type ContactRecord = Record<ContactField, ContactValue | null>;

export interface SupersededContactValue extends ContactValue {
  supersededAt: string;
}

export const CONTACT_FIELDS: ContactField[] = ["name", "title", "email", "phone", "location"];
export const EMPTY_CONTACT_RECORD: ContactRecord = { name: null, title: null, email: null, phone: null, location: null };

const recordOf = async (get: (field: ContactField) => Promise<ContactValue | null>): Promise<ContactRecord> =>
  Object.fromEntries(await Promise.all(CONTACT_FIELDS.map(async (f) => [f, await get(f)]))) as ContactRecord;

/** #381: the CANDIDATE-HEADER the tailor copies name and contact data from (preview-tailor.md rule
 *  3), built from the saved fields so an edit in Your details prints on every draft and export.
 *  Name, then title, then the contact line in the prompt's own order (city · phone · email). */
export function letterheadText(record: ContactRecord): string {
  const contact = [record.location, record.phone, record.email].map((v) => v?.value).filter(Boolean).join(" · ");
  return [record.name?.value, record.title?.value, contact].filter(Boolean).join("\n");
}

export interface ContactStore {
  init(): Promise<void>;
  /** Record or correct one field.
   *  - origin "read" (mine time) is silently skipped when the stored value is already
   *    "person-said" — ADR-0008 §3: a later re-read must never clobber the person's own correction.
   *  - origin "person-said" (the profile door) always supersedes whatever was there.
   *  Either way, a genuinely different prior value is kept in history(), never deleted. */
  put(sessionId: string, field: ContactField, value: ContactValue): Promise<void>;
  get(sessionId: string, field: ContactField): Promise<ContactValue | null>;
  /** Both fields in one call — GET /profile's shape. */
  getRecord(sessionId: string): Promise<ContactRecord>;
  /** Every value put() has ever superseded for this (session, field), oldest first. */
  history(sessionId: string, field: ContactField): Promise<SupersededContactValue[]>;
}

export class InMemoryContactStore implements ContactStore {
  private bySession = new Map<string, Map<ContactField, ContactValue>>();
  private historyBySession = new Map<string, Map<ContactField, SupersededContactValue[]>>();

  async init(): Promise<void> {}

  private forSession(sessionId: string): Map<ContactField, ContactValue> {
    let m = this.bySession.get(sessionId);
    if (!m) {
      m = new Map();
      this.bySession.set(sessionId, m);
    }
    return m;
  }

  private historyFor(sessionId: string): Map<ContactField, SupersededContactValue[]> {
    let m = this.historyBySession.get(sessionId);
    if (!m) {
      m = new Map();
      this.historyBySession.set(sessionId, m);
    }
    return m;
  }

  async put(sessionId: string, field: ContactField, value: ContactValue): Promise<void> {
    const current = this.forSession(sessionId).get(field);
    if (value.origin === "read" && current?.origin === "person-said") return;
    if (
      current &&
      (current.value !== value.value || current.origin !== value.origin || current.sourceText !== value.sourceText)
    ) {
      const h = this.historyFor(sessionId);
      const entries = h.get(field) ?? [];
      entries.push({ ...current, supersededAt: new Date().toISOString() });
      h.set(field, entries);
    }
    this.forSession(sessionId).set(field, { ...value });
  }

  async get(sessionId: string, field: ContactField): Promise<ContactValue | null> {
    const found = this.forSession(sessionId).get(field);
    return found ? { ...found } : null;
  }

  async getRecord(sessionId: string): Promise<ContactRecord> {
    return recordOf((f) => this.get(sessionId, f));
  }

  async history(sessionId: string, field: ContactField): Promise<SupersededContactValue[]> {
    return (this.historyFor(sessionId).get(field) ?? []).map((e) => ({ ...e }));
  }
}

const CONTACT_TABLE = `
CREATE TABLE IF NOT EXISTS contact_facts (
  session_id  text NOT NULL,
  field       text NOT NULL,
  value       text NOT NULL,
  origin      text NOT NULL,
  source_text text NOT NULL,
  PRIMARY KEY (session_id, field)
)`;

// Own table, not a column on contact_facts — same reasoning as eligibility_fact_history: a column
// embedded in the current row dies with that row, which is exactly the "never deleted" guarantee
// this table exists to keep.
const CONTACT_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS contact_fact_history (
  id            SERIAL PRIMARY KEY,
  session_id    text NOT NULL,
  field         text NOT NULL,
  value         text NOT NULL,
  origin        text NOT NULL,
  source_text   text NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
)`;

export class PgContactStore implements ContactStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(CONTACT_TABLE);
    await this.pool.query(CONTACT_HISTORY_TABLE);
    await this.upgradeLegacyHeaders();
  }

  /** #381: a pre-fields import stored its letterhead as one "header" row. Split it into the read
   *  fields that session has none of yet, then move the row to history (kept, never deleted) so the
   *  upgrade runs once and never overrides a later upload or the person's own answer. */
  private async upgradeLegacyHeaders(): Promise<void> {
    const { rows } = await this.pool.query(`SELECT session_id, value, origin, source_text FROM contact_facts WHERE field = 'header'`);
    type Row = { session_id: string; value: string; origin: string; source_text: string };
    for (const { session_id: sessionId, value, origin, source_text } of rows as Row[]) {
      const fields = splitLetterhead(value);
      for (const field of ["name", "title", "location"] as const) {
        const read = fields[field];
        if (!read) continue;
        await this.pool.query(
          `INSERT INTO contact_facts (session_id, field, value, origin, source_text) VALUES ($1,$2,$3,'read',$4)
           ON CONFLICT (session_id, field) DO NOTHING`,
          [sessionId, field, read.value, read.sourceText],
        );
      }
      await this.pool.query(
        `INSERT INTO contact_fact_history (session_id, field, value, origin, source_text)
         VALUES ($1,'header',$2,$3,$4)`,
        [sessionId, value, origin, source_text],
      );
      await this.pool.query(`DELETE FROM contact_facts WHERE session_id = $1 AND field = 'header'`, [sessionId]);
    }
  }

  async put(sessionId: string, field: ContactField, value: ContactValue): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT value, origin, source_text FROM contact_facts WHERE session_id = $1 AND field = $2`,
      [sessionId, field],
    );
    const current = rows[0] as { value: string; origin: ContactOrigin; source_text: string } | undefined;
    if (value.origin === "read" && current?.origin === "person-said") return;
    if (
      current &&
      (current.value !== value.value || current.origin !== value.origin || current.source_text !== value.sourceText)
    ) {
      await this.pool.query(
        `INSERT INTO contact_fact_history (session_id, field, value, origin, source_text)
         VALUES ($1,$2,$3,$4,$5)`,
        [sessionId, field, current.value, current.origin, current.source_text],
      );
    }
    await this.pool.query(
      `INSERT INTO contact_facts (session_id, field, value, origin, source_text)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, field)
       DO UPDATE SET value = EXCLUDED.value, origin = EXCLUDED.origin, source_text = EXCLUDED.source_text`,
      [sessionId, field, value.value, value.origin, value.sourceText],
    );
  }

  async get(sessionId: string, field: ContactField): Promise<ContactValue | null> {
    const { rows } = await this.pool.query(
      `SELECT value, origin, source_text FROM contact_facts WHERE session_id = $1 AND field = $2`,
      [sessionId, field],
    );
    const r = rows[0];
    return r ? { value: r.value as string, origin: r.origin as ContactOrigin, sourceText: r.source_text as string } : null;
  }

  async getRecord(sessionId: string): Promise<ContactRecord> {
    return recordOf((f) => this.get(sessionId, f));
  }

  async history(sessionId: string, field: ContactField): Promise<SupersededContactValue[]> {
    const { rows } = await this.pool.query(
      `SELECT value, origin, source_text, superseded_at FROM contact_fact_history
       WHERE session_id = $1 AND field = $2 ORDER BY id ASC`,
      [sessionId, field],
    );
    return rows.map((r) => ({
      value: r.value as string,
      origin: r.origin as ContactOrigin,
      sourceText: r.source_text as string,
      supersededAt: r.superseded_at instanceof Date ? r.superseded_at.toISOString() : String(r.superseded_at),
    }));
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as the other stores. */
export function contactStoreFromEnv(databaseUrl?: string): ContactStore {
  return databaseUrl ? new PgContactStore(getPool(databaseUrl)) : new InMemoryContactStore();
}
