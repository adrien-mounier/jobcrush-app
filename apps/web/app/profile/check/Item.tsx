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
}: {
  line: ReviewLine;
  busy: boolean;
  landed?: boolean;
  onLandedEnd?: () => void;
  onRemove: (id: string) => void;
  onEdit?: OnEdit;
}) {
  // A tap on the text itself shows the actions (touch screens have no hover).
  const [active, setActive] = useState(false);
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
      </span>
      <span className="acts">
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
  /** What a line that is neither in nor removed renders as — a card type: #378's add card for a
   *  `drafted` line (and its "No thanks" row for a just-`dismissed` one); #380 routes a line in
   *  `removal-suggested` state here too. Null draws nothing. */
  card?: (line: ReviewLine) => ReactNode;
}

/** A section's items in a plain card: the ones in, each with its actions; the removed ones in the
 *  tray at the end. */
export function ItemList({ lines, busy, bump, landed, onLandedEnd, onRemove, onPutBack, onBumpEnd, onEdit, card }: ItemListProps) {
  const removed = lines.filter((l) => l.state === "kept");
  return (
    <>
      <ul className="pts">
        {lines.map((l) =>
          l.state === "ticked" ? (
            <Item key={l.id} line={l} busy={busy} landed={landed === l.id} onLandedEnd={onLandedEnd} onRemove={onRemove} onEdit={onEdit} />
          ) : l.state === "kept" ? null : (
            (card?.(l) ?? null)
          ),
        )}
      </ul>
      {removed.length > 0 && <Tray removed={removed} busy={busy} bump={bump} onPutBack={onPutBack} onBumpEnd={onBumpEnd} />}
    </>
  );
}
