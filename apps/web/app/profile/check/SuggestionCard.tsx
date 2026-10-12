"use client";

// #378 — an add suggestion, answered in place (ADR-0018 clause 4): a drafted line shows inline in
// its job's list in a dashed gold frame with ⊕, "Suggestion · Add to <job>?" and — only on an
// OPTIONAL or INDUSTRY GUESS draft — an "Only if true" badge (one label for both, #370), then why it
// was offered and the CV words it came from. Three answers: Add it (the tick), Edit first (the
// person's wording, then the tick), No thanks (held, never proposed again; Undo for a few seconds).
// The draft's vague phrases (#343, ADR-0016 clause 4) stay tappable on the card, each opening its
// word choices. The vague-phrase and word-choice logic is the review page's own (DraftSheet /
// WordChoices), moved here; #386 deletes the old page.
import { useEffect, useRef, useState } from "react";
import type { ReviewLine, ReviewVague } from "../../../lib/api";

const C_SUGGESTION = "Suggestion";
const addTo = (job: string) => `Add to ${job}?`;
const C_ONLY_IF_TRUE = "Only if true";
const C_WHY = "Why:";
const C_FROM_CV = "From your CV";
const C_ADD = "Add it";
const C_EDIT_FIRST = "Edit first";
const C_NO_THANKS = "No thanks";
const C_CANCEL = "Cancel";
const C_EDIT_LABEL = "Edit before adding";
const C_GONE = "No thanks. I won't suggest it again.";
const C_UNDO = "Undo";
const askCopy = (family: string | null) => `${family ?? "Jobs like this"} jobs ask:`;
// The badge's short reason, by flag: a fact from elsewhere in the CV, or a guess about the job.
const WHY_OPTIONAL = "This comes from another part of your CV. Add it only if it is true for this job.";
const WHY_GUESS = "Jobs like this one often include it. Add it only if it was true for you.";
// Word choices (#343) — the review page's words.
const W_FROM_CV = "From your CV";
const W_TYPICAL = "Typical";
const W_MK_CV = "YOUR CV";
const W_MK_TYPICAL = "TYPICAL";
const W_NONE = "Your CV does not say.";
const W_OWN = "Or type your own";
const W_USE = "Use";
const specificCopy = (phrase: string) => `Make "${phrase}" specific:`;

const PLUS = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="8.25" />
    <path d="M6 10h8M10 6v8" />
  </svg>
);

/** #343: a vague phrase where the line reads it — as the model wrote it, or as one of its choices
 *  the person picked (`set`), so a pick can be changed again. Words the person typed, or edited the
 *  phrase away with, are theirs: nothing is marked there. */
interface Spot {
  vague: ReviewVague;
  words: string;
  set: boolean;
}
/** A draft's text cut round its spots, in reading order. */
function segments(text: string, vague: ReviewVague[]): Array<string | Spot> {
  const found = vague
    .flatMap((v) => {
      const spot = [v.phrase, ...v.options.map((o) => o.text)]
        .map((words, i) => ({ vague: v, words, set: i > 0, at: text.indexOf(words) }))
        .find((s) => s.at >= 0);
      return spot ? [spot] : [];
    })
    .sort((a, b) => a.at - b.at);
  const out: Array<string | Spot> = [];
  let at = 0;
  for (const { at: start, ...spot } of found) {
    if (start < at) continue; // overlaps the spot before it
    out.push(text.slice(at, start), spot);
    at = start + spot.words.length;
  }
  out.push(text.slice(at));
  return out.filter((s) => s !== "");
}

/** Where the suggestion's words came from: `From your CV: "<quote>"`. #368 passes the job the quote
 *  came from (`From your CV (BRED, Senior Project Manager): …`). */
export function DraftSource({ quote, job = null }: { quote: string; job?: string | null }) {
  return (
    <span>
      {job ? `${C_FROM_CV} (${job})` : C_FROM_CV}: <q>{quote}</q>
    </span>
  );
}

function whyOf(line: ReviewLine, family: string | null): string | null {
  const draft = line.draft!;
  if (draft.mustHave) return `${askCopy(family)} "${draft.mustHave}"`;
  if (draft.flags.includes("OPTIONAL")) return WHY_OPTIONAL;
  if (draft.flags.includes("INDUSTRY GUESS")) return WHY_GUESS;
  return null;
}

export interface SuggestionCardProps {
  line: ReviewLine;
  /** The job the suggestion would join, as the screen names it (the employer). */
  job: string;
  /** The job's family label, for the must-have's "<family> jobs ask:". */
  family: string | null;
  busy: boolean;
  onAdd: (id: string, text?: string) => void;
  onSaveText: (id: string, text: string) => void;
  onDismiss: (id: string) => void;
}

export function SuggestionCard({ line, job, family, busy, onAdd, onSaveText, onDismiss }: SuggestionCardProps) {
  const draft = line.draft!;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(line.text);
  const [openPhrase, setOpenPhrase] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const spots = segments(line.text, draft.vague);
  const open = spots.find((s): s is Spot => typeof s !== "string" && s.vague.phrase === openPhrase);
  const why = whyOf(line, family);
  const inputId = `check-draft-${line.id}`;
  return (
    <li className="sg">
      <span className="hd">
        {C_SUGGESTION} · {addTo(job)}
        {draft.flags.length > 0 && <b>{C_ONLY_IF_TRUE}</b>}
      </span>
      {editing ? (
        <form
          className="sgedit"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (t && !busy) onAdd(line.id, t === line.text ? undefined : t);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {C_EDIT_LABEL}
          </label>
          <textarea id={inputId} ref={inputRef} className="ed" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="row">
            <button type="submit" className="btn sm primary" disabled={busy || !text.trim()}>
              {C_ADD}
            </button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                setEditing(false);
                setText(line.text);
              }}
            >
              {C_CANCEL}
            </button>
          </span>
        </form>
      ) : (
        <>
          <span className="sline">
            <span className="mark plus">{PLUS}</span>
            <span className="stxt">
              {spots.map((s, i) =>
                typeof s === "string" ? (
                  s
                ) : (
                  <button
                    key={i}
                    type="button"
                    className={`ph${s.set ? " set" : ""}${openPhrase === s.vague.phrase ? " open" : ""}`}
                    aria-expanded={openPhrase === s.vague.phrase}
                    onClick={() => setOpenPhrase(openPhrase === s.vague.phrase ? null : s.vague.phrase)}
                  >
                    {s.words}
                  </button>
                ),
              )}
            </span>
          </span>
          {open && (
            <WordChoices
              key={open.vague.phrase}
              vague={open.vague}
              busy={busy}
              onUse={(words) => {
                setOpenPhrase(null);
                const next = line.text.replace(open.words, () => words);
                setText(next);
                onSaveText(line.id, next);
              }}
            />
          )}
          <span className="meta">
            {why && (
              <span>
                {C_WHY} {why}
              </span>
            )}
            {draft.quote && <DraftSource quote={draft.quote} />}
          </span>
          <span className="row">
            <button type="button" className="btn sm" disabled={busy} onClick={() => onAdd(line.id)}>
              {C_ADD}
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => {
                setText(line.text);
                setEditing(true);
              }}
            >
              {C_EDIT_FIRST}
            </button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => onDismiss(line.id)}>
              {C_NO_THANKS}
            </button>
          </span>
        </>
      )}
    </li>
  );
}

/** What a just-dismissed draft leaves for a few seconds: the promise, and Undo. */
export function DismissedRow({ busy, onUndo }: { busy: boolean; onUndo: () => void }) {
  return (
    <li className="gone">
      {C_GONE}
      <button type="button" className="linkbtn" disabled={busy} onClick={onUndo}>
        {C_UNDO}
      </button>
    </li>
  );
}

// #343: one vague phrase's choices — the CV's first, then typical, each tagged — and the person's
// own words beside them.
function WordChoices({ vague, busy, onUse }: { vague: ReviewVague; busy: boolean; onUse: (words: string) => void }) {
  const [own, setOwn] = useState("");
  const cv = vague.options.filter((o) => o.from === "CV");
  const typical = vague.options.filter((o) => o.from === "TYPICAL");
  const chip = (o: ReviewVague["options"][number]) => (
    <button key={`${o.from}:${o.text}`} type="button" className={`chip ${o.from === "CV" ? "cv" : "typ"}`} disabled={busy} onClick={() => onUse(o.text)}>
      <span className="mk">{o.from === "CV" ? W_MK_CV : W_MK_TYPICAL}</span>
      <span className="t">
        {o.text}
        {o.quote && <small>&quot;{o.quote}&quot;</small>}
      </span>
    </button>
  );
  return (
    <div className="wordchoices" role="group" aria-label={specificCopy(vague.phrase)}>
      <p className="ch-h">{specificCopy(vague.phrase)}</p>
      <p className="ch-g">{W_FROM_CV}</p>
      {cv.length ? cv.map(chip) : <p className="ch-none">{W_NONE}</p>}
      {typical.length > 0 && (
        <>
          <p className="ch-g">{W_TYPICAL}</p>
          {typical.map(chip)}
        </>
      )}
      <form
        className="own"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim() && !busy) onUse(own.trim());
        }}
      >
        <input aria-label={W_OWN} placeholder={W_OWN} value={own} onChange={(e) => setOwn(e.target.value)} />
        <button type="submit" className="btn sm primary" disabled={busy || !own.trim()}>
          {W_USE}
        </button>
      </form>
    </div>
  );
}
