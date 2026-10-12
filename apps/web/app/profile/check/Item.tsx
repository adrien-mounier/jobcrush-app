"use client";

// #377 — an item of the profile in check mode (ADR-0018 clause 2): plain text with two quiet
// actions that show on hover, focus or a tap — ✎ (when a ticket wires `onEdit`: #379) and ⊖, which
// removes it. What was removed stays one tap away in the tray at the end of its section, with Put
// back. No tick box anywhere; nothing on screen says "kept", "ticked" or "reviewed".
import { useState, type ReactNode } from "react";
import type { ReviewLine } from "../../../lib/api";

const C_EDIT = "Edit";
const C_REMOVE = "Remove";
const C_PUT_BACK = "Put back";
const removedCopy = (n: number, open: boolean) => `${n} removed · ${open ? "Hide" : "Show"}`;

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

export function Item({
  line,
  busy,
  onRemove,
  onEdit,
  onFix,
}: {
  line: ReviewLine;
  busy: boolean;
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  /** #384: undo a fix (false) or use it again (true). Absent → no tag is drawn. */
  onFix?: (id: string, applied: boolean) => void;
}) {
  // A tap on the text itself shows the actions (touch screens have no hover).
  const [active, setActive] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const fix = onFix ? line.fix : null;
  return (
    <li
      className={`pt${active ? " act" : ""}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) setActive((a) => !a);
      }}
    >
      <span className="txt">
        {line.text}
        {fix && (
          <button type="button" className="tag" aria-expanded={fixOpen} onClick={() => setFixOpen((o) => !o)}>
            {fix.applied ? C_FIXED : C_FIX_UNDONE}
          </button>
        )}
        {fix && fixOpen && <FixRow fix={fix} busy={busy} onToggle={() => onFix!(line.id, !fix.applied)} />}
      </span>
      <span className="acts">
        {onEdit && (
          <button type="button" className="ib" aria-label={C_EDIT} title={C_EDIT} disabled={busy} onClick={() => onEdit(line.id)}>
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
  onRemove: (id: string) => void;
  onPutBack: (id: string) => void;
  onBumpEnd: () => void;
  onEdit?: (id: string) => void;
  /** #384: undo / use again a spelling fix on an item. */
  onFix?: (id: string, applied: boolean) => void;
  /** What a line that is neither in nor removed renders as — a card type. None today: #378 adds
   *  the add-suggestion card for a `drafted` line, #380 the removal card. Null draws nothing. */
  card?: (line: ReviewLine) => ReactNode;
}

/** A section's items in a plain card: the ones in, each with its actions; the removed ones in the
 *  tray at the end. */
export function ItemList({ lines, busy, bump, onRemove, onPutBack, onBumpEnd, onEdit, onFix, card }: ItemListProps) {
  const removed = lines.filter((l) => l.state === "kept");
  return (
    <>
      <ul className="pts">
        {lines.map((l) =>
          l.state === "ticked" ? <Item key={l.id} line={l} busy={busy} onRemove={onRemove} onEdit={onEdit} onFix={onFix} /> : l.state === "kept" ? null : (card?.(l) ?? null),
        )}
      </ul>
      {removed.length > 0 && <Tray removed={removed} busy={busy} bump={bump} onPutBack={onPutBack} onBumpEnd={onBumpEnd} />}
    </>
  );
}
