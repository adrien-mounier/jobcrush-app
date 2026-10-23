"use client";

// #417 (ADR-0020 clauses 3-4; the approved prototype on prototype/stretch-suggestions-408): the
// stretch suggestions beside the finished draft. ONE card at a time — the open suggestion — with
// the requirement it answers, why it fired, the line in and the line out, and what to say if
// asked. On a computer the card sits in the rail and the swap previews IN PLACE on the draft (the
// frame is re-read with `?open=`, page.tsx owns that); on a phone (under 960px) the card carries a
// clip of the swap itself, the answers stack, and "Skip the rest" closes the run. Closed (Esc, Skip
// the rest, every one answered) the rail shows the list with each one's result.
//
// Answers: "No" (this job only, #417) and "Use for this job" (#418: the gold primary, key U) are
// built here; "It's true" (#419) and "Edit wording" (#420) land in `.acts` below — the layout
// leaves them their rows. Closed, the rail is the "Ready to send" summary: each answer with its
// own Undo, and "Be ready to explain" with each used line and what to say (the prototype's words).
// Every value is server-composed (the suggestion records beside the draft); nothing is re-derived.
import type { RefObject } from "react";
import type { StretchSuggestion, StretchView, TailorRequirement } from "../../lib/api";

/** #418: what the rail shows about the step — the server's view, or "running" while the draft is
 *  already on the page and the step is still looking (draft.tsx reports it off the job stream). */
export type StretchRailView = StretchView | { status: "running" } | undefined;

const K1 = "optional";
const K2 = "On your CV it replaces the line struck out on the page.";
const K3 = "It joins your skills line. Nothing leaves your CV.";
const K4 = "If they ask";
const K5 = "No";
const K6 = "Previous";
const K7 = "Later";
const K8 = "Skip the rest";
const K9 = "Ready to send";
const K10 = "Not answered, left out";
const K11 = "Not for this job";
const K12 = "Skills";
// #418: the gold primary and the summary's words (the approved prototype).
const K13 = "Use for this job";
const K14 = "Used for this job";
const K15 = "Undo";
const K16 = "Answer";
const K17 = "Be ready to explain";
const K18 = "No suggestions used.";
// The draft is written; one more step looks for stretches beside it (shown in the rail, the draft
// already on the page — ADR-0020: the draft is the first thing the person sees).
const K19 = "Your CV is written. Looking for ways to stretch it for this job…";
// A failed step is told as what it is — never as "nothing to suggest", and naming nothing of ours.
const F1 = "We could not look for ways to stretch this CV just now. Your CV is complete without them.";
const F2 = "Look again";

export const STRETCH_COPY = { K2, K3, F1, F2, K19 };

const RESULT: Record<StretchSuggestion["state"], string> = {
  pending: K10,
  declined: K11,
  approved: K14, // #419's every-job approval names its own scope
};

export interface StretchCardsProps {
  view: StretchRailView;
  requirements: TailorRequirement[];
  openId: string | null;
  onOpen: (id: string) => void;
  onAnswer: (id: string, answer: "no" | "use") => void;
  /** #418: withdraws an answer from the summary — the suggestion is pending again and reopens. */
  onUndo: (id: string) => void;
  onSkipRest: () => void;
  onLookAgain: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  answering: boolean;
}

/** The pending suggestions, in list order — the one open, and the way J/K/N move. */
export function pendingOf(view: StretchRailView): StretchSuggestion[] {
  return view?.status === "ran" ? view.suggestions.filter((s) => s.state === "pending") : [];
}

/** The next pending suggestion after `fromId` (wrapping), or null when none is left. */
export function nextPending(view: StretchRailView, fromId: string | null, direction: 1 | -1 = 1): string | null {
  const pending = pendingOf(view);
  if (pending.length === 0) return null;
  const i = pending.findIndex((s) => s.id === fromId);
  if (i === -1) return direction === 1 ? pending[0]!.id : pending[pending.length - 1]!.id;
  return pending[(i + direction + pending.length) % pending.length]!.id;
}

export function StretchCards({ view, requirements, openId, onOpen, onAnswer, onUndo, onSkipRest, onLookAgain, headingRef, answering }: StretchCardsProps) {
  if (!view) return null; // the step did not run: an honest absence, nothing said
  if (view.status === "running") {
    return (
      <section className="stretch" role="status">
        <p className="notice">{K19}</p>
      </section>
    );
  }
  if (view.status === "failed") {
    return (
      <section className="stretch" role="status">
        <p className="notice">{F1}</p>
        <button type="button" className="link" onClick={onLookAgain}>
          {F2}
        </button>
      </section>
    );
  }
  const all = view.suggestions;
  if (all.length === 0) return null; // ran, found none: nothing to put to the person
  const text = (s: StretchSuggestion) => requirements.find((r) => r.id === s.requirementId)?.text ?? s.requirementId;
  const open = all.find((s) => s.id === openId && s.state === "pending");

  if (open) {
    const n = all.indexOf(open) + 1;
    return (
      <section className="stretch-card" aria-label={`Suggestion ${n} of ${all.length}`}>
        <p className="eyebrow">
          {n} of {all.length} · {K1}
        </p>
        <h2 className="h" tabIndex={-1} ref={headingRef}>
          <span className="num" aria-hidden="true">
            {n}
          </span>
          {text(open)}
        </h2>
        <p className="swhy">{open.why}</p>
        {/* The swap, in the card — a phone has no in-place preview (the frame is above the rail). */}
        <div className="clip">
          {open.lineOut ? (
            <>
              <del>{open.lineOut}</del>
              <ins>{open.claimText}</ins>
            </>
          ) : (
            <>
              <span className="where">{K12}</span>
              <ins>{open.claimText}</ins>
            </>
          )}
        </div>
        <p className="swap">{open.lineOut ? K2 : K3}</p>
        <div className="ifasked">
          <b>{K4}</b>
          {open.interviewNarrative}
        </div>
        <div className="acts">
          {/* The gold primary (ADR-0020 clause 4: this job only). #419's "It's true" takes the row
              between — never the same row as Use; #420's "Edit wording" sits beside No. */}
          <button type="button" className="b gold" disabled={answering} onClick={() => onAnswer(open.id, "use")}>
            {K13} <kbd aria-hidden="true">U</kbd>
          </button>
          <button type="button" className="b quiet" disabled={answering} onClick={() => onAnswer(open.id, "no")}>
            {K5} <kbd aria-hidden="true">N</kbd>
          </button>
        </div>
        <div className="nav">
          <button type="button" className="link" onClick={() => onOpen(nextPending(view, open.id, -1)!)}>
            {K6}
          </button>
          <button type="button" className="link" onClick={() => onOpen(nextPending(view, open.id, 1)!)}>
            {K7}
          </button>
        </div>
        <button type="button" className="link skip" onClick={onSkipRest}>
          {K8}
        </button>
      </section>
    );
  }

  // Closed: "Ready to send" — each suggestion with its answer and its own Undo (an unanswered one
  // with the way back in), then what to be ready to explain for every used line.
  const pending = pendingOf(view).length;
  const used = all.filter((s) => s.state === "approved");
  const declined = all.filter((s) => s.state === "declined").length;
  const parts = [used.length > 0 && `${used.length} used for this job`, declined > 0 && `${declined} not for this job`, pending > 0 && `${pending} left out`].filter(Boolean);
  return (
    <section className="stretch" aria-label={K9}>
      <h2 className="h">{K9}</h2>
      <p className="small">{parts.length > 0 ? parts.join(" · ") : K18}</p>
      <ul className="slist">
        {all.map((s) => (
          <li key={s.id}>
            <span className="t">{text(s)}</span>
            <span className={`result${s.state === "approved" ? " r-use" : ""}`}>
              <span className="s">{RESULT[s.state]}</span>
              {s.state === "pending" ? (
                <button type="button" className="link" disabled={answering} onClick={() => onOpen(s.id)}>
                  {K16}
                </button>
              ) : (
                <button type="button" className="link" disabled={answering} onClick={() => onUndo(s.id)}>
                  {K15}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {used.length > 0 && (
        <>
          <h3 className="h">{K17}</h3>
          <ul className="explain">
            {used.map((s) => (
              <li key={s.id}>
                <q>{s.claimText}</q>
                {s.interviewNarrative}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
