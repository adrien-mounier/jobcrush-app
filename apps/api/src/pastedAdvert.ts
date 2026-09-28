// #303 (spec #301 slice 1, #294) — the door for a job he found himself.
//
// The whole design in one line: **a pasted advert becomes an ordinary provider record and then goes
// nowhere new.** It is written into postingStore.ts under the registered `pasted-by-you` source
// (#302), deduped by postings.ts, read by adReader.ts, scored by deck.ts and judged by judge.ts —
// the same storage, the same reader, the same scorer, the same checkpoints a fetched advert gets
// (#290 ruling 1). The only code that is new is the code that turns one block of text into that
// record, which is what this module is.
//
// Identity is a FINGERPRINT OF THE TEXT, not of the person or of the paste. One advert therefore has
// one reading no matter who pasted it or how often: the second paste finds the record already in the
// store, skips the model entirely, and still writes that person their own paste record.
//
// Not this ticket, deliberately, and each one is somebody else's: the narrated wait and the
// unreadable-advert screen are #304; the deck stitching, the pinned band, the freshness-gate
// exemptions and the ageing line are #305; the job screen's own four changes are #306.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  canonicalKeyOf,
  type PostingV1 as PostingV1Value,
  type ProviderPostingRecordV1 as ProviderPostingRecordV1Value,
} from "@jobcrush/contracts";
import { extractJson } from "./miner.js";
import { detectLanguage, languageEligible, SERVED_LANGUAGES } from "./language.js";
import type { LlmClient } from "./llm.js";
import { dedupePostings } from "./postings.js";
import type { PostingStore } from "./postingStore.js";
import { PASTED_SOURCE_PROVIDER_ID } from "./postingRetrieval.js";
import type { PasteRecordStore } from "./pasteRecordStore.js";
import type { Posting } from "./preview.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "pasted-advert.md");

/** Short enough to be an "About us" fragment rather than an advert. The reader is given the benefit
 *  of the doubt above this; below it there is nothing to read and nothing to charge for. */
export const MIN_ADVERT_CHARS = 120;
/** The body limit the route enforces, stated here beside the reader that pays for the text. Roughly
 *  ten times the longest advert in the sample pool — generous, because the failure mode of a tight
 *  bound is a real advert rejected, and the cost of a loose one is one model call on a long input. */
export const MAX_ADVERT_CHARS = 60_000;

/** The advert's identity: a hash of its own text, whitespace-normalised so that the same advert
 *  copied twice — once with soft line wraps, once without — is still one advert. Nothing else is
 *  normalised: case and punctuation are part of what was pasted, and collapsing them would merge two
 *  genuinely different adverts into one shared reading, which is the one direction that is unsafe. */
export function advertFingerprint(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

/** Only `http`/`https`. A stored link is printed at the top of the application email and rendered
 *  as an anchor on the job's own screen, so a non-web scheme (`javascript:`, `data:`) is a live
 *  hazard, not a typo. Everything beyond the scheme — a dead page, a typo'd host — is the person's
 *  own to judge, and refusing it would be us second-guessing a link he can see. */
export function isWebLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** The first web address in the pasted text, or null. Copying an advert off LinkedIn or Indeed often
 *  brings the address along; often it does not (#291). Used to PRE-FILL the link field, never to
 *  overrule what the person typed — the paste screen offers it, he keeps or replaces it. Trailing
 *  sentence punctuation is dropped: a URL at the end of a sentence carries the full stop with it.
 *
 *  The paste screen has its OWN copy of this (apps/web/lib/api.ts) and that is deliberate, not an
 *  oversight: the pre-fill has to run on every keystroke in the browser, and the obvious shared home
 *  — packages/contracts — cannot be imported for a VALUE from client code without dragging
 *  `node:crypto` (canonicalKeyOf) into the browser bundle, which fails the web build outright. What
 *  the two copies can cost if they ever drift is bounded and cosmetic: a field pre-filled with a
 *  slightly different string than this function would have found. The value that is STORED is only
 *  ever decided here. */
export function linkInText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/);
  if (!match) return null;
  const trimmed = match[0].replace(/[.,;:!?]+$/, "");
  return isWebLink(trimmed) ? trimmed : null;
}

let cachedPrompt: string | null = null;
function pastedAdvertPrompt(): string {
  if (!cachedPrompt) cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  return cachedPrompt;
}

/** What the provider's feed would have given us, read off the text instead — and the one liveness
 *  signal a pasted advert can carry (#294 clause 4). Nothing about requirements: ad-reader.md reads
 *  those, unchanged, off the posting this builds. */
export const PastedAdvertHeader = z
  .object({
    title: z.string().trim().min(1),
    company: z.string().trim().min(1),
    location: z.string().trim().min(1),
    // The prompt asks for YYYY-MM-DD. A model that answers something else has not given us a date
    // the expiry field can carry, and this shape refuses it rather than storing a string that looks
    // like a fact — this date is shown to him as something the employer stated.
    //
    // Stated ceiling, because the cost is real: a rejected closing date fails the WHOLE header, so
    // `makePastedAdvertReader` retries once with the error and then gives up on the advert. An
    // advert whose only defect is a model that will not format a date twice is refused outright.
    // Accepted over the alternative — dropping just the date and keeping the read — because that
    // silently turns "the employer said applications close on the 20th" into "no closing date",
    // and a date nobody is shown cannot be missed, while a refusal is visible and retryable.
    closingDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict();
export type PastedAdvertHeader = z.infer<typeof PastedAdvertHeader>;

/** Reads one pasted advert's header. Null means "this text is not an advert we can read" — the paste
 *  screen's failure state (#304), never a silently-empty card. */
export type ReadPastedAdvert = (text: string, now?: Date) => Promise<PastedAdvertHeader | null>;

export function buildPastedAdvertInput(text: string, now: Date): string {
  // Function replacers throughout: the advert is text the person pasted, so "$&"/"$'" inside it
  // would otherwise be read as replacement patterns (the same trap adReader.ts's own comment names).
  return pastedAdvertPrompt()
    .replace("{{TODAY}}", () => now.toISOString().slice(0, 10))
    .replace("{{ADVERT}}", () => text);
}

/** The real reader. One call, one retry with the validation errors appended (the house idiom —
 *  miner.ts, adReader.ts), then null: a second unusable answer is the failure screen's business, not
 *  a third paid attempt. */
export function makePastedAdvertReader(llm: LlmClient): ReadPastedAdvert {
  /** The answer, or why it was rejected — never a throw, so a model that returns prose costs the
   *  same one retry a model that returns a malformed object does. */
  const attempt = async (prompt: string): Promise<{ header: PastedAdvertHeader } | { why: string }> => {
    const raw = await llm.complete(prompt);
    let json: unknown;
    try {
      json = extractJson(raw);
    } catch {
      return { why: "the answer was not a JSON object" };
    }
    const parsed = PastedAdvertHeader.safeParse(json);
    return parsed.success ? { header: parsed.data } : { why: JSON.stringify(parsed.error.issues) };
  };

  return async (text, now = new Date()) => {
    const input = buildPastedAdvertInput(text, now);
    const first = await attempt(input);
    if ("header" in first) return first.header;
    const second = await attempt(
      `${input}\n\nYour previous answer was rejected: ${first.why}\nAnswer again, correctly.`,
    );
    return "header" in second ? second.header : null;
  };
}

/** #294 clause 5: `sourceUrl` means "the listing we read", and a pasted advert has none. Lending it
 *  the apply link would be the same falsehood in the data that #302 refused in the other direction
 *  (techmap's `applicationUrl` is null rather than a copy of its `sourceUrl`). The field is required
 *  and non-empty by contract, so it carries the advert's own identity instead of a URL it does not
 *  have. Nothing renders it: preview.ts's `Posting` drops it, so no screen can print this. */
const sourceMarkerFor = (fingerprint: string) => `pasted:${fingerprint}`;

export interface PasteAdvertDeps {
  postings: PostingStore;
  pasteRecords: PasteRecordStore;
  readPastedAdvert?: ReadPastedAdvert;
  now?: () => Date;
}

export interface PasteAdvertInput {
  sessionId: string;
  text: string;
  /** What he typed in the link field — already pre-filled from the text by the paste screen. */
  applicationUrl?: string | null;
}

export type PasteAdvertRefusal =
  | "too_short"
  | "unsupported_language"
  | "unreadable"
  | "reader_unavailable";

export type PasteAdvertOutcome =
  | { ok: true; adId: string; posting: Posting; reused: boolean; pastedAt: string }
  | { ok: false; reason: PasteAdvertRefusal };

/**
 * The whole paste path. Returns the canonical posting id he is then sent to (#291 ruling: the door
 * lands him on that job's own screen, never back on the deck).
 *
 * `reused: true` is the "spends nothing" case and is not an optimisation — it is the ticket's own
 * acceptance criterion, and it is decided by a STORE READ before any model client is touched, so
 * there is no path on which a repeat paste can pay.
 *
 * Every refusal it can return is decided BEFORE the model call, deliberately: an advert we were
 * always going to drop must be refused for free and by name, never read and then silently lost
 * behind a card that never appears.
 */
export async function pasteAdvert(deps: PasteAdvertDeps, input: PasteAdvertInput): Promise<PasteAdvertOutcome> {
  const text = input.text.trim();
  if (text.length < MIN_ADVERT_CHARS) return { ok: false, reason: "too_short" };
  // The language gate the deck applies to every posting (#86 AC4), applied HERE instead of after
  // the read. detectLanguage is local and free, and the gate's answer cannot change downstream — so
  // reading an advert the card pass would then drop is money spent on a 404. "und" (too terse or
  // too mixed to judge) refuses the same way the fixture pool's own ingest already skips it.
  if (!languageEligible(detectLanguage(text), SERVED_LANGUAGES)) {
    return { ok: false, reason: "unsupported_language" };
  }
  const now = (deps.now ?? (() => new Date()))();
  const capturedAt = now.toISOString();
  const fingerprint = advertFingerprint(text);
  // Only a real web address is ever stored: it is printed at the top of the application email and
  // rendered as an anchor, so the scheme is a safety question, not a formatting one (isWebLink).
  const typed = input.applicationUrl?.trim();
  const typedLink = typed && isWebLink(typed) ? typed : null;

  const existing = await deps.postings.get(PASTED_SOURCE_PROVIDER_ID, fingerprint);
  let record: ProviderPostingRecordV1Value;
  if (existing) {
    // The same advert, already read. No model call, at any version — the reading is a property of
    // the advert, not of the person (#294 ruling 1) — and no write either: FIRST PASTE WINS, whole
    // (#294 clause 9). A second paste carrying a link the first did not have is deliberately NOT
    // merged in: the designed remedy for a job with no link is the apply row's own control on the
    // job's own screen, "No application link yet — add the application link" (#300 change 1, built
    // by #306), and a silent backfill here would be a second, invisible way to set the same field.
    record = existing;
  } else {
    if (!deps.readPastedAdvert) return { ok: false, reason: "reader_unavailable" };
    const header = await deps.readPastedAdvert(text, now);
    if (!header) return { ok: false, reason: "unreadable" };
    record = await deps.postings.upsert({
      schemaVersion: "4",
      providerId: PASTED_SOURCE_PROVIDER_ID,
      providerPostingId: fingerprint,
      title: header.title,
      company: header.company,
      location: header.location,
      sourceUrl: sourceMarkerFor(fingerprint),
      applicationUrl: typedLink ?? linkInText(text),
      // #294 clause 9: the advert's OWN TEXT is stored on the job, because this is the first record
      // in the app that cannot be re-fetched. `excerpt` is the field the reader and the card already
      // read, so the text is stored where it is used rather than in a second place that could rot.
      excerpt: text,
      postedAt: null,
      // #302: when he pasted it. Never confirmed live and never confirmable — nothing fetches this
      // source, and a fetch is what stamps that field.
      capturedAt,
      verifiedLiveAt: null,
      // #294 clause 4: the employer's own closing date, in the existing provider-stated-expiry
      // field. #305 keeps it out of the freshness gate.
      expiresAt: header.closingDate,
      attribution: null,
      // Structured skills are a thing a provider's feed supplies; raw text does not carry one, and
      // inventing a list here would put words on the card the advert never used. The requirements
      // the card actually shows come from adReader.ts, off this same text.
      skills: [],
      language: detectLanguage(text),
    });
  }

  const adId = `posting:${canonicalKeyOf(record.company, record.location, record.title)}`;
  const pastedAt = await deps.pasteRecords.record(input.sessionId, adId, capturedAt);
  return {
    ok: true,
    adId,
    posting: postingOf(dedupePostings([record])[0]!),
    reused: existing !== null,
    pastedAt,
  };
}

/** One canonical posting as the card-shaping side of the app reads it. The field mapping is
 *  preview.ts's retrievedPostings, which cannot be reused directly: that one takes a RetrievalResult
 *  (a fetch this source never performs). Exported because #305's ageing line needs the fields this
 *  mapping DROPS — the employer's stated closing date above all — so it reads the canonical posting
 *  and maps it here, rather than keeping a second mapping of its own (broughtJobs.ts). */
export function postingOf(canonical: PostingV1Value): Posting {
  return {
    id: canonical.id,
    title: canonical.title,
    company: canonical.company,
    location: canonical.location,
    keywords: canonical.skills,
    excerpt: canonical.excerpt,
    language: canonical.language,
  };
}

/** Every advert pasted by anyone, as canonical postings. Goes through dedupePostings rather than
 *  mapping fields by hand, so a pasted advert is shaped by exactly the same merge every other posting
 *  is — including the day it dedupes onto a record a real provider also carries.
 *  ponytail: reads every pasted row and dedupes the lot to find one id. Correct and cheap at this
 *  product's size; index by canonical key in the store if the pasted table ever grows large. */
export async function pastedCanonicalPostings(
  store: Pick<PostingStore, "listByProvider">,
): Promise<PostingV1Value[]> {
  return dedupePostings(await store.listByProvider(PASTED_SOURCE_PROVIDER_ID));
}

/** Every advert pasted by anyone, as the postings the rest of the app reads — what the job's own
 *  screen resolves an adId against. #305's deck stitching goes through broughtJobs.ts instead, which
 *  needs the closing date this shape drops. */
export async function pastedPostings(store: Pick<PostingStore, "listByProvider">): Promise<Posting[]> {
  return (await pastedCanonicalPostings(store)).map(postingOf);
}
