// #305 (spec #301 slice 1, #294) — a job HE BROUGHT, and the one fact that makes it different from a
// job we found: **nobody can ever re-check whether it is still open.** A fetched advert is re-asked of
// its provider on every deck rebuild and drops out of the answer when its listing does. A pasted one
// has nobody to re-ask, so everything below follows from that single fact:
//
//   - it is STITCHED IN from storage on every rebuild (preview.ts's sessionPostings), which is also
//     why it survives a provider blackout as an ordinary deck — the one job that depends on nobody is
//     the one that is always there (#294 c8);
//   - it NEVER EXPIRES and is NEVER WITHDRAWN (#294 c1), and it skips the wrong-family deletion
//     (#292 req 11) — deck.ts applies both skips, keyed on the ids this module hands it;
//   - it AGES IN PUBLIC instead (#294 c3): silent for a week, and from day seven its card and its own
//     screen say how long ago THIS PERSON pasted it and that we cannot check whether it is still open.
//
// The clock counts from the PER-PERSON paste record (pasteRecordStore.ts), never from the posting's
// `capturedAt`, which is deliberately cross-session: one advert has one reading shared by whoever
// pastes it, so the global capture time answers "when did anyone first paste this" and would be a
// plain falsehood the day two people share an advert (#294 c11 — the golden rule's own case).
import type { JobCardV1 } from "@jobcrush/contracts";
import { pastedCanonicalPostings, postingOf } from "./pastedAdvert.js";
import type { PasteRecordStore } from "./pasteRecordStore.js";
import type { PostingStore } from "./postingStore.js";
import type { Posting } from "./preview.js";

/** #294 c7: only the newest few are pinned. Older brought jobs stay in the deck and fall into the
 *  ranked list on merit — ranking answers "which of these is worth my time", and a job he brought has
 *  already answered that, but a deck that pins every one of them becomes an archive. */
export const PINNED_BROUGHT_CAP = 3;

/** #294 c3: silent for the first week. Most adverts run two to four weeks, so seven days is where "is
 *  this still open?" stops being paranoid — and a notice that is always on is a notice he stops
 *  reading, which would cost us the one moment it matters. */
export const AGEING_SILENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One advert this person brought: the posting to stitch into his deck, the line its card and its own
 *  screen carry — null through the silent first week — and where to apply for it, null until somebody
 *  gives us a link. Both facts ride on the same record for the same reason: `Posting` is the shape the
 *  card-shaping side reads and it drops everything the reader did not need, so anything the card must
 *  say about the advert ITSELF is resolved here, once, from the stored paste. */
export interface BroughtJob {
  posting: Posting;
  ageing: string | null;
  /** #306 — the link he gave the paste door, or the one he added afterwards on the job's own screen.
   *  Read from the shared advert record, so the job's own screen shows the link the emailed report
   *  will print (#293) rather than a second copy that could disagree with it. */
  applicationUrl: string | null;
}

/** Newest first — the order the pinned band is shown in, and the order the cap counts down. */
export type BroughtJobsFn = (sessionId: string) => Promise<BroughtJob[]>;

export interface BroughtJobsDeps {
  postings: Pick<PostingStore, "listByProvider">;
  pasteRecords: Pick<PasteRecordStore, "listBySession">;
  now?: () => Date;
}

/**
 * Every advert THIS session pasted, newest first, ready to stitch in.
 *
 * Scoped by the person's own paste records, never by the pasted source alone: the reading is shared
 * (#294 ruling 1), but a card carries `adExcerpt`, which for a pasted advert is the whole pasted text
 * — so an unscoped read here would put one person's paste on another person's deck.
 *
 * ponytail: reads every pasted row to resolve this session's handful. Correct and cheap at this
 * product's size — the same bound `pastedPostings` already states; index by canonical key in the store
 * if the pasted table ever grows large.
 */
export function makeBroughtJobs(deps: BroughtJobsDeps): BroughtJobsFn {
  return async (sessionId) => {
    const records = await deps.pasteRecords.listBySession(sessionId);
    if (records.length === 0) return [];
    const byId = new Map(
      (await pastedCanonicalPostings(deps.postings)).map((posting) => [posting.id, posting] as const),
    );
    const now = (deps.now ?? (() => new Date()))();
    return records.flatMap((record) => {
      const posting = byId.get(record.adId);
      // A paste record whose posting is gone is not an error to report: #294 c9 says recovery is
      // possible, not automatic, and the honest answer to "the advert behind this record is no longer
      // in the store" is one fewer card, never a broken deck.
      if (!posting) return [];
      return [
        {
          posting: postingOf(posting),
          ageing: ageingLine(record.pastedAt, posting.expiresAt, now),
          applicationUrl: posting.applicationUrl,
        },
      ];
    });
  };
}

/** Does this adId belong to a job he brought? The predicate every origin-keyed rule reads. */
export function isBrought(brought: readonly BroughtJob[], adId: string): boolean {
  return brought.some((job) => job.posting.id === adId);
}

/**
 * The deck's cards with his newest brought jobs lifted to the front, newest first and capped at three.
 * Everything else keeps the ranked order it arrived in — including a brought job past the cap, which
 * is in the deck on merit rather than pinned (#294 c7).
 */
export function pinBrought<T extends { adId: string }>(cards: T[], brought: readonly BroughtJob[]): T[] {
  const wanted = brought.slice(0, PINNED_BROUGHT_CAP).map((job) => job.posting.id);
  if (wanted.length === 0) return cards;
  const byId = new Map(cards.map((card) => [card.adId, card] as const));
  // Driven by `wanted`, not by a filter over `cards`, so the pinned band comes out in PASTE order
  // (newest first) rather than in whatever order the ranking happened to leave them.
  const pinned = wanted.flatMap((adId) => {
    const card = byId.get(adId);
    return card ? [card] : [];
  });
  const isPinned = new Set(pinned.map((card) => card.adId));
  return [...pinned, ...cards.filter((card) => !isPinned.has(card.adId))];
}

/** What a card says because it is a job HE BROUGHT: its ageing line, and where to apply for it. Both
 *  are additive like `notTested` — a job we found ourselves, or a brought one still in its silent first
 *  week with no link, gets the card back untouched and the fields are simply absent.
 *
 *  #306: the apply link rides on the card for BOTH surfaces, and only the job's own screen renders it.
 *  That is deliberate and it is the cheap half of the rule: the deck card is swiped, so a link inside
 *  it fights the gesture (#300), and the way to be sure the deck never grows one is that the deck's
 *  renderer is never handed a control to grow it with — apps/web/app/jobcard.tsx takes the apply row as
 *  a slot its caller fills, and the deck passes nothing. */
export function withBroughtFacts(card: JobCardV1, job: BroughtJob | undefined): JobCardV1 {
  if (!job) return card;
  return {
    ...card,
    ...(job.ageing ? { ageing: job.ageing } : {}),
    ...(job.applicationUrl ? { applicationUrl: job.applicationUrl } : {}),
  };
}

/**
 * What his card says about its own age.
 *
 * Two different lines, and only one of them waits:
 *
 *   - A closing date the EMPLOYER stated is shown **from the moment we have it**. It supersedes the
 *     vague line (#294 c4) because it is the only genuine liveness signal a pasted advert can ever
 *     carry — and c3's silent week exists so a HEDGE does not become furniture, which is not a reason
 *     to withhold a fact. Held back to day seven it would arrive after most stated dates had passed:
 *     an advert pasted on the 1st closing on the 3rd would say nothing while he could still act, then
 *     report the loss. **Owner call, and one line to reverse** — move this call below the day check.
 *   - The vague line is silent for the first seven days (#294 c3), then says how long ago HE pasted it.
 *
 * Either way the date is read HERE and deliberately nowhere near the freshness gates — feeding it to
 * them would kill "a pasted job never expires" by the back door (postingRetrieval.ts's exemptions).
 */
export function ageingLine(pastedAt: string, closingDate: string | null, now: Date): string | null {
  const stated = closingLine(closingDate, now);
  if (stated) return stated;
  const pastedMs = Date.parse(pastedAt);
  if (!Number.isFinite(pastedMs)) return null;
  const days = Math.floor((now.getTime() - pastedMs) / DAY_MS);
  if (days < AGEING_SILENT_DAYS) return null;
  return `You pasted this ${days} days ago. We cannot check whether it is still open.`;
}

/** The employer's own words about when applications close, or null when the advert stated none — or
 *  stated something that is not a date, which is not a fact we can print as one. */
function closingLine(closingDate: string | null, now: Date): string | null {
  if (closingDate === null) return null;
  const closingMs = Date.parse(closingDate);
  if (!Number.isFinite(closingMs)) return null;
  const closing = new Date(closingMs);
  // The year only when it is not this one: "15 October" is how the date was stated to him, and a date
  // from another year is the one case where leaving the year out would mislead.
  const when = closing.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...(closing.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }),
  });
  const daysSince = Math.floor((now.getTime() - closingMs) / DAY_MS);
  if (daysSince < 0) return `The employer said applications close on ${when}.`;
  if (daysSince === 0) return `The employer said applications close on ${when} — that is today.`;
  const ago = daysSince === 1 ? "1 day ago" : `${daysSince} days ago`;
  return `The employer said applications closed on ${when}, ${ago}.`;
}
