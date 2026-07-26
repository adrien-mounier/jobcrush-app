"use client";

// Shared card renderer — extracted from deck/page.tsx (screen 2a/2b) so /tailor (#23) can render
// the identical card anatomy instead of a second copy. Pure extraction: CardBody renders the same
// markup deck/page.tsx always has; the only additions are `aria-hidden` on the mark glyphs (#23's
// design spec §3: "add it in the extracted CardBody — it improves /deck too") and a `data-req` hook
// on each row (harmless to /deck, and what #23's live-card re-score flash needs to find the row it
// just changed).
import { useEffect, useState, type RefObject } from "react";
import type { JobCard } from "../lib/api";

const H1 = "Where you fit";
const H2 = "Where you don't — yet";
const H3 = "Asked and closed";
const A1 = "Read the ad in full";

// #51 reduced match breakdown (client-only): the met/total count is computable from the three lists
// the card already carries; the quality label is a threshold read off matchPct. The full essential/
// desirable split needs a versioned JobCard contract change + matchtick work (filed as #52, deferred
// to S3's real E5 scoring engine), so this is intentionally the two-cell reduced form.
function matchQuality(pct: number): { label: string; grade: "strong" | "partial" | "weak" } {
  if (pct >= 70) return { label: "Strong", grade: "strong" };
  if (pct >= 50) return { label: "Partial", grade: "partial" };
  return { label: "Weak", grade: "weak" };
}

// #51 the reduced breakdown grid inside the card — two cells: requirements met (X/Y, computed from
// the three lists) and match quality (a threshold label off the score). Rendered for both /deck and
// /tailor since CardBody is shared. Skipped entirely when the ad has no requirements yet (0/0 reads
// as broken, and that state shouldn't occur on a scored card).
function MatchBreakdown({ card, pct }: { card: JobCard; pct?: number }) {
  const met = card.fit.length;
  const total = met + card.dontYet.length + card.askedClosed.length;
  if (total === 0) return null;
  const q = matchQuality(pct ?? card.matchPct);
  return (
    <div className="breakdown" aria-label="Match breakdown">
      <p className="bd-title">Match breakdown</p>
      <div className="bd-grid">
        <div className="bd-cell">
          <span className="bd-n">
            {met}/{total}
          </span>
          <span className="bd-l">Requirements met</span>
        </div>
        <div className="bd-cell">
          <span className={`bd-pill ${q.grade}`}>{q.label}</span>
          <span className="bd-l">Match quality</span>
        </div>
      </div>
    </div>
  );
}

export function useReducedMotion() {
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

export function ScoreRing({ pct, bumped }: { pct: number; bumped?: boolean }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className={`score lg${bumped ? " bumped" : ""}`} role="img" aria-label={`${pct}% match`}>
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

function rowClass(kind: "fit" | "open" | "settled", id: string, landedId?: string | null): string {
  return id === landedId ? `row ${kind} landed` : `row ${kind}`;
}

// The card anatomy (deck AC4): title -> meta -> ring, then the highlight bubble, then the three
// ranked lists, then the ad folded shut last. Callers own the outer card wrapper (deck's
// `.jobcard > .jcbody`, tailor's `.live-card`) — their CSS scoping differs, this doesn't.
export function CardBody({
  card,
  headingRef,
  pct,
  bumped,
  landedId,
}: {
  card: JobCard;
  headingRef: RefObject<HTMLHeadingElement | null>;
  pct?: number; // #23: the live re-score tween value; defaults to the card's own matchPct
  bumped?: boolean; // #23: true for ~470ms right after an answer lands
  landedId?: string | null; // #23: the row id to flash gold-then-transparent
}) {
  const metaLine1 = [card.company, card.place].filter(Boolean).join(" · ");
  const metaLine2 = [card.salary, card.pattern].filter(Boolean).join(" · ");
  return (
    <>
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
        <ScoreRing pct={pct ?? card.matchPct} bumped={bumped} />
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
              <div className={rowClass("fit", f.id, landedId)} key={f.id} data-req={f.id}>
                <span className="mk" aria-hidden="true">
                  ✓
                </span>
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
              <div className={rowClass("open", r.id, landedId)} key={r.id} data-req={r.id}>
                <span className="mk" aria-hidden="true">
                  ?
                </span>
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
              <div className={rowClass("settled", f.id, landedId)} key={f.id} data-req={f.id}>
                <span className="mk" aria-hidden="true">
                  ·
                </span>
                <span>{f.text}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <MatchBreakdown card={card} pct={pct} />

      <details className="ad">
        <summary>{A1}</summary>
        <p>{card.adExcerpt}</p>
      </details>
    </>
  );
}
