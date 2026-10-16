"use client";

// #382 (ADR-0018 clause 6) — the Skills screen of check mode: one skill per item, in the groups the
// machine named (from the CV's own group labels where it has them). Two columns of groups on a wide
// screen, one on a phone. Tap a group's name to rename it (Enter keeps, Escape drops the change);
// the move icon beside ✎ / ⊖ opens "Move to group". Both persist through the server's two group
// doors. Grouping is never an item to answer, so nothing here holds the footer button. Each skill is
// an ordinary item: ⊖ removes it into the one tray at the end; a group with nothing left in it hides.
// A skill in any other state (a suggestion to answer, #380) draws the screen's card in its group.
// #394: a skill the model left unnamed sits under the heading the wire gives it. The walk opens
// only once the review is over (owner, 2026-10-16: the reading lamp covers the run), so no group
// here is ever still waiting for its name.
import { useEffect, useRef, useState } from "react";
import type { ReviewLine, SkillGroup } from "../../../lib/api";
import { Item, Tray, type ItemListProps } from "./Item";

const C_RENAME = "Rename this group";
const C_GROUP_NAME = "Group name";
const C_MOVE = "Move to another group";
const C_MOVE_TO = "Move to group";

const MOVE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 5h10M10 2l3 3-3 3M13 11H3M6 8l-3 3 3 3" />
  </svg>
);

export interface GroupActions {
  onRename: (from: string, to: string) => void;
  onMove: (id: string, group: string) => void;
}

export function SkillsBody({
  lines,
  groups,
  list,
  actions,
}: {
  lines: ReviewLine[];
  groups: SkillGroup[];
  list: Omit<ItemListProps, "lines">;
  actions: GroupActions;
}) {
  const { busy, bump, onRemove, onPutBack, onBumpEnd, onEdit, card } = list;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const moveRef = useRef<HTMLSelectElement>(null);
  // Focus lands in the control just opened — keyed to the committed state, never a timer.
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [renaming]);
  useEffect(() => {
    moveRef.current?.focus();
  }, [moving]);

  const byId = new Map(lines.map((l) => [l.id, l]));
  const names = groups.map((g) => g.name);
  const removed = lines.filter((l) => l.state === "kept");
  const rename = (from: string, value: string) => {
    setRenaming(null);
    const to = value.trim();
    if (to && to !== from) actions.onRename(from, to);
  };
  return (
    <>
      <div className="groups">
        {groups.map((g) => {
          const shown = g.ids.flatMap((id) => {
            const l = byId.get(id);
            return l && l.state !== "kept" ? [l] : [];
          });
          if (shown.length === 0) return null;
          return (
            <div className="grp" key={g.name}>
              {renaming === g.name ? (
                <input
                  ref={nameRef}
                  className="gname"
                  defaultValue={g.name}
                  aria-label={C_GROUP_NAME}
                  maxLength={60}
                  onBlur={(e) => rename(g.name, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = g.name;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button type="button" className="gh" title={C_RENAME} disabled={busy} onClick={() => setRenaming(g.name)}>
                  {g.name}
                </button>
              )}
              <ul className="pts">
                {shown.map((l) =>
                  l.state !== "ticked" ? (
                    (card?.(l) ?? null)
                  ) : (
                  <Item
                    key={l.id}
                    line={l}
                    busy={busy}
                    onRemove={onRemove}
                    onEdit={onEdit}
                    tail={
                      moving === l.id ? (
                        <select
                          ref={moveRef}
                          className="mv"
                          aria-label={C_MOVE_TO}
                          value={g.name}
                          onBlur={() => setMoving(null)}
                          onKeyDown={(e) => e.key === "Escape" && setMoving(null)}
                          onChange={(e) => {
                            setMoving(null);
                            if (e.target.value !== g.name) actions.onMove(l.id, e.target.value);
                          }}
                        >
                          {names.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button type="button" className="ib move" aria-label={C_MOVE} title={C_MOVE} disabled={busy} onClick={() => setMoving(l.id)}>
                          {MOVE}
                        </button>
                      )
                    }
                  />
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </div>
      {removed.length > 0 && <Tray removed={removed} busy={busy} bump={bump} onPutBack={onPutBack} onBumpEnd={onBumpEnd} />}
    </>
  );
}
