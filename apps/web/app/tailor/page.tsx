"use client";

// #23 Tailor (screen 3): re-score, the live card, and the exits. Reached from /deck's "I want this
// one" -> tailorHandoff bridge. Renders the SAME card anatomy as /deck (jobcard.tsx's CardBody) over
// a read-only CV paper (discovery's rendering convention) and a question dock (discovery's opts/
// field convention) — this file wires the two together against the pinned TailorState contract.
//
// Every value on the card — matchPct, the bubble's two clauses, the fit/dontYet/askedClosed lists,
// the ledger text — is server-composed. This screen never re-derives any of it: it tweens the
// *display* of matchPct between two server-given numbers, keys rows so React remounts them when they
// move lists (the ?->check flip), and renders ledger[].text verbatim.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "../deck.css";
import "../tailor.css";
import { FactBadge, type FactChipFlight } from "../factbadge";
import { CardBody, useReducedMotion } from "../jobcard";
import {
  answerTailor,
  dropTailor,
  ensureSession,
  getTailor,
  type CvSection,
  type DiscoveryCvLine,
  type JobCard,
  type TailorQuestion,
  type TailorState,
} from "../../lib/api";

type Screen = "loading" | "error" | "flow" | "applied" | "saved";

// #117c (addendum §12.5): was "Opening this job…", written for a cache read. ~7 of 15 cards now
// judge on demand here (§11), a genuinely cold call of several seconds — "Opening" promises an
// instant action a multi-second wait would then contradict. Matches U4 (deck/page.tsx, §11.4) word
// for word so the deck -> handoff -> tailor-loading sequence reads as one continuous statement.
const T1 = "Scoring this job against your facts…";
const T2 = "Couldn't open this job.";
const T3 = "Try again";
const T4 = "Answer and this card moves";
const T6 = "your CV for this job";
const T7 = "Couldn't save that — try again.";
const T8 = "I'm done — use this CV";
const T9 = "Drop this job";
const T10 = "Everything you told me stays on your profile.";
const T11 = "Drop it";
const T12 = "Keep it";
const T13 = "This CV is as strong as I can make it for this job.";
const T15 = "Apply with this CV";
const T16 = "Save it and come back later";
const T19 = "Saved";
const T21 = "Back to the deck";
const DROP_FAILED = "Couldn't drop this job — try again.";

const SCORE_TWEEN_MS = 680;
const SCORE_BUMP_MS = 470;
const ROW_SETTLE_MS = 640;
const HANDOFF_SCROLL_BOTTOM_PAD = 34;

const SECTIONS: { key: CvSection; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "experience", label: "Experience" },
  { key: "skills", label: "Skills" },
  { key: "education", label: "Education" },
];

function closedGapsLine(cg: { closed: number; asked: number }): string {
  if (cg.closed === 0) return "Everything you told me is in there.";
  if (cg.asked === 1) return "You closed the one gap this job asked about.";
  return `You closed ${cg.closed} of the ${cg.asked} gaps this job asked about.`;
}

function appliedLine(title: string): string {
  return `Your CV for “${title}” is done. Nothing goes out until you press send.`;
}

function savedLine(title: string, matchPct: number): string {
  return `“${title}” is waiting for you at ${matchPct}%. Pick it up whenever you want.`;
}

// Ported from discovery/page.tsx's own keepInView, with an explicit topPad (here: the sticky card
// head's own height + 14, so scrolling never tucks the changed row behind it) instead of a fixed one.
function keepInView(wrap: HTMLElement, el: HTMLElement, topPad: number, reduced: boolean) {
  const b = wrap.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  let d = 0;
  if (e.bottom > b.bottom - HANDOFF_SCROLL_BOTTOM_PAD) d = e.bottom - (b.bottom - HANDOFF_SCROLL_BOTTOM_PAD);
  else if (e.top < b.top + topPad) d = e.top - (b.top + topPad);
  if (Math.abs(d) > 1) wrap.scrollBy({ top: d, behavior: reduced ? "auto" : "smooth" });
}

// The row that just changed, found by diffing card.fit/card.askedClosed against the previous card —
// NOT by reusing requirementId. Those two lists carry claim ids (tailor-<slug(adId)>-<reqId>), not
// requirement ids, so a requirement id never matches a `[data-req]` row once it's answered. A "yes"
// lands a new fit entry; a "no" lands a new askedClosed entry (never a fit-list guess). No new entry
// in either ⇒ nothing to scroll to (shouldn't happen, but scroll/flash are both no-ops on null).
function resolveLandedId(prevCard: JobCard, nextCard: JobCard): string | null {
  const prevFit = new Set(prevCard.fit.map((f) => f.id));
  const newFit = nextCard.fit.find((f) => !prevFit.has(f.id));
  if (newFit) return newFit.id;
  const prevClosed = new Set(prevCard.askedClosed.map((f) => f.id));
  const newClosed = nextCard.askedClosed.find((f) => !prevClosed.has(f.id));
  return newClosed?.id ?? null;
}

function renderCv(cvLines: DiscoveryCvLine[]) {
  const role = cvLines.find((l) => l.itemId === "role");
  return (
    <div className="cv">
      <p className="cv-role">{role?.text ?? ""}</p>
      {SECTIONS.map((s) => {
        const lines = cvLines.filter((l) => l.itemId !== "role" && l.section === s.key);
        return (
          <section key={s.key} aria-labelledby={`tailor-cvsec-${s.key}`}>
            <h2 id={`tailor-cvsec-${s.key}`} className="cv-sec">
              {s.label}
            </h2>
            {lines.length === 0 ? (
              <div className="cv-gap" />
            ) : (
              lines.map((l) => (
                <p key={l.itemId} className="cv-line done">
                  {l.text}
                </p>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function TailorPage() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [screen, setScreen] = useState<Screen>("loading");
  const [tailor, setTailor] = useState<TailorState | null>(null);
  const [displayPct, setDisplayPct] = useState(0);
  const [scoreBumped, setScoreBumped] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [ledgerView, setLedgerView] = useState<{ key: string; text: string; gold: boolean } | null>(null);
  const [finishedEarly, setFinishedEarly] = useState(false);
  const [answering, setAnswering] = useState<{ requirementId: string; answer: string } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [dropConfirming, setDropConfirming] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [returnDropFocus, setReturnDropFocus] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  // #17 the profile badge: same seam as discovery — the parent owns the data, FactBadge owns motion.
  const [badgeCount, setBadgeCount] = useState(0);
  const [fly, setFly] = useState<FactChipFlight | null>(null);
  // The answered control's rect, captured on the root's capture-phase click (M2: a ref, not a
  // DOMRect threaded through answerQuestion — discovery/page.tsx's own fix, same reasoning).
  const flyFromRef = useRef<DOMRect | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  const endingHeadingRef = useRef<HTMLHeadingElement>(null);
  const appliedHeadingRef = useRef<HTMLHeadingElement>(null);
  const savedHeadingRef = useRef<HTMLHeadingElement>(null);
  const liveWrapRef = useRef<HTMLDivElement>(null);
  // #51: on desktop .live-wrap is display:contents (no scroll box); the live-card itself scrolls.
  // Used as the keepInView scroll container when live-wrap has no box.
  const liveCardRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLElement | null>(null);
  const setFirstControl = (el: HTMLElement | null) => {
    firstControlRef.current = el;
  };
  const dropTriggerRef = useRef<HTMLButtonElement>(null);
  const dropItRef = useRef<HTMLButtonElement>(null);

  const enteredRef = useRef(false);
  const askKeyInitRef = useRef(false);
  const prevAskKeyRef = useRef<string | null>(null);
  const pendingScrollRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const landedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureSession();
      const state = await getTailor();
      setTailor(state);
      setDisplayPct(state.card.matchPct);
      setBadgeCount((c) => Math.max(c, state.factCount)); // the monotone clamp, at every write
      setScreen("flow");
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
      // #30: a signed-out visitor hits this on direct load (no session yet to carry a tailor target).
      // /deck already walls the reveal for an unauthed visitor (its own onSeeThem gate) — same
      // destination as no_tailor_target, not a new one.
      //
      // #63: `not_found` joins them, because this screen can no longer recover from it. The advert
      // being tailored is resolved from the session's retrieval snapshot, and changing her evidence
      // or where she is looking correctly stales that snapshot — a decided fail-closed rule (#101,
      // pinned by postingRetrievalHttp.test.ts) that the fixture pool used to hide. Nothing on THIS
      // screen re-runs retrieval, so the old "Try again" button re-sent the same doomed request for
      // ever and left her with no way back to her jobs. The deck is where retrieval re-runs and
      // where her target comes back, so that is where she goes. Her session and her target are
      // untouched — this is a redirect, not a reset.
      if (code === "no_tailor_target" || code === "login_required" || code === "not_found") {
        router.replace("/deck"); // never leave /tailor in history — it would just redirect forward again
        return;
      }
      setScreen("error");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Unmount safety net (CODING_STANDARDS: effects clean up timers/rAF in teardown).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
      if (landedTimerRef.current) clearTimeout(landedTimerRef.current);
    };
  }, []);

  // Entry (§7.2): focus the card heading once, ever, on the first successful load. Announce once —
  // every later announce (a new question, the ending) is the askKey effect below.
  useEffect(() => {
    if (screen !== "flow" || !tailor || enteredRef.current) return;
    enteredRef.current = true;
    cardHeadingRef.current?.focus();
    setLiveMessage(`Tailoring ${tailor.card.title}. ${tailor.card.matchPct}% match.`);
  }, [screen, tailor]);

  const showEnding = !!tailor && (tailor.done || tailor.questions.length === 0 || finishedEarly);
  const askKey = !tailor ? null : showEnding ? "ending" : (tailor.questions[0]?.requirementId ?? null);

  // §7.3/§7.9: after each answer, focus the next question's first option and announce once
  // (discovery's firstControlRef + askKey precedent); on reaching the ending, focus its own heading
  // and announce the closed-gaps note instead (a different string from the heading — no true double).
  useEffect(() => {
    if (!askKey || !tailor) return;
    if (!askKeyInitRef.current) {
      askKeyInitRef.current = true;
      prevAskKeyRef.current = askKey;
      return; // the entry effect above owns focus for the very first paint
    }
    if (askKey === prevAskKeyRef.current) return;
    prevAskKeyRef.current = askKey;
    if (askKey === "ending") {
      endingHeadingRef.current?.focus();
      setLiveMessage(closedGapsLine(tailor.closedGaps));
    } else {
      firstControlRef.current?.focus();
      setLiveMessage(`${tailor.card.matchPct}% match. ${tailor.ledger.at(-1)?.text ?? ""}.`);
    }
  }, [askKey, tailor]);

  // F3: the one transition that unmounts the whole flow — nothing else moves focus off it, so it
  // silently drops to <body> without this. Mirrors the entry/askKey effects above: focus the heading,
  // announce once. `tailor` never changes again once here, so (unlike entry) no latch is needed —
  // this only ever fires on the `screen` transition itself.
  useEffect(() => {
    if (!tailor) return;
    if (screen === "applied") {
      appliedHeadingRef.current?.focus();
      setLiveMessage(appliedLine(tailor.card.title));
    } else if (screen === "saved") {
      savedHeadingRef.current?.focus();
      setLiveMessage(savedLine(tailor.card.title, tailor.card.matchPct));
    }
  }, [screen, tailor]);

  // Scrolls the row that just changed into view, then flashes it — never the other way round (the
  // prototype's rule). Runs after `tailor` actually re-renders with the row in its new list, so the
  // `[data-req]` lookup below always finds the element in its post-answer position.
  useEffect(() => {
    const id = pendingScrollRef.current;
    if (!id || !tailor) return;
    pendingScrollRef.current = null;
    const wrap = liveWrapRef.current;
    // #51: on desktop live-wrap is display:contents (zero-sized rect) — scroll the live-card
    // instead, which is the left column's scroll box there. On mobile live-wrap has a real box
    // and remains the scroller (card + CV share it).
    const scrollBox =
      wrap && wrap.getBoundingClientRect().width > 0 ? wrap : liveCardRef.current;
    const row = liveCardRef.current?.querySelector<HTMLElement>(`[data-req="${id}"]`) ?? null;
    const head = liveCardRef.current?.querySelector<HTMLElement>(".hd") ?? null;
    if (scrollBox && row) keepInView(scrollBox, row, (head?.offsetHeight ?? 0) + 14, reducedMotion);
    setLandedId(id);
    if (landedTimerRef.current) clearTimeout(landedTimerRef.current);
    landedTimerRef.current = setTimeout(() => setLandedId(null), ROW_SETTLE_MS);
  }, [tailor, reducedMotion]);

  // useCallback (not a plain function) so it can be named, honestly, in the Escape effect's deps
  // below (discovery's cancelCorrection precedent, discovery/page.tsx:338-345) — this repo has no
  // eslint to catch a silently-stale closure if it's ever left out.
  const closeDropConfirm = useCallback(() => {
    setDropConfirming(false);
    setDropError(null);
    setReturnDropFocus(true);
  }, []);

  useEffect(() => {
    if (!dropConfirming) return;
    dropItRef.current?.focus();
  }, [dropConfirming]);

  useEffect(() => {
    if (!returnDropFocus) return;
    dropTriggerRef.current?.focus();
    setReturnDropFocus(false);
  }, [returnDropFocus]);

  useEffect(() => {
    if (!dropConfirming) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeDropConfirm();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dropConfirming, closeDropConfirm]);

  // Tweens the ring + number from `from` to `to` (proto's rAF easing, job-card.prototype.html:387-402);
  // reduced motion (or a no-op change) snaps straight to the final value. §8: matchPct never
  // decreases — `to` is defensively floored at `from` in case a lower value ever arrived.
  function tweenScore(from: number, serverTo: number) {
    const to = Math.max(from, serverTo);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setScoreBumped(true);
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = setTimeout(() => setScoreBumped(false), SCORE_BUMP_MS);
    if (reducedMotion || from === to) {
      setDisplayPct(to);
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / SCORE_TWEEN_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplayPct(Math.round(from + (to - from) * eased));
      rafRef.current = k < 1 ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function answerQuestion(requirementId: string, answer: string) {
    if (answering || !tailor) return;
    setAnswering({ requirementId, answer });
    setAskError(null);
    const prevPct = tailor.card.matchPct; // the ledger's gold/quiet call is against the last *server* number
    const prevCard = tailor.card;
    try {
      const next = await answerTailor(requirementId, answer);
      const ledgerText = next.ledger.at(-1)?.text ?? "";
      setLedgerView({ key: `${requirementId}:${next.ledger.length}`, text: ledgerText, gold: next.card.matchPct > prevPct });
      pendingScrollRef.current = resolveLandedId(prevCard, next.card);
      // #17: unconditional, same as discovery — FactBadge's own guard makes a correction's zero
      // delta a no-op (this screen has no correction UI today, but the guard costs nothing to keep).
      setBadgeCount((c) => Math.max(c, next.factCount));
      if (flyFromRef.current) setFly({ rect: flyFromRef.current, label: answer });
      setTailor(next);
      // the tween's `from` is what's actually on screen right now, not the last server number — if a
      // prior tween is still mid-flight this keeps the new one visually continuous instead of jumping.
      tweenScore(displayPct, next.card.matchPct);
    } catch {
      setAskError(T7);
    } finally {
      setAnswering(null);
    }
  }

  function openDropConfirm() {
    setDropConfirming(true);
    setDropError(null);
  }

  async function onDropIt() {
    setDropBusy(true);
    setDropError(null);
    try {
      await dropTailor();
      router.push("/deck");
    } catch {
      setDropError(DROP_FAILED);
      setDropBusy(false);
    }
  }

  // Options-only: the API's tailorQuestion() unconditionally returns a Yes/No enumerable question
  // (apps/api/src/tailor.ts), so `options: []` is never produced — the free-text branch spec'd for it
  // was dead code no test could reach. One commit brings it back if a prose question ever ships.
  function renderQuestion(item: TailorQuestion) {
    const isAnswering = answering?.requirementId === item.requirementId;
    return (
      <>
        <p className="q" id="tailor-ask-q">
          {item.question}
        </p>
        <div className="opts" role="group" aria-labelledby="tailor-ask-q">
          {item.options.map((opt, i) => {
            const cls = !isAnswering ? "opt" : opt === answering?.answer ? "opt picked" : "opt dim";
            return (
              <button
                key={opt}
                ref={i === 0 ? setFirstControl : undefined}
                type="button"
                className={cls}
                disabled={isAnswering}
                onClick={() => answerQuestion(item.requirementId, opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {askError && (
          <p className="err" role="alert">
            {askError}
          </p>
        )}
      </>
    );
  }

  function renderExits(showDoneCta: boolean) {
    if (dropConfirming) {
      return (
        <div className="exits confirming" role="group" aria-labelledby="tailor-dropnote">
          <p id="tailor-dropnote" className="notice">
            {T10}
          </p>
          <div className="pair">
            <button type="button" onClick={closeDropConfirm} disabled={dropBusy}>
              {T12}
            </button>
            <button type="button" ref={dropItRef} onClick={onDropIt} disabled={dropBusy}>
              {T11}
            </button>
          </div>
          {dropError && (
            <p className="err" role="alert">
              {dropError}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="exits">
        {showDoneCta && (
          <button type="button" className="done-cta" onClick={() => setFinishedEarly(true)}>
            {T8}
          </button>
        )}
        <span className="spacer" />
        <button type="button" ref={dropTriggerRef} onClick={openDropConfirm}>
          {T9}
        </button>
      </div>
    );
  }

  return (
    <div
      className="jobdeck tailor"
      ref={rootRef}
      // #17: captures the answered option's rect for the badge's flying chip (M2 — a ref, not a
      // threaded DOMRect). Tailor has no keydown-triggered answer path (its free-text branch was
      // deleted, #23 F4), so click-only, unlike discovery's click+keydown pair.
      onClickCapture={(e) => {
        flyFromRef.current = (
          (e.target as HTMLElement).closest("button") ?? (e.target as HTMLElement)
        ).getBoundingClientRect();
      }}
    >
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {screen === "loading" && <div className="loadstate">{T1}</div>}

      {screen === "error" && (
        <div className="loadstate">
          <p role="alert">{T2}</p>
          <button type="button" onClick={load}>
            {T3}
          </button>
        </div>
      )}

      {screen === "applied" && tailor && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={appliedHeadingRef}>
            Ready to <em>send</em>
          </h1>
          <p>{appliedLine(tailor.card.title)}</p>
          <button type="button" onClick={() => router.push("/deck")}>
            {T21}
          </button>
        </div>
      )}

      {screen === "saved" && tailor && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={savedHeadingRef}>
            {T19}
          </h1>
          <p>{savedLine(tailor.card.title, tailor.card.matchPct)}</p>
          <button type="button" onClick={() => router.push("/deck")}>
            {T21}
          </button>
        </div>
      )}

      {screen === "flow" && tailor && (
        <>
          <div className="topbar">
            <span className="wordmark">JobCrush</span>
            <span className="spacer" />
            <FactBadge count={badgeCount} fly={fly} rootRef={rootRef} />
          </div>

          <div className="live-wrap" ref={liveWrapRef}>
            <div className="live-card" ref={liveCardRef}>
              <CardBody
                card={tailor.card}
                headingRef={cardHeadingRef}
                pct={displayPct}
                bumped={scoreBumped}
                landedId={landedId}
              />
            </div>
            <div className="t-cv-col">
              <div className="divider">{T6}</div>
              {renderCv(tailor.cvLines)}
            </div>
          </div>

          <div className="ask">
            {!showEnding ? (
              <>
                <p className="why">{T4}</p>
                {tailor.questions[0] && renderQuestion(tailor.questions[0])}
                <p
                  key={ledgerView?.key ?? "empty"}
                  className={["ledger", ledgerView && !ledgerView.gold ? "quiet" : "", ledgerView ? "show" : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {ledgerView?.text ?? ""}
                </p>
                {renderExits(true)}
              </>
            ) : (
              <>
                <div className="finish">
                  <h2 className="head" tabIndex={-1} ref={endingHeadingRef}>
                    {T13}
                  </h2>
                  <p className="note">{closedGapsLine(tailor.closedGaps)}</p>
                  <button type="button" className="btn-primary" onClick={() => setScreen("applied")}>
                    {T15}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setScreen("saved")}>
                    {T16}
                  </button>
                </div>
                {renderExits(false)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
