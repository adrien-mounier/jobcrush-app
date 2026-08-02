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
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import "../deck.css";
import { CardBody, useReducedMotion } from "../jobcard";
import {
  ensureSession,
  getCards,
  requestLink,
  setStage,
  wantCard,
  type JobCard,
  type ScoredJobCard,
} from "../../lib/api";

type Screen = "loading" | "error" | "empty" | "reveal" | "wall" | "deck" | "tailorHandoff" | "loopback";
type SwipeStatus = "idle" | "leaving-left" | "leaving-right" | "committing";

const L1 = "Lining up your jobs…";
const E1 = "Couldn't line up your jobs.";
const Z1 = "No matches yet.";
const Z2 = "Answer a few more questions and I'll widen the net.";

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
const LOOPBACK_COPY = "I scored the three closest — tell me more and I'll widen the net";
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

function revealText(n: number): string {
  return n === 1 ? "1 job just matched you" : `${n} jobs just matched you`;
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
  const [cards, setCards] = useState<JobCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeStatus, setSwipeStatus] = useState<SwipeStatus>("idle");
  const [deckError, setDeckError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
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
  const cardsRef = useRef<JobCard[]>([]);
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
  const applyMerge = useCallback((incoming: JobCard[]) => {
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
      const res = await getCards();
      // #117: the server now returns cards already correctly ordered — judged, then estimated, then
      // pending, score-sorted within each group, curated-opener promotion applied. A client re-sort
      // by matchPct both fails to type-check (matchPct is null on a pending card) and would destroy
      // that order. Render the server's order as-is, always.
      setCards(res.cards);
      setAuthed(res.authed);
      if (res.cards.length === 0) {
        setScreen("empty");
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
      const login = new URLSearchParams(window.location.search).get("login");
      if (login === "expired") {
        setWallError(W12);
        setScreen("wall");
      } else if (login === "error") {
        setWallError(W13);
        setScreen("wall");
      } else {
        setScreen("reveal");
      }
    } catch {
      // E1 is fixed copy (design §2's copy table), not the raw fetch error.
      setScreen("error");
    }
  }, [startPolling]);

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
    setLiveMessage(revealText(cards.length));
  }, [screen, cards.length]);

  // #22 §5: one focus move + one announce into the wall. The .big reward heading stays mounted
  // (only the action slot below it swaps — §1), so it never re-fires; only the live text changes.
  useEffect(() => {
    if (screen !== "wall") return;
    wallHeadingRef.current?.focus();
    setLiveMessage(WALL_LIVE);
  }, [screen]);

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
    await runLoopback();
  }, [cards.length, currentIndex, runLoopback, swipeStatus, waitForSwipe]);

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

  return (
    <div className="jobdeck">
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {screen === "loading" && <div className="loadstate">{L1}</div>}

      {screen === "error" && (
        <div className="loadstate">
          <p role="alert">{E1}</p>
          <button type="button" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {screen === "empty" && (
        <div className="loadstate">
          <p className="big">{Z1}</p>
          <p>{Z2}</p>
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
              <button type="button" className="go" onClick={onSeeThem}>
                See them
              </button>
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
          </div>
          <p className="deckcount">
            {currentIndex + 1} of {n} matched today · swipe or tap
          </p>
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

  // #22 return-path wiring: sign-in resumes on /deck (the S2 verify screen otherwise only knows
  // /deck/[jobId] or /import). Stashed before either door is opened, read back by /auth/verify.
  const markReturn = () => localStorage.setItem("jc_return", "/deck");

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
  card: JobCard;
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
