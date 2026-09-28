"use client";

// #19/#21 the reveal + swipeable job deck: a full-bleed reveal ("N jobs just matched you") that
// opens onto a best-first card deck, then lets the visitor choose or pass on each card. This is the
// ONBOARDING job deck (`/deck` index) — unrelated to the S2 claim-confirm deck at `/deck/[jobId]`;
// different route segment, different data, different CSS scope (`.jobdeck`, not the global classes
// `[jobId]/page.tsx` uses).
//
// Renders GET /onboarding/cards as-is (design-19-reveal-card.md's pinned override of its own §1
// DeckJob guess): matchPct, bubble.hit/bubble.open, and the fit/dontYet/askedClosed lists' rank
// order are all composed server-side (matchtick.ts) — nothing here re-derives them.
//
// Screen 2a owns the reveal and card anatomy; screen 2b adds the swipe controls, advancing,
// exhausted-deck loopback, and minimal Tailor handoff.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import "../deck.css";
import { CardBody, useReducedMotion } from "../jobcard";
import { PasteDoor } from "../pastedoor";
import {
  ensureSession,
  chooseFallback,
  getCards,
  requestLink,
  setStage,
  answerLanguageLevel,
  wantCard,
  type CardsResponse,
  type DeckCard,
  type DeckFallbackState,
  type JobCard,
  type LanguageLevelAsk,
  type RetrievalOutcome,
  type ScoredJobCard,
  type WithdrawnSummary,
} from "../../lib/api";

type Screen = "loading" | "searching" | "error" | "unavailable" | "empty" | "reveal" | "wall" | "deck" | "tailorHandoff" | "loopback";
type SwipeStatus = "idle" | "leaving-left" | "leaving-right" | "committing";

const L1 = "Lining up your jobs…";
const S1 = "Still looking for your jobs…";
const E1 = "Couldn't line up your jobs.";
const Z1 = "No matches yet.";
const Z2 = "Answer a few more questions and I'll widen the net.";
// #235: shown instead of Z2 when no question is left to answer — her own result, and her own way to
// change it. Deliberately names no job family, no vocabulary and no research (spec #233 decision 8).
const Z3 = "Try a different job title.";
// #63 — the state that must never wear Z1's words. An empty deck because we could not ASK is a
// different fact from an empty deck because there was nothing there, and only one of them is about
// her. Every market we serve runs on a single source (#174), so "no jobs found" during an outage
// would tell someone their whole market is empty on the strength of one supplier being offline.
// Names no provider and blames nobody: it says what happened and what she can do.
const V1 = "We couldn't look for jobs just now.";
const V2 = "Something on our side didn't answer. Try again in a moment.";
const V3 = "Try again";
// #63 — the dead end's last line when the server REFUSED to search (invalid_request) rather than
// searching and finding nothing. Z3 tells her to change her job title, which is advice about a
// search; we never ran one, so saying it would invent a result. Reachable through the pinned-then-
// unpublished family edge (#237) and any other refusal that leaves no question open.
const Z4 = "We haven't been able to look for these jobs yet.";
// #229 — the career changer's one sentence, shown once above the deck when the server says this
// deck's work is a known zero for her while her CV holds years elsewhere. It states a market fact
// about her CV, names no job family, and never judges: harder, not impossible. The score stays
// generous and the words carry the truth — never the reverse (ADR-0014's restraint rule).
const N1 =
  "This is a change of direction — your CV shows your experience in other kinds of work, so scores here will be lower. Harder, not impossible.";
// #228 (spec #241 decision 12) — the dead end becomes a question. It names her OWN typed words and
// nothing else: no job family, no vocabulary, no research, and no count of jobs, because at the
// moment it is shown nothing has been looked for yet. It asks; it never promises.
const F1 = (role: string | null) =>
  role ? `There are no more jobs for "${role}".` : "There are no more jobs for the words you typed.";
const F2 = "Your CV also proves other work. Do you want me to look there?";
const F3 = "Yes, look";
const F4 = "No thanks";
// AC 9: after a no, the offer stays reachable on the same screen — changing her mind must never
// mean guessing how to get back — but it is never re-raised by itself.
const F5 = "Look at the other work my CV proves";
const F6 = "Looking for the other work your CV proves…";
const F7 = "Couldn't look right now — try again.";
const FALLBACK_POLL_MS = 1200;
const FALLBACK_POLL_MAX = 8;
const SEARCH_POLL_MS = 1200;

// #22 the account wall at the reveal — copy per design-22-wall.md §3 (deck-context copy, never the
// S2 /signup draft copy, even where the strings happen to be close).
const W1 = "See them — they're yours to keep";
const W2 = "Sign in and your matches follow you to any device. No password.";
const W3 = "Continue with Google";
const W4 = "or";
const W5 = "Email me a sign-in link";
const W6 = "Sending…";
const W7 = "Check your email";
const W9 = "Open your sign-in link (dev)";
const W10 = "Wrong email? Change it";
const W11 = "Couldn't send your link — try again.";
const W12 = "Google sign-in didn't finish — try again, or use your email below.";
const W13 = "Google sign-in isn't available right now — use your email below.";
const WALL_LIVE = "Sign in to see your matches.";
const SWIPE_MS = 340;
// #228 (spec #241 decision 13) — this line may only promise what answering can genuinely deliver.
// More answers change the SCORE and the order of the jobs she has; they never add adverts, so the
// old "and I'll widen the net" was a promise the product could not keep. The loopback itself is now
// only reached while a question actually remains (onLeft below).
const LOOPBACK_COPY = "I scored the three closest — tell me more and I'll score them better";
const WANT_UNKNOWN = "That job is no longer available. Pick another one.";
const WANT_FAILED = "Couldn't start tailoring this job — try again.";
const TAILORHANDOFF_DEFAULT = "Tell me more and this CV gets stronger for this job.";
// #117b (addendum §11.7) U4 — the handoff sub-line on the `unscored` want path only, so a longer
// wait (a genuinely cold judgement, not a cache hit) is telling the truth about itself.
const U4 = "Scoring this one against your facts.";
const TAILOR_MIN_HANDOFF_MS = 800;

function sentBody(email: string): string {
  return `We sent a sign-in link to ${email}. It expires in 15 minutes.`;
}

/** #63: an empty deck we could not honestly call a result — we never got a current answer, so
 *  nothing at all is known about her market and no screen may imply otherwise.
 *
 *  `invalid_request` is deliberately NOT here. That is the server refusing a reveal this session has
 *  not earned (a floor still open), and the honest answer to it is the dead end's own "answer a few
 *  more questions" — telling her our systems are down when they are working and simply waiting for
 *  her would be its own lie, just a friendlier-sounding one. `empty_pool` is not here either: it is
 *  the one outcome that genuinely means we asked and there was nothing.
 *
 *  An absent outcome is treated as a real result, so a server that never sends the field keeps
 *  exactly the pre-#63 screen rather than inventing an outage. */
function retrievalFailed(outcome: RetrievalOutcome | undefined): boolean {
  return outcome === "provider_unavailable" || outcome === "stale_data";
}

function revealText(n: number): string {
  return n === 1 ? "1 job just matched you" : `${n} jobs just matched you`;
}

// #123 addendum (2026-08-04) — QA NO-GO fix: the languages question is always discovery's last
// question, so confirming it used to fall straight into this reveal, past the notice area L3/L4
// and "Fix that?" live in. A visitor was never told a job had been removed. L7 says so here instead.
function joinLanguages(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
// L7 (addendum §A2) — only when something was actually removed; `null` means render nothing, no
// reserved space (§A5). `{langList}` names only the languages that caused a removal, in the join
// order §6 already established elsewhere on this screen's sibling copy.
function withdrawnLine(w: WithdrawnSummary): string | null {
  if (w.total <= 0 || w.byLanguage.length === 0) return null;
  const langs = joinLanguages(w.byLanguage.map((l) => l.language));
  return `${w.total} more needed ${langs} — I left ${w.total === 1 ? "it" : "them"} out.`;
}

function isUnknownCardError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "not_found"
  );
}

// #117: the poll (started by load(), see below) only makes sense while a pending card could still
// be shown to the visitor — never on the load/error/empty/handoff/loopback screens.
function isPollableScreen(screen: Screen): boolean {
  return screen === "reveal" || screen === "wall" || screen === "deck";
}

export default function DeckPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("loading");
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeStatus, setSwipeStatus] = useState<SwipeStatus>("idle");
  const [deckError, setDeckError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  // #123 addendum: set once from the initial load — withdrawal is decided before scoring (the ad
  // pool is filtered, not re-judged), so a later poll's applyMerge never needs to touch this.
  const [withdrawn, setWithdrawn] = useState<WithdrawnSummary | null>(null);
  // #235: true while another discovery question exists — picks the empty state's second line
  // (Z2 vs Z3). Defaults to the pre-#235 line so a missing field never invites a dead end.
  const [moreQuestions, setMoreQuestions] = useState(true);
  // #229: whether this deck is a change of direction for her — server-owned (see N1). Defaults
  // false so an absent field never claims one.
  const [newToFamily, setNewToFamily] = useState(false);
  // #228: the server's offer state, and the two things this screen alone owns — whether she re-opened
  // an offer she had already declined, and whether the accepted search is still running.
  const [fallback, setFallback] = useState<DeckFallbackState | null>(null);
  // #63: what the server said happened when it went looking — an empty deck has more than one
  // honest meaning and the screen has to tell them apart.
  const [retrieval, setRetrieval] = useState<CardsResponse["retrieval"] | null>(null);
  const [offerReopened, setOfferReopened] = useState(false);
  const [widening, setWidening] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  // The widening wait can run for ~10s of its own timers, so it gets the same discipline #117's poll
  // has: one cancel flag, checked at every hop, set on unmount — a chain must not outlive its screen.
  const fallbackCancelledRef = useRef(false);
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  const focusReopenRef = useRef(false);
  // Declared here (not near the render below) because the reveal-entry effect further down needs
  // it in its dependency array, and a `const` can't be read before its own declaration.
  const withdrawalCopy = withdrawn ? withdrawnLine(withdrawn) : null;
  const [wallError, setWallError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const reducedMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  const tailorHeadingRef = useRef<HTMLHeadingElement>(null);
  const wallHeadingRef = useRef<HTMLHeadingElement>(null);
  const yesButtonRef = useRef<HTMLButtonElement>(null);
  const focusNextHeadingRef = useRef(false);
  const focusYesAfterErrorRef = useRef(false);
  // #23: latches the tailor handoff navigation so a re-run of this effect can never fire
  // router.push twice for the same handoff (discovery's own deckNavigatedRef precedent).
  const tailorNavigatedRef = useRef(false);

  // #117: poll state for the still-pending cards. None of it is rendered directly (design §6:
  // pendingCount stays internal) — `gaveUp`/`retrying` only ever reach whichever card is on screen,
  // via CardBody's props, when that card is itself still pending.
  const [gaveUp, setGaveUp] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [landingAdId, setLandingAdId] = useState<string | null>(null);
  // #117b §11.7: which sub-line the handoff bridge shows — true only for the one want-attempt
  // currently in flight on an `unscored` card, reset on every subsequent attempt so it never
  // carries over from an earlier failed one.
  const [unscoredHandoff, setUnscoredHandoff] = useState(false);
  // Refs mirroring state that the poll's long-lived closures need to read fresh — kept as refs
  // (rather than effect deps) specifically so the poll loop is never torn down and restarted by a
  // render the poll itself caused (the "must not restart on every render" rule).
  const screenRef = useRef<Screen>("loading");
  const cardsRef = useRef<DeckCard[]>([]);
  const currentIndexRef = useRef(0);
  const swipeStatusRef = useRef<SwipeStatus>("idle");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #117 Standards review: the timer ref alone is null WHILE a fetch is in flight (runPoll clears
  // it before awaiting getCards()), so "is a cycle running" can't be read off it — this ref covers
  // the whole cycle's lifetime, fetch included, and is the one thing both start paths must check.
  const pollActiveRef = useRef(false);
  const pollCancelledRef = useRef(false);
  const pollAttemptRef = useRef(0);
  const pollMaxRef = useRef(6);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #117 a11y §8: announce a landed number once per adId, ever — never on an off-screen landing.
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    swipeStatusRef.current = swipeStatus;
  }, [swipeStatus]);

  // #117: stop the poll cleanly on unmount — CODING_STANDARDS' "effects clean up timers" rule,
  // and the reason a page navigation can never fire a stray fetch into an unmounted deck.
  useEffect(() => {
    return () => {
      pollCancelledRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    };
  }, []);

  // #117: the merge that must not disturb the visitor. Walks the CURRENT cards array (never a fresh
  // array built from the server's response — that would reorder/replace under the visitor's feet):
  // for each slot that is still locally pending, swap in the incoming card only if it has actually
  // landed. currentIndex is never touched; no card is ever added or removed; an already-scored card
  // is never rewritten even if the server sent it again. Bails out to the same `cards` reference
  // (no setState at all) when nothing changed, so a poll that finds nothing new costs zero re-renders.
  const applyMerge = useCallback((incoming: DeckCard[]) => {
    const byId = new Map(incoming.map((c) => [c.adId, c] as const));
    let changed = false;
    let landed: ScoredJobCard | null = null;
    const next = cardsRef.current.map((c, i) => {
      // #117b (addendum §11.1.2): a card is only ever a merge candidate while it is locally
      // `pending` — an `unscored` card is structurally excluded here, never just by convention, so
      // it can never be swapped in by this loop and never picks up a landing bump/announcement.
      if (c.scored !== "pending") return c;
      const updated = byId.get(c.adId);
      if (!updated || updated.scored === "pending") return c;
      changed = true;
      // §11.10 edge case, corrected at review: pending -> unscored IS a real, valid transition —
      // a card judged under one request's budget can simply fall outside a later request's bound.
      // The data still merges above as usual either way; only a REAL score landing ever triggers
      // the bump/announce, never a drop to unscored. Suppressed anyway when mid-swipe (design §4/§7).
      if (
        updated.scored !== "unscored" &&
        i === currentIndexRef.current &&
        swipeStatusRef.current === "idle"
      ) {
        landed = updated;
      }
      return updated;
    });
    if (!changed) return;
    setCards(next);
    if (landed) {
      const card: ScoredJobCard = landed;
      setLandingAdId(card.adId);
      if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
      landingTimerRef.current = setTimeout(() => setLandingAdId(null), 640);
      if (!announcedRef.current.has(card.adId)) {
        announcedRef.current.add(card.adId);
        setLiveMessage(`Scored: ${card.matchPct}% match.`);
      }
    }
  }, []);

  // #117: a recursive setTimeout chain, never setInterval — the next attempt is only scheduled
  // after the previous one has fully resolved (success or a swallowed failure), which is what
  // "never stack overlapping requests" means here. First delay 2000ms, then 3000ms; stops on
  // pendingCount === 0, on reaching pollMaxRef attempts, or the moment screen leaves
  // reveal|wall|deck (checked both before spending an attempt and again before scheduling the next).
  // Standards review: every exit below clears pollActiveRef, not just the timer — a stray chain
  // must not be able to outlive a screen change and block a later legitimate poll from starting.
  const runPoll = useCallback(() => {
    const delay = pollAttemptRef.current === 0 ? 2000 : 3000;
    pollTimerRef.current = setTimeout(async () => {
      pollTimerRef.current = null;
      if (pollCancelledRef.current || !isPollableScreen(screenRef.current)) {
        pollActiveRef.current = false;
        return;
      }
      pollAttemptRef.current += 1;
      try {
        const res = await getCards();
        if (pollCancelledRef.current) {
          pollActiveRef.current = false;
          return;
        }
        applyMerge(res.cards);
        if (res.pendingCount === 0) {
          pollActiveRef.current = false;
          setGaveUp(false);
          return;
        }
      } catch {
        // Swallowed — never a deck-level error banner; the deck is already rendered. The attempt
        // above still counted, so a run of failures still reaches the ceiling.
      }
      if (pollCancelledRef.current || !isPollableScreen(screenRef.current)) {
        pollActiveRef.current = false;
        return;
      }
      if (pollAttemptRef.current >= pollMaxRef.current) {
        pollActiveRef.current = false;
        setGaveUp(true);
        return;
      }
      runPoll();
    }, delay);
  }, [applyMerge]);

  const startPolling = useCallback(() => {
    // Standards review: guard on pollActiveRef, not pollTimerRef — the timer ref is null for the
    // whole duration of an in-flight fetch, so it under-detects a cycle that is very much running.
    if (pollActiveRef.current) return;
    pollActiveRef.current = true;
    pollAttemptRef.current = 0;
    pollMaxRef.current = 6;
    runPoll();
  }, [runPoll]);

  const applyCardsResponse = useCallback((res: CardsResponse) => {
      // #117: the server now returns cards already correctly ordered — judged, then estimated, then
      // pending, score-sorted within each group, curated-opener promotion applied. A client re-sort
      // by matchPct both fails to type-check (matchPct is null on a pending card) and would destroy
      // that order. Render the server's order as-is, always.
      setCards(res.cards);
      setAuthed(res.authed);
      setWithdrawn(res.withdrawn ?? null);
      setMoreQuestions(res.moreQuestions ?? true);
      setNewToFamily(res.newToFamily ?? false);
      setFallback(res.fallback ?? null);
      setRetrieval(res.retrieval ?? null);
      if (res.cards.length === 0) {
        // #63: three different empty decks, three different screens. Still looking is a wait, not a
        // result (#245). A retrieval that could not complete is OUR failure and says so, with a way
        // to retry. Only a search that genuinely finished and found nothing reaches the dead end,
        // which is the one screen allowed to talk about her jobs.
        if (res.searching) setScreen("searching");
        else if (retrievalFailed(res.retrieval?.outcome)) setScreen("unavailable");
        else setScreen("empty");
        return;
      }
      // #117: start chasing the still-pending cards now, during the reveal/wall the visitor is
      // about to spend a few seconds on — most visitors never see a pending card because of this.
      if (res.pendingCount > 0) startPolling();
      // #22 §6: a failed/cancelled Google round-trip should return here as /deck?login=expired|error
      // — the reveal was already seen before the visitor left for Google, so land straight on the
      // wall with the matching error banner instead of re-showing "See them".
      // Live since session 28: the wall's Google link sends `?from=/deck`, which the API remembers
      // in a short-lived cookie and uses for its failure redirects (`apps/api/src/routes/auth.ts`).
      const params = new URLSearchParams(window.location.search);
      const login = params.get("login");
      if (login === "expired") {
        setWallError(W12);
        setScreen("wall");
      } else if (login === "error") {
        setWallError(W13);
        setScreen("wall");
      } else if (params.get("claimed") === "1" && res.authed && !(res.withdrawn && withdrawnLine(res.withdrawn))) {
        // #64 AC3: she pressed "See them", signed in, and came straight back. The reveal has already
        // been read and the count already earned — showing the curtain a second time would make her
        // buy the same reward twice. The deck opens on its first card, which is the highest-ranked
        // one (the server composes that order; currentIndex is 0 from load()). The flag rides the
        // return path the wall stashes, so ONLY a completed claim skips the curtain: a returning
        // visitor typing /deck still gets her reveal.
        //
        // The reveal screen is also where the count is ANNOUNCED and where focus lands, so skipping
        // it has to carry both across: the card heading takes focus through the deck's own entry
        // effect, and the one polite announce still names the reward she earned before signing in.
        //
        // The one thing it can NOT carry across is #123's withdrawal line (L7) — the sentence that
        // tells her a job was left out, and the reason. It lives on the reveal and nowhere else, and
        // a visitor never told a job was removed is the exact defect #123 exists to close. So when
        // there is one to say, she gets the curtain and one more "See them"; skipping is only for
        // the reveal that had nothing left to tell her. Fails toward saying it, never toward silence.
        //
        // One-shot, like the stash it rode in on: the flag is stripped the moment it is spent, so a
        // reload, a back-nav or a bookmarked URL cannot keep skipping a reveal it did not earn.
        window.history.replaceState(null, "", "/deck");
        focusNextHeadingRef.current = true;
        setLiveMessage(revealText(res.cards.length));
        setScreen("deck");
      } else {
        setScreen("reveal");
      }
  }, [startPolling]);

  const load = useCallback(async () => {
    setScreen("loading");
    setCurrentIndex(0);
    setSwipeStatus("idle");
    setDeckError(null);
    // #117: a fresh load starts a fresh poll cycle. Explicitly tear down anything still running
    // from a previous load() (the error screen's "Try again" can re-run this) rather than only
    // resetting the cancel flag — a stray timer left ticking would otherwise coexist with the new
    // cycle once one starts (Standards review: a chain must not be able to outlive a screen change).
    pollCancelledRef.current = false;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollActiveRef.current = false;
    try {
      await ensureSession();
      applyCardsResponse(await getCards());
    } catch {
      // E1 is fixed copy (design §2's copy table), not the raw fetch error.
      setScreen("error");
    }
  }, [applyCardsResponse]);

  // #245: the cards route never waits on provider latency. While the server says that first
  // retrieval is still running, keep the honest waiting screen mounted and ask again until the
  // response becomes either a real deck or a genuinely finished empty result. A recursive timeout
  // keeps requests sequential; cleanup prevents the chain outliving this screen or the component.
  useEffect(() => {
    if (screen !== "searching") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      timer = setTimeout(async () => {
        try {
          const res = await getCards();
          if (cancelled) return;
          applyCardsResponse(res);
          if (res.searching && res.cards.length === 0) poll();
        } catch {
          if (!cancelled) setScreen("error");
        }
      }, SEARCH_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyCardsResponse, screen]);

  // #117: "Try again" on a card that gave up. One immediate fetch, then — if still pending — three
  // more scheduled attempts via the same runPoll chain (a fresh 0..3 count, not a second 0..6 cold
  // start: a nudge, not a second cold-start). A manual-fetch failure leaves `gaveUp` exactly as it
  // was (still true), so the button just re-enables — design §7's "retry fails again" outcome.
  const onCardRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await getCards();
      applyMerge(res.cards);
      setGaveUp(false);
      // Standards review: this used to call runPoll() directly, bypassing startPolling's own
      // "already scheduled" guard entirely — two chains could coexist if a poll cycle somehow
      // hadn't finished yet. Same pollActiveRef guard as startPolling, not the timer ref.
      if (res.pendingCount > 0 && !pollActiveRef.current) {
        pollActiveRef.current = true;
        pollAttemptRef.current = 0;
        pollMaxRef.current = 3;
        runPoll();
      }
    } catch {
      // leave gaveUp untouched — see the comment above
    } finally {
      setRetrying(false);
    }
  }, [applyMerge, retrying, runPoll]);

  const waitForSwipe = useCallback(
    () => new Promise<void>((resolve) => setTimeout(resolve, reducedMotion ? 1 : SWIPE_MS)),
    [reducedMotion],
  );

  useEffect(() => {
    load();
  }, [load]);

  // AC1 a11y: focus the reveal heading + one polite announce on entry — the same mechanic as the
  // shipped discovery -> deck handoff (discovery.css .sr-only + page.tsx's askKey effect). The
  // heading itself is not a live region too, so the announce never doubles up.
  useEffect(() => {
    if (screen !== "reveal") return;
    headingRef.current?.focus();
    // #123 addendum §A4 last bullet: the existing single announce absorbs L7 rather than adding a
    // second one — one polite message, not two.
    setLiveMessage(withdrawalCopy ? `${revealText(cards.length)} ${withdrawalCopy}` : revealText(cards.length));
  }, [screen, cards.length, withdrawalCopy]);

  // #22 §5: one focus move + one announce into the wall. The .big reward heading stays mounted
  // (only the action slot below it swaps — §1), so it never re-fires; only the live text changes.
  useEffect(() => {
    if (screen !== "wall") return;
    wallHeadingRef.current?.focus();
    setLiveMessage(WALL_LIVE);
  }, [screen]);

  // #228: the widening wait dies with the screen that started it.
  useEffect(() => () => {
    fallbackCancelledRef.current = true;
  }, []);

  // #228 a11y: after a decline, focus lands on the way back — the button she pressed is gone.
  useEffect(() => {
    if (!focusReopenRef.current || !reopenButtonRef.current) return;
    focusReopenRef.current = false;
    reopenButtonRef.current.focus();
  }, [fallback]);

  useEffect(() => {
    if (screen !== "deck" || !focusNextHeadingRef.current) return;
    focusNextHeadingRef.current = false;
    cardHeadingRef.current?.focus();
  }, [currentIndex, screen]);

  useEffect(() => {
    if (screen !== "deck" || !deckError || !focusYesAfterErrorRef.current) return;
    focusYesAfterErrorRef.current = false;
    yesButtonRef.current?.focus();
  }, [deckError, screen]);

  // #23: the handoff copy stays up as a brief sub-second bridge (mirroring discovery's own
  // deck-handoff, discovery/page.tsx:302-313), then this navigates. Drop the TAILOR_LIVE announce —
  // /tailor's own entry effect gives the one polite announce, so announcing here too would double it
  // (discovery's stated reason for not announcing on its side). Deviation from the spec's "mirror
  // discovery exactly": discovery's bridge also skips the local focus call, but deck.spec.ts's
  // "shows the Tailor handoff" test pins `heading).toBeFocused()` on this exact screen — kept it to
  // honor that pinned regression test; see the session report for the full conflict note.
  useEffect(() => {
    if (screen !== "tailorHandoff") return;
    tailorHeadingRef.current?.focus();
    const t = setTimeout(() => {
      if (!tailorNavigatedRef.current) {
        tailorNavigatedRef.current = true;
        router.push("/tailor");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [screen, router]);

  // #22: the single, easily-moved gate — a signed-in visitor never sees the wall.
  const onSeeThem = useCallback(() => {
    setScreen(authed ? "deck" : "wall");
  }, [authed]);

  // #228 — her answer to the widening offer. A "no" costs nothing and is remembered (the offer stays
  // reachable below). A "yes" records the choice, then waits on the ONE extra search it implies: the
  // next deck read carries it, and the result replaces this deck. Nothing came back → the honest
  // dead end, with no further search offered (AC 8).
  const onFallbackChoice = useCallback(async (accepted: boolean) => {
    setFallbackError(null);
    setOfferReopened(false);
    try {
      const { fallback: answered } = await chooseFallback(accepted);
      if (fallbackCancelledRef.current) return;
      setFallback(answered);
      if (!accepted || !answered.active) {
        // The offer she just declined is gone from the screen; the way back takes the focus she
        // was holding, rather than dropping it on the document.
        focusReopenRef.current = true;
        return;
      }
      setWidening(true);
      setLiveMessage(F6);
      for (let attempt = 0; attempt < FALLBACK_POLL_MAX; attempt += 1) {
        const res = await getCards();
        // #117's own rule, applied here: a chain must not outlive the screen that started it — this
        // one can run for ten seconds, so every hop checks before it touches state.
        if (fallbackCancelledRef.current) return;
        setFallback(res.fallback ?? answered);
        setMoreQuestions(res.moreQuestions ?? true);
        if (res.cards.length > 0) {
          setCards(res.cards);
          setWithdrawn(res.withdrawn ?? null);
          // #229: the fallback deck is the work her CV proves, not a change of direction — the
          // server says so; without this the stale banner would sit over her own field's jobs.
          setNewToFamily(res.newToFamily ?? false);
          setCurrentIndex(0);
          setSwipeStatus("idle");
          setWidening(false);
          // She is long past the reveal and the wall by the time she reaches a dead end, so the new
          // deck opens directly rather than re-running the curtain.
          setScreen("deck");
          setLiveMessage(`Showing job 1 of ${res.cards.length}.`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, FALLBACK_POLL_MS));
      }
      setWidening(false);
      setLiveMessage(Z3);
    } catch {
      setWidening(false);
      setFallbackError(F7);
    }
  }, []);

  const runLoopback = useCallback(async () => {
    setDeckError(null);
    setSwipeStatus("committing");
    setLiveMessage(`${LOOPBACK_COPY}.`);
    try {
      await setStage("discovery");
      router.push("/discovery?loop=deck-exhausted");
    } catch {
      setSwipeStatus("idle");
      setScreen("loopback");
    }
  }, [router]);

  const onLeft = useCallback(async () => {
    if (swipeStatus !== "idle") return;
    setDeckError(null);
    setSwipeStatus("leaving-left");
    await waitForSwipe();
    const nextIndex = currentIndex + 1;
    if (nextIndex < cards.length) {
      focusNextHeadingRef.current = true;
      setCurrentIndex(nextIndex);
      setSwipeStatus("idle");
      setLiveMessage(`Showing job ${nextIndex + 1} of ${cards.length}.`);
      return;
    }
    // #228 (AC 1/2): the deck is exhausted. With a question left she goes back to the interview,
    // exactly as before — that is the cheap improvement, tried first. With nothing left to ask, the
    // loopback would send her to an empty ask screen, so she reaches the dead end here, where the
    // widening is offered instead.
    if (!moreQuestions) {
      setSwipeStatus("idle");
      setScreen("empty");
      setLiveMessage(Z1);
      return;
    }
    await runLoopback();
  }, [cards.length, currentIndex, moreQuestions, runLoopback, swipeStatus, waitForSwipe]);

  const onRight = useCallback(async () => {
    const card = cards[currentIndex];
    if (!card || swipeStatus !== "idle") return;
    // #117b §11.7: an `unscored` card's want call now runs a full server-side judgement and can
    // take several seconds — every other state's want call is still a cache hit / near-instant, as
    // it always was. Only this one path needs the early handoff below.
    const isUnscored = card.scored === "unscored";
    setDeckError(null);
    setSwipeStatus("leaving-right");
    const wanted = wantCard(card.adId).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForSwipe();
    setSwipeStatus("committing");
    let result: Awaited<typeof wanted>;
    if (isUnscored) {
      // Enter the bridge NOW, before the result is known, so the visitor is never left on a blank
      // deck with the card already gone. Pre-latch tailorNavigatedRef so the handoff effect's own
      // 800ms timer can't navigate before `wanted` has actually settled — reset below on failure.
      tailorNavigatedRef.current = true;
      setUnscoredHandoff(true);
      setScreen("tailorHandoff");
      const minWait = new Promise<void>((resolve) => setTimeout(resolve, TAILOR_MIN_HANDOFF_MS));
      // The existing 800ms grace period becomes max(800ms, wantCard) — both must have happened.
      [result] = await Promise.all([wanted, minWait]);
    } else {
      result = await wanted;
    }
    if (result.ok) {
      if (isUnscored) {
        router.push("/tailor"); // already latched above; the generic effect would be a no-op now
      } else {
        setScreen("tailorHandoff");
      }
      return;
    }

    if (isUnscored) {
      // This attempt never actually navigated — restore both latches for whichever card is next.
      tailorNavigatedRef.current = false;
      setUnscoredHandoff(false);
      setScreen("deck");
    }
    const copy = isUnknownCardError(result.error) ? WANT_UNKNOWN : WANT_FAILED;
    focusYesAfterErrorRef.current = true;
    setDeckError(copy);
    setLiveMessage(copy);
    setSwipeStatus("idle");
  }, [cards, currentIndex, router, swipeStatus, waitForSwipe]);

  const n = cards.length;
  const currentCard = cards[currentIndex];
  // #63: the server refused rather than searched, so nothing is known about her search and no line
  // may describe one. Kept out of retrievalFailed() on purpose — this is not an outage, and it does
  // not get the outage screen; it only changes the one line that would otherwise give search advice.
  const neverSearched = retrieval?.outcome === "invalid_request";
  // #228: the offer is shown when the server says it can be honoured, or when she declined it and
  // asked for it back. Never while the accepted search is still running.
  const showFallbackOffer =
    !widening && !!fallback && !fallback.active && (fallback.offered || (fallback.declined && offerReopened));

  return (
    <div className="jobdeck">
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {/* #303 (QA D3): the door's slot on the deck's RESTING states — the empty deck, a provider
          outage, a failed load. A signed-in person sitting on "No matches yet" is exactly the one
          who wants to bring a job of his own, and before this there was no top bar on that screen
          at all, so there was no way to reach the door from where he had landed.
          Deliberately NOT on loading/searching/tailorHandoff: those pass in a second or two, and a
          top bar appearing and vanishing under him is worse than a door he did not need yet. */}
      {authed && (screen === "empty" || screen === "unavailable" || screen === "error") && (
        <div className="topbar">
          <span className="wordmark">JobCrush</span>
          <span className="spacer" />
          <PasteDoor />
        </div>
      )}

      {screen === "loading" && <div className="loadstate">{L1}</div>}

      {screen === "searching" && <div className="loadstate">{S1}</div>}

      {/* #63: the outage state, deliberately NOT the dead end. No job count, no claim about her
          market, no fallback offer — nothing was searched, so nothing about her search is known. */}
      {screen === "unavailable" && (
        <div className="loadstate">
          <p className="big">{V1}</p>
          <p role="alert">{V2}</p>
          <button type="button" onClick={load}>
            {V3}
          </button>
        </div>
      )}

      {screen === "error" && (
        <div className="loadstate">
          <p role="alert">{E1}</p>
          <button type="button" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {/* #228: the dead end — reached either because nothing was found or because she swiped past
          the last card, which are deliberately the same state (spec #241 decision 4). The offer is
          the server's decision; whether the deck is finished is this screen's. */}
      {screen === "empty" && (
        <div className="loadstate">
          <p className="big">{Z1}</p>
          {widening ? (
            <p>{F6}</p>
          ) : showFallbackOffer ? (
            <>
              <p>{F1(fallback?.targetRole ?? null)}</p>
              <p>{F2}</p>
              <button type="button" onClick={() => onFallbackChoice(true)}>
                {F3}
              </button>
              <button type="button" onClick={() => onFallbackChoice(false)}>
                {F4}
              </button>
            </>
          ) : (
            <>
              <p>{moreQuestions ? Z2 : neverSearched ? Z4 : Z3}</p>
              {/* AC 9: she said no, and the way back is on the screen rather than something to
                  guess at — but the question itself is never raised again by itself. */}
              {fallback?.declined && !fallback.active && (
                <button type="button" ref={reopenButtonRef} onClick={() => setOfferReopened(true)}>
                  {F5}
                </button>
              )}
            </>
          )}
          {fallbackError && <p role="alert">{fallbackError}</p>}
        </div>
      )}

      {/* AC1: the deck is not mounted until "See them" is pressed — nothing behind the reveal is
          structural, not a blur hiding content. #22: the wall is not a new screen/redirect — it
          replaces the "See them" button inside this same curtain, so the reward (the h1 above)
          stays on screen above the ask (§1). */}
      {(screen === "reveal" || screen === "wall") && (
        <div className="curtain">
          <div>
            <div className="burst" aria-hidden="true">
              🂠
            </div>
            <h1 className="big" tabIndex={-1} ref={headingRef}>
              {n} {n === 1 ? "job" : "jobs"} just <em>matched you</em>
            </h1>
            {screen === "reveal" ? (
              <>
                <button type="button" className="go" onClick={onSeeThem}>
                  See them
                </button>
                {/* #123 addendum §A1/§A5: below the CTA (provenance for the number), not above it
                    (a caveat on the reward); nothing rendered — no reserved space — when k === 0.
                    §A4's "Fix my languages" undo is NOT built here: it needs a way to reopen an
                    already-answered eligibility question with its prior ticks restored, and no
                    such route exists yet (verified — see the session report). Shipping a link to
                    nowhere would be worse than the silent removal this fix exists to close, so
                    this only lands the visibility half for now. */}
                {withdrawalCopy && <p className="aside">{withdrawalCopy}</p>}
              </>
            ) : (
              <WallPanel headingRef={wallHeadingRef} initialError={wallError} />
            )}
          </div>
        </div>
      )}

      {screen === "deck" && (
        <>
          <div className="topbar">
            <span className="wordmark">JobCrush</span>
            <span className="spacer" />
            {/* #303: the same top-bar slot on every signed-in screen. The rule is stated HERE and
                only here because the deck is the one screen that also renders before the wall —
                /profile, /tailor and /job are reachable signed-in only (a signed-out visitor is
                redirected to the wall), so their door needs no guard of its own. */}
            {authed && <PasteDoor />}
          </div>
          <p className="deckcount">
            {currentIndex + 1} of {n} matched today · swipe or tap
          </p>
          {/* #229: said once, above the deck, where the lower scores it explains are on screen —
              never per card (nagging) and never on the reveal (nothing there needs explaining). */}
          {newToFamily && <p className="newfamily">{N1}</p>}
          <div className="deck">
            {currentCard && (
              <JobCardView
                key={`${currentCard.adId}-${currentIndex}`}
                card={currentCard}
                deckError={deckError}
                gaveUp={gaveUp}
                headingRef={cardHeadingRef}
                landing={landingAdId === currentCard.adId}
                onLeft={onLeft}
                onRetry={onCardRetry}
                onRight={onRight}
                reducedMotion={reducedMotion}
                retrying={retrying}
                swipeStatus={swipeStatus}
                yesButtonRef={yesButtonRef}
              />
            )}
          </div>
        </>
      )}

      {screen === "tailorHandoff" && (
        <div className="loadstate tailorhandoff">
          <h1 className="big" tabIndex={-1} ref={tailorHeadingRef}>
            Tailoring this one
          </h1>
          <p>{unscoredHandoff ? U4 : TAILORHANDOFF_DEFAULT}</p>
        </div>
      )}

      {screen === "loopback" && (
        <>
          <div className="topbar">
            <span className="wordmark">JobCrush</span>
            <span className="spacer" />
            {authed && <PasteDoor />}
          </div>
          <div className="loopback">
            <p className="big">{LOOPBACK_COPY}</p>
            <button type="button" className="go" onClick={runLoopback} disabled={swipeStatus === "committing"}>
              Answer more questions
            </button>
            <p className="sub">Nothing you told me is lost.</p>
          </div>
        </>
      )}
    </div>
  );
}

// #22 the account wall at the reveal: Google OAuth leading, magic link secondary. Structure/logic
// ported from /signup (the <a href="/api/auth/google"> + Google SVG, requestLink, dev-link,
// ?login= handling) — restyled to deck.css's .jobdeck .wall tokens, never signup's global classes
// (design-22-wall.md's mandatory CSS-scoping rule).
function WallPanel({
  headingRef,
  initialError,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // #22 return-path wiring: sign-in resumes on /deck (the verify screen otherwise only knows
  // /deck/[jobId] or the front door). Stashed before either door is opened, read back by /auth/verify.
  // #64: `claimed=1` is what tells the deck the reveal was already earned on the way in, so the
  // resumed visitor lands on the highest-ranked job rather than on a second curtain.
  const markReturn = () => localStorage.setItem("jc_return", "/deck?claimed=1");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // The anon session must exist before the link can claim it — ensureSession() already ran in
      // load(), this is the cheap defensive mirror of signup.
      await ensureSession();
      markReturn();
      setSent(await requestLink(email));
    } catch {
      setError(W11);
      setBusy(false);
    }
  };

  return (
    <div className="wall">
      <h2 tabIndex={-1} ref={headingRef}>
        {W1}
      </h2>
      <p className="sub">{W2}</p>
      {!sent ? (
        <>
          {initialError && (
            <p className="err" role="alert">
              {initialError}
            </p>
          )}
          <a className="oauth" href="/api/auth/google?from=/deck" onClick={markReturn}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            {W3}
          </a>
          <div className="divider">{W4}</div>
          <input
            type="email"
            aria-label="Email address"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email.includes("@") && submit()}
          />
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="sendlink" onClick={submit} disabled={busy || !email.includes("@")}>
            {busy ? W6 : W5}
          </button>
        </>
      ) : (
        <div className="sent">
          <p className="lead">{W7}</p>
          <p className="sub">{sentBody(email)}</p>
          {sent.devLink && (
            <a className="oauth" href={sent.devLink}>
              {W9}
            </a>
          )}
          <button
            type="button"
            className="changeemail"
            onClick={() => {
              setSent(null);
              setBusy(false);
            }}
          >
            {W10}
          </button>
        </div>
      )}
    </div>
  );
}

function shouldIgnoreSwipeStart(target: EventTarget) {
  if (!(target instanceof Element)) return true;
  return !!target.closest("button,a,summary,input,textarea,select,details.ad[open]");
}

// #165 — the ladder an advert triggers, rendered inside the card that triggered it so the reason and
// the question are in the same place. Answering closes this language for good (server-side: a stored
// rung is what stops it firing again); skipping is "not now" and a later advert testing the same
// language will ask again, so this deliberately keeps no "don't ask me again" control — ADR-0011
// clause 4 forbids a permanent mute until the profile surface that undoes one exists.
//
// ponytail: a skip is remembered for this card view only, not stored. Reloading the deck re-shows it
// on the same advert, which ADR-0011's "never twice for the same advert" would rather it did not.
// Give the skip a home in the store when there is a per-advert record to hang it on.
function LanguageLadder({ ask }: { ask: LanguageLevelAsk }) {
  const [closed, setClosed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ids are per-instance: two mounted cards would otherwise both claim "ladder-why" and a screen
  // reader would read the wrong card's reason.
  const uid = useId();
  if (closed) {
    return (
      <p className="ladder done" role="status">
        {closed}
      </p>
    );
  }
  async function answer(level: string, situation: string) {
    setBusy(true);
    setErr(null);
    try {
      await answerLanguageLevel(ask.language, level);
      setClosed(`Noted for ${ask.language}: ${situation.toLowerCase()}. I won't ask again.`);
    } catch {
      setErr("That didn't save. Try again?");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="ladder" aria-describedby={`${uid}-why ${uid}-cost`}>
      <legend>{ask.question}</legend>
      <p className="why" id={`${uid}-why`}>
        {ask.why}
      </p>
      {/* #125 decision 4: the screen says what an answer costs BEFORE the answer, never after. */}
      <p className="cost" id={`${uid}-cost`}>
        {ask.consequence}
      </p>
      <div className="rungs">
        {ask.options.map((rung) => (
          <button
            key={rung.value}
            type="button"
            className="rung"
            data-level={rung.value}
            disabled={busy}
            onClick={() => answer(rung.value, rung.situation)}
          >
            {rung.situation}
          </button>
        ))}
      </div>
      <button type="button" className="skip" disabled={busy} onClick={() => setClosed(skipNotice(ask.language))}>
        {ask.skipOption}
      </button>
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
    </fieldset>
  );
}
const skipNotice = (language: string): string => `Skipped — I'll ask about ${language} another time.`;

function JobCardView({
  card,
  deckError,
  gaveUp,
  headingRef,
  landing,
  onLeft,
  onRetry,
  onRight,
  reducedMotion,
  retrying,
  swipeStatus,
  yesButtonRef,
}: {
  card: DeckCard;
  deckError: string | null;
  gaveUp: boolean; // #117: only visible while this card is scored === "pending"
  headingRef: RefObject<HTMLHeadingElement | null>;
  landing: boolean; // #117: true for 640ms right after this card's number lands while on screen
  onLeft: () => void;
  onRetry: () => void; // #117: "Try again" on a gaveUp pending card
  onRight: () => void;
  reducedMotion: boolean;
  retrying: boolean; // #117: onRetry's own fetch is in flight
  swipeStatus: SwipeStatus;
  yesButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x0: number; y0: number; dx: number; live: boolean; pointerId: number | null } | null>(
    null,
  );
  const busy = swipeStatus !== "idle";
  const cardClass = [
    "jobcard",
    dragging ? "dragging" : "",
    swipeStatus === "leaving-left" ? "out-left" : "",
    swipeStatus === "leaving-right" ? "out-right" : "",
    // #117: 640ms bump on the card the number just landed on, while it's on screen (design §4).
    landing ? "landing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const dragStyle: CSSProperties | undefined =
    !busy && !reducedMotion && dragX !== 0
      ? { transform: `translateX(${dragX}px) rotate(${dragX * 0.045}deg)` }
      : undefined;
  const stampOpacity = !busy && !reducedMotion ? Math.min(1, Math.abs(dragX) / 110) : 0;

  useEffect(() => {
    if (swipeStatus === "idle") return;
    setDragX(0);
    setDragging(false);
  }, [swipeStatus]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (busy || shouldIgnoreSwipeStart(e.target)) return;
    dragRef.current = { x0: e.clientX, y0: e.clientY, dx: 0, live: false, pointerId: null };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || busy) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.live) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        dragRef.current = null;
        return;
      }
      drag.live = true;
      drag.pointerId = e.pointerId;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    drag.dx = dx;
    if (!reducedMotion) setDragX(dx);
  }

  function releasePointer(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    setDragX(0);
    if (!drag.live) return;
    if (drag.dx > 90) onRight();
    else if (drag.dx < -90) onLeft();
  }

  return (
    <div
      // #117: data-scored is a QA/e2e hook only (zero visual); aria-busy is real — a screen-reader
      // user is told this card is still working, and the attribute disappears the moment it isn't
      // (design §8), rather than sitting there permanently as aria-busy="false".
      aria-busy={card.scored === "pending" ? true : undefined}
      className={cardClass}
      data-scored={card.scored}
      onPointerCancel={releasePointer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      style={dragStyle}
    >
      <span className="stamp yes" aria-hidden="true" style={{ opacity: dragX > 0 ? stampOpacity : 0 }}>
        Want it
      </span>
      <span className="stamp no" aria-hidden="true" style={{ opacity: dragX < 0 ? stampOpacity : 0 }}>
        Not for me
      </span>
      <div className="jcbody">
        <CardBody card={card} gaveUp={gaveUp} headingRef={headingRef} onRetry={onRetry} retrying={retrying} />
        {card.levelAsk && <LanguageLadder ask={card.levelAsk} />}
      </div>
      {deckError && (
        <p className="deckerr" role="alert">
          {deckError}
        </p>
      )}
      <div className="jcfoot">
        <button
          type="button"
          className="sw"
          aria-label="Not for me, show next job"
          disabled={busy}
          onClick={onLeft}
        >
          Not for me
        </button>
        <button
          type="button"
          className="sw yes"
          aria-label="I want this one, tailor this job"
          disabled={busy}
          onClick={onRight}
          ref={yesButtonRef}
        >
          I want this one
        </button>
      </div>
    </div>
  );
}
