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
const C_REMOVE_HD = "Suggestion · Remove this?";
const C_TO_REMOVE = "To remove: ";
const C_WHY = "Why: ";
const C_REMOVE_IT = "Remove it";
const C_KEEP_IT = "Keep it";
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

export function Item({ line, busy, onRemove, onEdit }: { line: ReviewLine; busy: boolean; onRemove: (id: string) => void; onEdit?: (id: string) => void }) {
  // A tap on the text itself shows the actions (touch screens have no hover).
  const [active, setActive] = useState(false);
  return (
    <li
      className={`pt${active ? " act" : ""}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) setActive((a) => !a);
      }}
    >
      <span className="txt">{line.text}</span>
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
  onRemove: (id: string) => void;
  onPutBack: (id: string) => void;
  onBumpEnd: () => void;
  onEdit?: (id: string) => void;
  /** What any other line that is neither in nor removed renders as — a card type: #378 adds the
   *  add-suggestion card for a `drafted` line. (#380's removal card is routed in ItemList: its two
   *  answers are this list's own removal and put-back.) Null draws nothing. */
  card?: (line: ReviewLine) => ReactNode;
}

/** A section's items in a plain card: the ones in, each with its actions; the removed ones in the
 *  tray at the end. */
export function ItemList({ lines, busy, bump, onRemove, onPutBack, onBumpEnd, onEdit, card }: ItemListProps) {
  const removed = lines.filter((l) => l.state === "kept");
  return (
    <>
      <ul className="pts">
        {lines.map((l) =>
          l.state === "ticked" ? (
            <Item key={l.id} line={l} busy={busy} onRemove={onRemove} onEdit={onEdit} />
          ) : l.state === "kept" ? null : l.state === "removal-suggested" ? (
            <RemoveCard key={l.id} line={l} busy={busy} onRemove={onRemove} onKeep={onPutBack} />
          ) : (
            (card?.(l) ?? null)
          ),
        )}
      </ul>
      {removed.length > 0 && <Tray removed={removed} busy={busy} bump={bump} onPutBack={onPutBack} onBumpEnd={onBumpEnd} />}
    </>
  );
}
