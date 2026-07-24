"use client";

// #19 the reveal + the job card (screen 2a): a full-bleed reveal ("N jobs just matched you") that
// opens onto a best-first card deck. This is the ONBOARDING job deck (`/deck` index) — unrelated to
// the S2 claim-confirm deck at `/deck/[jobId]`; different route segment, different data, different
// CSS scope (`.jobdeck`, not the global classes `[jobId]/page.tsx` uses).
//
// Renders GET /onboarding/cards as-is (design-19-reveal-card.md's pinned override of its own §1
// DeckJob guess): matchPct, bubble.hit/bubble.open, and the fit/dontYet/askedClosed lists' rank
// order are all composed server-side (matchtick.ts) — nothing here re-derives them.
//
// Scope = 2a only: the reveal, the deck opening on the top (best) card, the card's body anatomy, the
// three marks (gold check / grey ? / dim dot — never a cross). Swipe, accept/reject, advancing
// through the deck, the deck-runs-out loopback, and the live re-score tween are screen 2b.
import { useCallback, useEffect, useRef, useState } from "react";
import "../deck.css";
import { ensureSession, getCards, type JobCard } from "../../lib/api";

type Screen = "loading" | "error" | "empty" | "reveal" | "deck";

const L1 = "Lining up your jobs…";
const E1 = "Couldn't line up your jobs.";
const Z1 = "No matches yet.";
const Z2 = "Answer a few more questions and I'll widen the net.";
const H1 = "Where you fit";
const H2 = "Where you don't — yet";
const H3 = "Asked and closed";
const A1 = "Read the ad in full";

function revealText(n: number): string {
  return n === 1 ? "1 job just matched you" : `${n} jobs just matched you`;
}

export default function DeckPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [cards, setCards] = useState<JobCard[]>([]);
  const [liveMessage, setLiveMessage] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureSession();
      const res = await getCards();
      // AC2: the server already sorts by matchPct desc — re-sort defensively (pinned contract note).
      const sorted = [...res.cards].sort((a, b) => b.matchPct - a.matchPct);
      setCards(sorted);
      setScreen(sorted.length === 0 ? "empty" : "reveal");
    } catch {
      // E1 is fixed copy (design §2's copy table), not the raw fetch error.
      setScreen("error");
    }
  }, []);

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

  const n = cards.length;

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
          structural, not a blur hiding content. */}
      {screen === "reveal" && (
        <div className="curtain">
          <div>
            <div className="burst" aria-hidden="true">
              🂠
            </div>
            <h1 className="big" tabIndex={-1} ref={headingRef}>
              {n} {n === 1 ? "job" : "jobs"} just <em>matched you</em>
            </h1>
            <button type="button" className="go" onClick={() => setScreen("deck")}>
              See them
            </button>
          </div>
        </div>
      )}

      {screen === "deck" && (
        <>
          <div className="topbar">
            <span className="wordmark">JobCrush</span>
            <span className="spacer" />
          </div>
          <p className="deckcount">1 of {n} matched today</p>
          <div className="deck">
            <JobCardView card={cards[0]!} />
          </div>
        </>
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

// The card anatomy (AC4): title -> meta -> ring, then the highlight bubble, then the three
// ranked lists, then the ad folded shut last. Body-only on 2a (no footer/swipe — screen 2b).
function JobCardView({ card }: { card: JobCard }) {
  const metaLine1 = [card.company, card.place].filter(Boolean).join(" · ");
  const metaLine2 = [card.salary, card.pattern].filter(Boolean).join(" · ");
  return (
    <div className="jobcard">
      <div className="jcbody">
        <div className="hd">
          <div className="t">
            <h2>{card.title}</h2>
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
    </div>
  );
}
