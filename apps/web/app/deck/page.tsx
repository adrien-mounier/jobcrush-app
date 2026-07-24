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
import { ensureSession, getCards, requestLink, setStage, wantCard, type JobCard } from "../../lib/api";

type Screen = "loading" | "error" | "empty" | "reveal" | "wall" | "deck" | "tailorHandoff" | "loopback";
type SwipeStatus = "idle" | "leaving-left" | "leaving-right" | "committing";

const L1 = "Lining up your jobs…";
const E1 = "Couldn't line up your jobs.";
const Z1 = "No matches yet.";
const Z2 = "Answer a few more questions and I'll widen the net.";
const H1 = "Where you fit";
const H2 = "Where you don't — yet";
const H3 = "Asked and closed";
const A1 = "Read the ad in full";

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
const TAILOR_LIVE = "Tailoring this job.";

function sentBody(email: string): string {
  return `We sent a sign-in link to ${email}. It expires in 15 minutes.`;
}

function revealText(n: number): string {
  return n === 1 ? "1 job just matched you" : `${n} jobs just matched you`;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function isUnknownCardError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "not_found"
  );
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

  const load = useCallback(async () => {
    setScreen("loading");
    setCurrentIndex(0);
    setSwipeStatus("idle");
    setDeckError(null);
    try {
      await ensureSession();
      const res = await getCards();
      // AC2: the server already sorts by matchPct desc — re-sort defensively (pinned contract note).
      const sorted = [...res.cards].sort((a, b) => b.matchPct - a.matchPct);
      setCards(sorted);
      setAuthed(res.authed);
      if (sorted.length === 0) {
        setScreen("empty");
        return;
      }
      // #22 §6: a failed/cancelled Google round-trip should return here as /deck?login=expired|error
      // — the reveal was already seen before the visitor left for Google, so land straight on the
      // wall with the matching error banner instead of re-showing "See them".
      // ponytail: this branch is currently inert — the server still sends every OAuth failure to
      // /signup?login=…, never /deck. Kept anyway (design §6, forward-compatible): it lights up
      // unchanged once the server threads a return-to through the OAuth `state` param, which is out
      // of scope for this frontend ticket.
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
  }, []);

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

  useEffect(() => {
    if (screen !== "tailorHandoff") return;
    tailorHeadingRef.current?.focus();
  }, [screen]);

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
    setDeckError(null);
    setSwipeStatus("leaving-right");
    const wanted = wantCard(card.adId).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForSwipe();
    setSwipeStatus("committing");
    const result = await wanted;
    if (result.ok) {
      setLiveMessage(TAILOR_LIVE);
      setScreen("tailorHandoff");
      return;
    }

    const copy = isUnknownCardError(result.error) ? WANT_UNKNOWN : WANT_FAILED;
    focusYesAfterErrorRef.current = true;
    setDeckError(copy);
    setLiveMessage(copy);
    setSwipeStatus("idle");
  }, [cards, currentIndex, swipeStatus, waitForSwipe]);

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
                headingRef={cardHeadingRef}
                onLeft={onLeft}
                onRight={onRight}
                reducedMotion={reducedMotion}
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
          <p>Tell me more and this CV gets stronger for this job.</p>
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
          <a className="oauth" href="/api/auth/google" onClick={markReturn}>
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

function ScoreRing({ pct }: { pct: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className="score lg" role="img" aria-label={`${pct}% match`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="bg" cx={32} cy={32} r={r} />
        <circle className="fg" cx={32} cy={32} r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <span className="n">
        {pct}
        <span className="pct">%</span>
      </span>
    </div>
  );
}

function shouldIgnoreSwipeStart(target: EventTarget) {
  if (!(target instanceof Element)) return true;
  return !!target.closest("button,a,summary,input,textarea,select,details.ad[open]");
}

// The card anatomy (AC4): title -> meta -> ring, then the highlight bubble, then the three
// ranked lists, then the ad folded shut last. 2b adds only the swipe stamps and footer controls.
function JobCardView({
  card,
  deckError,
  headingRef,
  onLeft,
  onRight,
  reducedMotion,
  swipeStatus,
  yesButtonRef,
}: {
  card: JobCard;
  deckError: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onLeft: () => void;
  onRight: () => void;
  reducedMotion: boolean;
  swipeStatus: SwipeStatus;
  yesButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const metaLine1 = [card.company, card.place].filter(Boolean).join(" · ");
  const metaLine2 = [card.salary, card.pattern].filter(Boolean).join(" · ");
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
      className={cardClass}
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
        <div className="hd">
          <div className="t">
            <h2 tabIndex={-1} ref={headingRef}>
              {card.title}
            </h2>
            {metaLine1 && (
              <p className="co">
                {metaLine1}
                {metaLine2 && (
                  <>
                    <br />
                    {metaLine2}
                  </>
                )}
              </p>
            )}
          </div>
          <ScoreRing pct={card.matchPct} />
        </div>

        <div className="bubble">
          <p>
            {card.bubble.hit} <span className="gap">{card.bubble.open}</span>
          </p>
        </div>

        <div className="flat">
          {card.fit.length > 0 && (
            <>
              <h3>{H1}</h3>
              {card.fit.map((f) => (
                <div className="row fit" key={f.id}>
                  <span className="mk">✓</span>
                  <span>{f.text}</span>
                </div>
              ))}
            </>
          )}
          {/* Already server-ranked (uncoveredRequirements) — render in array order, no re-rank. */}
          {card.dontYet.length > 0 && (
            <>
              <h3>{H2}</h3>
              {card.dontYet.map((r) => (
                <div className="row open" key={r.id}>
                  <span className="mk">?</span>
                  <span>{r.requirement}</span>
                </div>
              ))}
            </>
          )}
          {/* Omitted when empty — no discovery "no" recorded yet is the common 2a case, but a
              session that already closed one before reaching the deck still shows it here. */}
          {card.askedClosed.length > 0 && (
            <>
              <h3>{H3}</h3>
              {card.askedClosed.map((f) => (
                <div className="row settled" key={f.id}>
                  <span className="mk">·</span>
                  <span>{f.text}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <details className="ad">
          <summary>{A1}</summary>
          <p>{card.adExcerpt}</p>
        </details>
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
