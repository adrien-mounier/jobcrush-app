// #228 (spec #241) — the dead end becomes a choice: "there are no more jobs for the words you
// typed; your CV also proves other work — shall I look there?" The product OFFERS and never acts on
// its own. She asked for her target family; she is never moved out of it without saying so.
//
// This module owns both halves of that decision, so the route stays thin (spec decision 3, and the
// spine's own ratchet):
//   - fallbackOffer(): what THIS deck response should say about the offer. Server-owned — the screen
//     renders it, it does not decide (decision 1).
//   - applyFallbackChoice(): what her yes/no writes to the session. Accepting is a ONE-WAY LATCH,
//     which is what bounds the whole ticket to one extra provider search: the accepted family goes
//     into the retrieval request, that is a new fingerprint, and one snapshot is retrieved and then
//     reused for every later read (decisions 6/7). No counter, no new bookkeeping.
//
// No provider call happens here. Accepting only records the choice; the next deck read pays for the
// one search — so a visitor who declines costs nothing (AC 4).
//
// Why "for the session" is the right scope for that latch, checked rather than assumed (spec
// decision 8, story 19): `jc_session` is set with NO maxAge (routes/sessions.ts), so it is a browser
// session cookie. A reload keeps the widening she asked for; closing the browser and coming back
// tomorrow starts a new session record, in target scope, and her own family is searched first again.
// The choice is deliberately not remembered across that boundary.
import { fallbackFamilyFor } from "./adaptiveDiscovery.js";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
import type { JobBlockView } from "./jobBlockStore.js";
import type { SessionRecord, SessionStore } from "./sessions.js";

export interface DeckFallbackState {
  /** The offer MAY be shown: nothing is left to ask, she is not already widened, and her own dated
   *  job records prove a family we can actually search (decision 2). Whether the deck is FINISHED is
   *  the screen's own fact and deliberately not re-derived here — a pool that came back empty and a
   *  deck she swiped to the end of are the same dead end (decision 4), and only the screen knows the
   *  second one. Every eligibility question in that decision is answered on this side. */
  offered: boolean;
  /** She said no in this session — the dead end is shown, and the offer stays reachable on the same
   *  screen rather than being raised again by itself (AC 9). */
  declined: boolean;
  /** This deck IS the widening she accepted. */
  active: boolean;
  /** Her own typed words, which the offer names — and the ONLY thing it names. No job family, no
   *  vocabulary, no research, and no count of jobs, because none have been looked for yet
   *  (decision 12, following #233 decision 8). */
  targetRole: string | null;
}

export function fallbackOffer(
  session: Pick<SessionRecord, "discovery" | "intent" | "targetTitles">,
  moreQuestions: boolean,
  blocks: readonly JobBlockView[],
  published: Pick<ProductionFamilyFloorStore, "active">,
): DeckFallbackState {
  const active = session.discovery.fallback.family !== null;
  return {
    offered:
      !active &&
      // AC 9 / story 7: she said no. The screen keeps the offer reachable; nothing raises it again
      // by itself, including a reload.
      !session.discovery.fallback.declined &&
      !moreQuestions &&
      fallbackFamilyFor(blocks, published, session.discovery.searchFamily) !== null,
    declined: session.discovery.fallback.declined,
    active,
    targetRole: session.intent.targetRole ?? session.targetTitles[0] ?? null,
  };
}

/** Her answer. `accepted` pins the fallback family — once, ever, for this session; a second
 *  acceptance re-reads the same latched family and buys nothing. Declining is remembered so the
 *  question is not re-raised by itself. Returns the session's refreshed offer state. */
export async function applyFallbackChoice(
  sessions: Pick<SessionStore, "setDiscoveryFallback">,
  session: Pick<SessionRecord, "id" | "discovery" | "intent" | "targetTitles">,
  accepted: boolean,
  blocks: readonly JobBlockView[],
  published: Pick<ProductionFamilyFloorStore, "active">,
): Promise<DeckFallbackState> {
  const current = session.discovery.fallback;
  const family = accepted
    ? current.family ?? fallbackFamilyFor(blocks, published, session.discovery.searchFamily)
    : current.family;
  const next = { declined: accepted ? current.declined : true, family };
  const discovery =
    next.declined === current.declined && next.family === current.family
      ? session.discovery
      : await sessions.setDiscoveryFallback(session.id, next);
  // The offer itself is never re-raised straight after an answer — she has just given one.
  return { ...fallbackOffer({ ...session, discovery }, true, blocks, published), offered: false };
}
