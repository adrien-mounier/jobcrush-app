"use client";

// Shared card renderer — extracted from deck/page.tsx (screen 2a/2b) so /tailor (#23) can render
// the identical card anatomy instead of a second copy. Pure extraction: CardBody renders the same
// markup deck/page.tsx always has; the only additions are `aria-hidden` on the mark glyphs (#23's
// design spec §3: "add it in the extracted CardBody — it improves /deck too") and a `data-req` hook
// on each row (harmless to /deck, and what #23's live-card re-score flash needs to find the row it
// just changed).
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { JobCard } from "../lib/api";

const H1 = "Where you fit";
const H2 = "Where you don't — yet";
const H3 = "Asked and closed";
// #162 AC6: a bar we could not test is not a bar the person failed — said plainly. The note claims
// only what is true: the years total this bar is measured against does not exist yet, and adding
// the dates underneath is what changes it.
const H4 = "Not tested";
const NOT_TESTED_NOTE =
  "I don't have your dated work history yet, so I couldn't measure you against this one. Add your dates and it can change.";
const A1 = "Read the ad in full";

// #117 the pending card's copy (design-117 §5). P3 ("Not scored yet") is retired by the §11
// addendum — it collided with `unscored`'s own "Not scored": the give-up strip now keeps label P1
// unconditionally ("it *is* still scoring, just slowly") and carries the difference in P4 + the
// retry button, so "Not scored" is unambiguously the `unscored` state below.
const P1 = "Still scoring";
const P2 = "I'm checking this one against your facts. You'll see its number here in a few seconds.";
const P4 = "Scoring this one is taking longer than usual.";
const P5 = "Try again";
const P6 = "Checking…";
const P7 = "Not scored yet";

// #117b (addendum §11) the `unscored` card's copy — a job whose score we deliberately haven't
// bought yet, not one that's in flight. U1/U3 read as "Not scored" (no "yet") on purpose: nothing
// is coming unless the visitor asks for it.
const U1 = "Not scored";
const U2 = "I scored the closest matches first. Want this one? I'll score it against your facts.";
const U3 = "Not scored";

// #117c (addendum §12) qualifying an `estimated` score — a real number from the old deterministic
// scorer, not from judging. One quiet word, never a sentence: it names what the number is without
// confessing why (no "judging failed", no tooltip). E2 is a template, not a plain string — the
// aria-label needs the number in it — so it isn't a constant here.
const E1 = "Estimate";

function matchQuality(pct: number): { label: string; grade: "strong" | "partial" | "weak" } {
  if (pct >= 70) return { label: "Strong", grade: "strong" };
  if (pct >= 50) return { label: "Partial", grade: "partial" };
  return { label: "Weak", grade: "weak" };
}

function MatchBreakdown({ card, pct }: { card: JobCard; pct?: number }) {
  // #117: null on a pending card — nothing to render yet. This narrows `card` itself (breakdown is
  // `MatchBreakdown` on one union member, `null` on the other), so `card.matchPct` below is a plain
  // number, not `number | null` — no `!`/`as` needed.
  if (!card.breakdown) return null;
  const { essential, desirable } = card.breakdown;
  const met = essential.met + desirable.met;
  const total = essential.total + desirable.total;
  if (total === 0) return null;
  const q = matchQuality(pct ?? card.matchPct);
  return (
    <section className="breakdown" aria-labelledby="match-breakdown-title">
      <p id="match-breakdown-title" className="bd-title">
        Match breakdown
      </p>
      <dl className="bd-grid">
        <div className="bd-cell">
          <dt className="bd-l">Requirements met</dt>
          <dd className="bd-n" aria-label={`${met} ${total} requirements met`}>
            {met}/{total}
          </dd>
        </div>
        <div className="bd-cell">
          <dt className="bd-l">Essential met</dt>
          <dd
            className="bd-n"
            aria-label={`${essential.met} ${essential.total} essential requirements met`}
          >
            {essential.met}/{essential.total}
          </dd>
        </div>
        <div className="bd-cell">
          <dt className="bd-l">Desirable met</dt>
          <dd
            className="bd-n"
            aria-label={`${desirable.met} ${desirable.total} desirable requirements met`}
          >
            {desirable.met}/{desirable.total}
          </dd>
        </div>
        <div className="bd-cell">
          <dt className="bd-l">Match quality</dt>
          <dd className={`bd-pill ${q.grade}`}>{q.label}</dd>
        </div>
      </dl>
    </section>
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

export function ScoreRing({
  pct,
  bumped,
  estimated,
}: {
  pct: number;
  bumped?: boolean;
  estimated?: boolean; // #117c: the ring itself is untouched — this only changes the accessible name
}) {
  const r = 28;
  const c = 2 * Math.PI * r;
  // #117c §12.4: the qualifier rides in the number's own accessible name (E2) rather than a
  // separate announcement — spoken every time the number is, including after a `bumped` re-score,
  // with no extra machinery. The visible ".est" caption below is aria-hidden so it isn't read twice.
  const label = estimated ? `${pct}% match, estimated` : `${pct}% match`;
  return (
    <div className={`score lg${bumped ? " bumped" : ""}`} role="img" aria-label={label}>
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

// #117 the pending ring — same 64x64 footprint as ScoreRing, so the header never reflows when the
// number lands. The em dash means "no value" (never render a digit, never 0); the moving arc means
// "working"; on give-up the arc is dropped and only the dash + track remain (design-117 §2).
export function PendingRing({ gaveUp }: { gaveUp?: boolean }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className={`score lg pending${gaveUp ? " gaveup" : ""}`} role="img" aria-label={P7}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="bg" cx={32} cy={32} r={r} />
        {!gaveUp && (
          <circle className="spin" cx={32} cy={32} r={r} strokeDasharray={`${c * 0.22} ${c}`} />
        )}
      </svg>
      <span className="n dash" aria-hidden="true">
        —
      </span>
    </div>
  );
}

// #117 the notice strip that replaces the highlight bubble on a pending card — same element, same
// box metrics, so the swap on landing cannot shift the layout above it (design-117 §3).
function PendingBubble({
  gaveUp,
  retrying,
  onRetry,
}: {
  gaveUp?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="bubble pending">
      <p className="pend-l">{P1}</p>
      <p>{gaveUp ? P4 : P2}</p>
      {gaveUp && (
        <button type="button" className="pend-retry" disabled={retrying} onClick={onRetry}>
          {retrying ? P6 : P5}
        </button>
      )}
    </div>
  );
}

// #117b the unscored ring — same 64x64 slot, completely static: no spinner, no gold-dim. Motion is
// now reserved as the deck's "in flight" signal, so withholding it here is what makes `unscored`
// read as settled rather than stalled (design §11.2/§11.5). `+` = "value available if you ask".
export function UnscoredRing() {
  const r = 28;
  return (
    <div className="score lg unscored" role="img" aria-label={U3}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="bg" cx={32} cy={32} r={r} />
      </svg>
      <span className="n plus" aria-hidden="true">
        +
      </span>
    </div>
  );
}

// #117b the unscored strip — same neutral box as PendingBubble, but no retry button, no spinner, no
// promise: nothing is in flight, so there is nothing to try again (design §11.3).
function UnscoredBubble() {
  return (
    <div className="bubble unscored">
      <p className="pend-l">{U1}</p>
      <p>{U2}</p>
    </div>
  );
}

function rowClass(kind: "fit" | "open" | "settled", id: string, landedId?: string | null): string {
  return id === landedId ? `row ${kind} landed` : `row ${kind}`;
}

// The card anatomy, as #306 leaves it: title -> meta -> ring, then what the card says about the job
// ITSELF — how old it is, where to apply, the advert in full — and only then what the machine has to
// say about the person: the highlight bubble, the three ranked lists, the breakdown.
//
// #306 change 3 moved the ad up out of the last slot, on BOTH screens: it had been sitting under
// everything the machine had to say about him, and checking our reading against the source is
// something he does BEFORE reading our opinion of him, not after (#300). No restyling — `details.ad`'s
// existing top hairline read as a footer separator at the bottom and reads as the header's closing
// rule here.
//
// Callers own the outer card wrapper (deck's `.jobcard > .jcbody`, tailor's `.live-card`) — their CSS
// scoping differs, this doesn't.
export function CardBody({
  card,
  headingRef,
  pct,
  bumped,
  landedId,
  gaveUp,
  retrying,
  onRetry,
  applyRow,
}: {
  card: JobCard;
  headingRef: RefObject<HTMLHeadingElement | null>;
  pct?: number; // #23: the live re-score tween value; defaults to the card's own matchPct
  bumped?: boolean; // #23: true for ~470ms right after an answer lands
  landedId?: string | null; // #23: the row id to flash gold-then-transparent
  // #117: only meaningful while card.scored === "pending" — deck/page.tsx's poll state, threaded
  // through unused by /tailor (whose card is always already scored, see lib/api.ts's TailorState).
  gaveUp?: boolean; // the poll exhausted its attempts while this card was still pending
  retrying?: boolean; // a manual retry fetch (onRetry) is in flight
  onRetry?: () => void; // required whenever gaveUp can be true
  /** #306 change 1 — the apply row, as a SLOT rather than a flag. The job's own screen fills it; the
   *  deck passes nothing and therefore cannot grow a link inside a card that is swiped (#300). A
   *  boolean would put the decision in this file, where a later caller could get it the wrong way
   *  round; a slot puts it in the one screen that is allowed to have it. */
  applyRow?: ReactNode;
}) {
  const metaLine1 = [card.company, card.place].filter(Boolean).join(" · ");
  const metaLine2 = [card.salary, card.pattern].filter(Boolean).join(" · ");
  // #117/#117b: fit/dontYet read as claims the judgement hasn't made — hidden for both states with
  // no score, not just `pending`.
  const isScored = card.scored === "judged" || card.scored === "estimated";
  // #117b (design §11.6): unscored starts unfolded — it's the only substantive content that card
  // will ever have — and then the visitor's own toggle sticks; nothing may force it shut again.
  // Initial-only by design: this must NOT depend on `card.scored` on every render, or a card that
  // later resolves to judged/estimated (pending -> landed) would snap shut under the visitor.
  const [adOpen, setAdOpen] = useState(card.scored === "unscored");
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
        {card.scored === "pending" ? (
          <PendingRing gaveUp={gaveUp} />
        ) : card.scored === "unscored" ? (
          <UnscoredRing />
        ) : (
          // #117c (addendum §12): shown on BOTH screens, unconditionally — it lives here in the
          // shared CardBody specifically so suppressing it on the deck would cost a prop to show
          // less honesty (§12.3). `.scoreslot` has one child on a judged card, so the extra wrapper
          // is a zero-visual no-op there; `.hd`'s flex role that used to sit on `.score` moves to
          // this wrapper (deck.css §12.1) only for this branch — pending/unscored keep `.score`
          // as `.hd`'s direct child, unchanged.
          <div className="scoreslot">
            <ScoreRing pct={pct ?? card.matchPct} bumped={bumped} estimated={card.scored === "estimated"} />
            {card.scored === "estimated" && (
              <p className="est" aria-hidden="true">
                {E1}
              </p>
            )}
          </div>
        )}
      </div>

      {/* #305 (#294 c3) — the ageing line on a job HE BROUGHT: from day seven, how long ago he pasted
          it and that we cannot check whether it is still open, or the closing date the employer stated
          if the advert stated one. Server-composed (broughtJobs.ts), so this renders and decides
          nothing — which is what keeps the deck card and the job's own screen saying the same thing.
          Absent on every job we found, and on a pasted one through its silent first week. Placed
          directly under the header because it is a fact about the job he needs BEFORE the score, not
          a footnote under it. */}
      {card.ageing && <p className="ageing">{card.ageing}</p>}

      {/* Under the header's facts rather than above them: the ageing line is the one thing on this
          card we cannot verify, and he should read "we cannot check whether this is still open"
          BEFORE the link that takes him out of the app. */}
      {applyRow}

      {/* #117b design §11.6: controlled only so `unscored` can start open — a judged/estimated/
          pending card gets adOpen=false at mount, same as the old uncontrolled default, and the
          visitor's own toggle then drives it exactly as before. shouldIgnoreSwipeStart already
          excludes `details.ad[open]` from starting a swipe (deck/page.tsx), unchanged. */}
      <details className="ad" open={adOpen} onToggle={(e) => setAdOpen(e.currentTarget.open)}>
        <summary>{A1}</summary>
        <p>{card.adExcerpt}</p>
      </details>

      {card.scored === "pending" ? (
        <PendingBubble gaveUp={gaveUp} retrying={retrying} onRetry={onRetry} />
      ) : card.scored === "unscored" ? (
        <UnscoredBubble />
      ) : (
        <div className="bubble">
          <p>
            {card.bubble.hit} <span className="gap">{card.bubble.open}</span>
          </p>
        </div>
      )}

      <div className="flat">
        {/* #117/#117b: omitted entirely on a pending or unscored card (design §1's render map) —
            not rendered even if the server ever populated `fit` before judging, since "where you
            fit" reads as a claim the judgement hasn't made yet. */}
        {isScored && card.fit.length > 0 && (
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
        {/* Already server-ranked (uncoveredRequirements) — render in array order, no re-rank.
            #117/#117b: dontYet is always [] while pending/unscored (the contract), so this is
            belt-and-suspenders with the fit guard above, kept for the same reason. */}
        {isScored && card.dontYet.length > 0 && (
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
        {/* #162 AC6: an untested bar, named. Present only when the years total could not be worked
            out at all (no readable work history) — a confident zero is a real number and scores
            normally, so it never lands here. */}
        {(card.notTested?.length ?? 0) > 0 && (
          <>
            <h3>{H4}</h3>
            {card.notTested!.map((r) => (
              <div className={rowClass("settled", r.id, landedId)} key={r.id} data-req={r.id}>
                <span className="mk" aria-hidden="true">
                  –
                </span>
                <span>{r.requirement}</span>
              </div>
            ))}
            <p className="untested-note">{NOT_TESTED_NOTE}</p>
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
    </>
  );
}
