// #63: the deck is fed by RETRIEVAL and nothing else now — preview.ts's sessionPostings no longer
// reads sample-postings.json off disk, because a fixture that reaches a session unretrieved is a
// fixture authorizing a reveal, which is the one thing this ticket exists to stop.
//
// So a test that wants a deck must now supply the adverts the way production gets them: through the
// injected `retrievePostings` seam. This helper serves the SAME curated corpus those tests always
// asserted against (data/sample-postings.json + data/sample-ad-requirements.json), through the real
// authorization gate — so the suite keeps its meaning and the production refusal keeps its teeth.
//
// The one thing that genuinely changes is the ad id. A retrieved advert's id is `posting:<canonicalKey>`
// by contract (PostingV1's own superRefine), never the fixture's filename-shaped id, so a test that
// pins an id pins it through `liveIdFor()` and the curated requirements are resolved by canonical
// key in `fixtureReadAd` rather than by the id the fixture file happens to be keyed on.
import {
  canonicalKeyOf,
  type AdRequirementsV1,
  type CandidateClaim,
  type PostingRetrievalResultV1,
  type PostingV1,
} from "@jobcrush/contracts";
import { buildServer as baseBuildServer } from "../src/server.js";
import { lookupAdRequirements } from "../src/e5stub.js";
import { loadPostings, type Posting } from "../src/preview.js";
import { retrievalFingerprint, retrievalRequestForSession } from "../src/postingRetrieval.js";
import { retrievalClaimWindow } from "../src/sessions.js";

type App = ReturnType<typeof baseBuildServer>["app"];
type BuildOpts = NonNullable<Parameters<typeof baseBuildServer>[0]>;

// The one provider in this build's ACTIVE registry (postings.ts operationally disables curated-pool
// until it has a production region-refresh caller). A snapshot whose sources name a provider the
// active registry does not carry is never reusable — isReusableRetrievalSnapshot rejects it — so the
// harness has to stand in for the live provider, not for the pool the fixtures came from.
const HARNESS_PROVIDER_ID = "techmap";

const keyOf = (posting: Posting) => canonicalKeyOf(posting.company, posting.location, posting.title);

/** The retrieved id for a fixture advert — what its card's `adId` reads as once it arrives the way
 *  production delivers it. Tests that used to name a fixture id verbatim go through here. */
export function liveIdFor(fixtureAdId: string): string {
  const posting = loadPostings().find((p) => p.id === fixtureAdId);
  if (!posting) throw new Error(`no fixture posting with id: ${fixtureAdId}`);
  return `posting:${keyOf(posting)}`;
}

/** The fixture pool re-stamped with the ids retrieval actually delivers — the drop-in for
 *  `loadPostings()` in a test that picks a target advert and then compares it against a card's
 *  `adId`, or against the `posting` its own `readAd` fake is handed. Both of those are live ids
 *  now, so a test comparing them to a fixture id silently matches nothing. */
export function livePostings(): Posting[] {
  return loadPostings().map((posting) => ({ ...posting, id: `posting:${keyOf(posting)}` }));
}

/** Every fixture advert as the contract-shaped posting a provider would have returned. */
export function fixturePostingsV1(postings: Posting[] = loadPostings()): PostingV1[] {
  const now = new Date().toISOString();
  return postings.map((posting) => {
    const canonicalKey = keyOf(posting);
    return {
      schemaVersion: "5" as const,
      id: `posting:${canonicalKey}`,
      canonicalKey,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      sourceUrl: `https://example.test/${encodeURIComponent(posting.id)}`,
      applicationUrl: null,
      excerpt: posting.excerpt,
      postedAt: null,
      capturedAt: now,
      verifiedLiveAt: now,
      expiresAt: null,
      attribution: [],
      sources: [{ providerId: HARNESS_PROVIDER_ID, providerPostingId: posting.id }],
      skills: posting.keywords,
      // Deliberately the label the real pool derives at ingest, not a hard-coded "en" — the language
      // gate is a real gate and a test pool that lied about it would hide a genuine skip.
      language: posting.language,
    };
  });
}

/** A `retrievePostings` serving the curated corpus. `postings` narrows the pool for a test that
 *  wants a specific advert (or an empty pool) rather than all of them. */
export function fixtureRetriever(
  postings: Posting[] = loadPostings(),
): () => Promise<PostingRetrievalResultV1> {
  return async () => {
    const now = new Date().toISOString();
    const rows = fixturePostingsV1(postings);
    if (rows.length === 0) {
      return {
        schemaVersion: "5",
        outcome: "empty_pool",
        coverage: { providersQueried: [HARNESS_PROVIDER_ID], providersUnavailable: [], complete: true },
        retrievedAt: now,
      };
    }
    return {
      schemaVersion: "5",
      outcome: "relevant_postings",
      postings: rows,
      coverage: { providersQueried: [HARNESS_PROVIDER_ID], providersUnavailable: [], complete: true },
      retrievedAt: now,
    };
  };
}

/** Resolves a retrieved advert back to its hand-curated requirement set by canonical key — the
 *  fixture corpus is keyed by the OLD posting id, which retrieval can never produce. Falls through
 *  to `null` (an unreadable advert, dropped) for a posting nobody curated, exactly like a real read
 *  that produced nothing usable. */
export function fixtureReadAd(posting: Posting): AdRequirementsV1 | null {
  const source = loadPostings().find((p) => `posting:${keyOf(p)}` === posting.id);
  if (!source) return null;
  const lookup = lookupAdRequirements(source.id);
  if (lookup.status !== "found") return null;
  // These ARE the hand-curated sets, so `curated` stays true — the curated-opener promotion in
  // orderCardsForReveal is reading a real fact, not a harness artefact. Only the id is restamped,
  // onto the advert as retrieval actually delivered it.
  return { ...lookup.requirements, adId: posting.id };
}

/** `buildServer` with the curated corpus wired at the retrieval seam — the drop-in every deck suite
 *  imports in place of the real one, so the migration is one import per file rather than one edit
 *  per call site.
 *
 *  `readAd` composes rather than replaces: a curated advert resolves to its hand-authored
 *  requirement set and the injected reader is never called for it, which is exactly the precedence
 *  `resolveAdRequirements` used to apply when it could still find those sets by fixture id. A test's
 *  own reader keeps answering for everything else, so both populations survive the move. */
export function buildDeckServer(opts: BuildOpts = {}): ReturnType<typeof baseBuildServer> {
  const injected = opts.readAd;
  return baseBuildServer({
    retrievePostings: fixtureRetriever(),
    ...opts,
    readAd: async (posting) => fixtureReadAd(posting) ?? (injected ? await injected(posting) : null),
  });
}

/** Injects and waits out `searching` — the cards route never blocks on provider latency (#245), so
 *  the first read reports retrieval in progress and the deck arrives on a later one. Polls the real
 *  HTTP seam rather than the session store, so a caller needs nothing but the app. */
export async function injectSettled(
  app: App,
  opts: Parameters<App["inject"]>[0],
): Promise<Awaited<ReturnType<App["inject"]>>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const res = await app.inject(opts);
    if (res.statusCode !== 200) return res;
    let searching = false;
    try {
      searching = res.json().searching === true;
    } catch {
      return res; // not a JSON body — nothing to wait for
    }
    if (!searching) return res;
    // setImmediate, NOT setTimeout: #115's read-timeout tests install fake timers over setTimeout,
    // and a poll that slept on a faked timer would hang forever inside them — taking their own
    // `finally { vi.useRealTimers() }` with it and leaving every later test in the file frozen.
    // Nothing here needs wall-clock anyway; the background retrieval settles on microtasks, so
    // yielding a turn of the event loop is exactly the wait required.
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("retrieval never finished");
}

/** #339: discovery no longer takes floor answers, so a test that needs one on record (a confirmed
 *  fact, or a "no") plants it straight into the claims store — `claims.add` / `claims.answerNegative`
 *  — in the same shape the answer route used to write: `discovery-<itemId>`, keyed by the item id. */
export function discoveryFact(itemId: string, text: string): CandidateClaim {
  return {
    id: `discovery-${itemId}`,
    semantic_key: itemId,
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: text,
    needs_grill: false,
    grill_hint: null,
  };
}

/** Writes the snapshot a completed retrieval would have left, without issuing a deck request.
 *
 *  For the tests that cannot afford an extra deck build: one driving a deliberately hung reader, or
 *  counting model calls. Polling `/onboarding/cards` is no good to them — the first read is a wait,
 *  not a deck (#245), so they would have to pay for a second one. This goes through the store's real
 *  claim → reconcile protocol, so the snapshot it leaves is the same one the coordinator would have
 *  persisted, and the session is left with no claim in flight.
 *
 *  #305 amended the sentence this comment used to carry ("the in-memory session object is mutated by
 *  the background retrieval *during* the very first request, so that request usually builds a full
 *  deck too"). It did — the store hands out the stored object — and whether it happened in time was a
 *  race on how many awaits the route performed. buildDeckResponse now pins the retrieval it observed
 *  at the start of the response, so the first read is deterministically a wait. */
export async function seedRetrievalSnapshot(
  built: Pick<ReturnType<typeof baseBuildServer>, "sessions" | "claims">,
  sessionId: string,
  postings: Posting[] = loadPostings(),
): Promise<void> {
  const session = await built.sessions.getById(sessionId);
  if (!session) throw new Error(`no session ${sessionId}`);
  const [confirmed, negatives] = await Promise.all([
    built.claims.confirmed(sessionId),
    built.claims.negatives(sessionId),
  ]);
  const request = retrievalRequestForSession(session, confirmed, negatives);
  const fingerprint = retrievalFingerprint(request);
  const ownerToken = "fixture-deck-harness";
  const claimWindow = retrievalClaimWindow();
  const claimed = await built.sessions.beginRetrievalState(
    sessionId,
    session.retrievalGeneration,
    fingerprint,
    session.retrievalCoordinationFingerprint,
    ownerToken,
    claimWindow.claimedAt,
    claimWindow.staleBefore,
  );
  if (!claimed) throw new Error("could not claim retrieval for seeding");
  const reconciled = await built.sessions.reconcileRetrievalState(
    sessionId,
    session.retrievalGeneration,
    fingerprint,
    ownerToken,
    {
      requestFingerprint: fingerprint,
      recordedAt: new Date().toISOString(),
      result: await fixtureRetriever(postings)(),
    },
  );
  if (!reconciled) throw new Error("could not reconcile seeded retrieval");
}

/** Drives retrieval to completion and throws the deck away.
 *
 *  For a test that counts something per deck build (a read, a judging call, a withdrawal) or that
 *  hits a route which resolves a posting WITHOUT waiting for retrieval (`/want`, `/tailor`). Call it
 *  before snapshotting counters, so the reads that settle retrieval are not inside the window the
 *  test is measuring. */
export async function warmRetrieval(app: App, cookie: string): Promise<void> {
  await getCardsWhenRetrieved(app, cookie);
}

/** The deck once retrieval has finished. */
export function getCardsWhenRetrieved(
  app: App,
  cookie: string,
  url = "/onboarding/cards",
): Promise<Awaited<ReturnType<App["inject"]>>> {
  return injectSettled(app, { method: "GET", url, headers: { cookie } });
}
