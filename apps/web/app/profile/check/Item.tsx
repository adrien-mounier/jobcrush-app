"use client";

// #377 — an item of the profile in check mode (ADR-0018 clause 2): plain text with two quiet
// actions that show on hover, focus or a tap — ✎ (when `onEdit` is wired), which edits its words in
// place (#379), and ⊖, which removes it. What was removed stays one tap away in the tray at the end of its section, with Put
// back. No tick box anywhere; nothing on screen says "kept", "ticked" or "reviewed".
// #378: an added suggestion is an ordinary item wearing the "new" tag, and lands with a gold rule
// that fades (the `landed` cue, once, never under reduced motion).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReviewLine } from "../../../lib/api";

const C_EDIT = "Edit";
const C_SAVE = "Save";
const C_CANCEL = "Cancel";
const C_REMOVE = "Remove";
const C_PUT_BACK = "Put back";
const C_NEW = "new";
const C_REMOVE_HD = "Suggestion · Remove this?";
const C_TO_REMOVE = "To remove: ";
const C_WHY = "Why: ";
const C_REMOVE_IT = "Remove it";
const C_KEEP_IT = "Keep it";
const removedCopy = (n: number, open: boolean) => `${n} removed · ${open ? "Hide" : "Show"}`;
/** #371/#383: a line the review moved wears where it came from ("Moved from your summary"). */
const movedCopy = (from: string) => `Moved from ${from}`;

const PEN = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2z" />
  </svg>
);
const MINUS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M5.3 8h5.4" />
  </svg>
);

// #384: the review's spelling fix on an item (ADR-0016 clause 2). It stays applied without asking;
// a quiet tag opens the original beside the corrected words, with Undo — and "Use the fix" after an
// undo. Never something to answer: nothing here holds the footer button.
const C_FIXED = "Fixed";
const C_FIX_UNDONE = "Fix undone";
const C_UNDO = "Undo";
const C_USE_FIX = "Use the fix";

/** The words a fix changed: the span between the longest common prefix and suffix of the two
 *  texts, widened to whole words — so a dropped letter ("accross" → "across") marks the word, not
 *  an empty span. Moved from the review page (#386 deletes that copy). */
function changed(a: string, b: string): { from: string; to: string } {
  const ws = (c: string | undefined) => c === undefined || /\s/.test(c);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  let aEnd = a.length - end;
  let bEnd = b.length - end;
  while (start > 0 && !ws(b[start - 1])) start -= 1;
  while (!ws(a[aEnd])) aEnd += 1;
  while (!ws(b[bEnd])) bEnd += 1;
  return { from: a.slice(start, aEnd), to: b.slice(start, bEnd) };
}

function FixRow({ fix, busy, onToggle }: { fix: NonNullable<ReviewLine["fix"]>; busy: boolean; onToggle: () => void }) {
  const d = changed(fix.original, fix.corrected);
  return (
    <span className="fixrow">
      <span className="fixdiff">
        <s>{d.from || fix.original}</s> → <span className="to">{d.to || fix.corrected}</span>
      </span>
      <button type="button" className="linkbtn" disabled={busy} onClick={onToggle}>
        {fix.applied ? C_UNDO : C_USE_FIX}
      </button>
    </span>
  );
}

/** #379: the item's words, edited in place — a text box with Save / Cancel where the item was.
 *  Enter saves (Shift+Enter is a new line), Escape cancels. Empty words are never sent. Resolves
 *  true when the words were saved, so the editor closes only then. */
export type OnEdit = (id: string, text: string) => Promise<boolean>;

export function Item({
  line,
  busy,
  landed,
  onLandedEnd,
  onRemove,
  onEdit,
  onFix,
  tail,
}: {
  line: ReviewLine;
  busy: boolean;
  landed?: boolean;
  onLandedEnd?: () => void;
  onRemove: (id: string) => void;
  onEdit?: OnEdit;
  /** #384: undo a fix (false) or use it again (true). Absent → no tag is drawn. */
  onFix?: (id: string, applied: boolean) => void;
  /** A control a screen adds before ✎ and ⊖ — #382's move to another group. */
  tail?: ReactNode;
}) {
  // A tap on the text itself shows the actions (touch screens have no hover).
  const [active, setActive] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const fix = onFix ? line.fix : null;
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const penRef = useRef<HTMLButtonElement>(null);
  /** Focus goes back to ✎ when the editor closes — set on close, read by the effect. */
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing) boxRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      penRef.current?.focus();
    }
  }, [editing]);
  const close = () => {
    returnFocus.current = true;
    setDraft(null);
  };
  const words = draft?.trim() ?? "";
  const save = async () => {
    if (!onEdit || !words || busy) return;
    if (words === line.text || (await onEdit(line.id, words))) close();
  };

  if (editing) {
    const boxId = `edit-${line.id}`;
    return (
      <li className="pt edit">
        <label className="sr-only" htmlFor={boxId}>
          {C_EDIT}
        </label>
        <textarea
          id={boxId}
          ref={boxRef}
          className="ed"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <span className="row">
          <button type="button" className="btn sm primary" disabled={busy || !words} onClick={() => void save()}>
            {C_SAVE}
          </button>
          <button type="button" className="btn sm ghost" onClick={close}>
            {C_CANCEL}
          </button>
        </span>
      </li>
    );
  }
  return (
    <li
      className={`pt${active ? " act" : ""}${landed ? " landed" : ""}`}
      onAnimationEnd={onLandedEnd}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) setActive((a) => !a);
      }}
    >
      <span className="txt">
        {line.text}
        {line.draft && <span className="tag">{C_NEW}</span>}
        {line.movedFrom && <span className="tag moved">{movedCopy(line.movedFrom)}</span>}
        {fix && (
          <button type="button" className="tag fixed" aria-expanded={fixOpen} onClick={() => setFixOpen((o) => !o)}>
            {fix.applied ? C_FIXED : C_FIX_UNDONE}
          </button>
        )}
        {fix && fixOpen && <FixRow fix={fix} busy={busy} onToggle={() => onFix!(line.id, !fix.applied)} />}
      </span>
      <span className="acts">
        {tail}
        {onEdit && (
          <button type="button" ref={penRef} className="ib" aria-label={C_EDIT} title={C_EDIT} disabled={busy} onClick={() => setDraft(line.text)}>
            {PEN}
          </button>
        )}
        <button type="button" className="ib rmv" aria-label={C_REMOVE} title={C_REMOVE} disabled={busy} onClick={() => onRemove(line.id)}>
          {MINUS}
        </button>
      </span>
    </li>
  );
}

const MINUS_BIG = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="8.25" />
    <path d="M6 10h8" />
  </svg>
);

/** #380 (ADR-0018 clause 4): the review proposes removing an item that belongs nowhere. It sits
 *  where the item does — a coral bar, ⊖, the text underlined wavy — never the dashed gold frame,
 *  which is for adding. Remove it = the ordinary removal (→ the tray); Keep it = back in. */
export function RemoveCard({ line, busy, onRemove, onKeep }: { line: ReviewLine; busy: boolean; onRemove: (id: string) => void; onKeep: (id: string) => void }) {
  return (
    <li className="sg rmv">
      <span className="hd">{C_REMOVE_HD}</span>
      <span className="sline">
        <span className="mark minus">{MINUS_BIG}</span>
        <span className="stxt">
          <span className="sr-only">{C_TO_REMOVE}</span>
          {line.text}
        </span>
      </span>
      {line.suggestion && (
        <span className="meta">
          <span>
            {C_WHY}
            {line.suggestion.reason}
          </span>
        </span>
      )}
      <span className="row">
        <button type="button" className="btn sm" disabled={busy} onClick={() => onRemove(line.id)}>
          {C_REMOVE_IT}
        </button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => onKeep(line.id)}>
          {C_KEEP_IT}
        </button>
      </span>
    </li>
  );
}

export function Tray({ removed, busy, bump, onPutBack, onBumpEnd }: { removed: ReviewLine[]; busy: boolean; bump: boolean; onPutBack: (id: string) => void; onBumpEnd: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tray${bump ? " bump" : ""}`} onAnimationEnd={onBumpEnd}>
      <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {removedCopy(removed.length, open)}
      </button>
      {open && (
        <ul>
          {removed.map((l) => (
            <li key={l.id}>
              <s>{l.text}</s>
              <button type="button" className="linkbtn" disabled={busy} onClick={() => onPutBack(l.id)}>
                {C_PUT_BACK}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ItemListProps {
  lines: ReviewLine[];
  busy: boolean;
  /** The removed count glows once (the cue for a removal that just landed). */
  bump: boolean;
  /** #378: the item that just landed from a suggestion — its gold rule fades once. */
  landed?: string | null;
  onLandedEnd?: () => void;
  onRemove: (id: string) => void;
  onPutBack: (id: string) => void;
  onBumpEnd: () => void;
  /** #379: ✎ on every item when set. ScreenBody leaves it off where a screen edits its own way. */
  onEdit?: OnEdit;
  /** #384: undo / use again a spelling fix on an item. */
  onFix?: (id: string, applied: boolean) => void;
  /** What a line that is neither in nor removed renders as — a card type: #378's add card for a
   *  `drafted` line (and its "No thanks" row for a just-`dismissed` one); #380's RemoveCard for a
   *  `removal-suggested` one (screens.tsx ScreenBody routes all three). Null draws nothing. */
  card?: (line: ReviewLine) => ReactNode;
}

/** A section's items in a plain card: the ones in, each with its actions; the removed ones in the
 *  tray at the end. */
export function ItemList({ lines, busy, bump, landed, onLandedEnd, onRemove, onPutBack, onBumpEnd, onEdit, onFix, card }: ItemListProps) {
  const removed = lines.filter((l) => l.state === "kept");
  return (
    <>
      <ul className="pts">
        {lines.map((l) =>
          l.state === "ticked" ? (
            <Item key={l.id} line={l} busy={busy} landed={landed === l.id} onLandedEnd={onLandedEnd} onRemove={onRemove} onEdit={onEdit} onFix={onFix} />
          ) : l.state === "kept" ? null : (
            (card?.(l) ?? null)
          ),
        )}
      </ul>
      {removed.length > 0 && <Tray removed={removed} busy={busy} bump={bump} onPutBack={onPutBack} onBumpEnd={onBumpEnd} />}
    </>
  );
}
