"use client";

// #376 — the person's own facts on check mode (ADR-0018 clauses 5 and 8), in plain cards, never in a
// suggestion frame. "Where you can work": one row per target market, two pills, the CV's proposal
// shown picked but stored only when tapped — so tapping the picked pill is what answers it. The
// footer button names each market still open (screens.tsx blockersOf); the server refuses the
// finish too. "Which languages do you speak?": the Languages screen's card when the CV lists none.
import { useEffect, useState } from "react";
import type { ReviewWorkRights, WorkRightsAnswer } from "../../../lib/api";

const C_WORK = "Where you can work";
const C_FROM_CV = "From your CV:";
// The screen's words for the store's two answers.
const PILLS: ReadonlyArray<readonly [WorkRightsAnswer, string]> = [
  ["eligible", "Yes, I can work there"],
  ["needs-sponsorship", "No, I'd need a visa"],
];
const C_LANGUAGES = "Which languages do you speak?";
const C_LANGUAGES_LABEL = "Languages, separated by commas";
const C_LANGUAGES_HINT = "e.g. English, French";
const C_SAVE = "Save";
// What the discovery question said before the answer (#165): leaving a language out costs nothing.
const C_LANGUAGES_SAFE = "Nothing you leave out counts against you.";
const C_COMPLETIONS = "Languages I know";
const offListCopy = (word: string) => `"${word}" isn't on my list. I'll keep it as you wrote it.`;

export function WorkCard({ rows, busy, onAnswer }: { rows: ReviewWorkRights[]; busy: boolean; onAnswer: (itemId: string, answer: WorkRightsAnswer) => void }) {
  const sources = [...new Set(rows.flatMap((r) => (r.source ? [r.source] : [])))];
  return (
    <div className="card form wr">
      <h3 className="ctitle">{C_WORK}</h3>
      {sources.map((source) => (
        <p key={source} className="wrsrc">
          {C_FROM_CV} <q>{source}</q>
        </p>
      ))}
      {rows.map((row) => {
        const picked = row.answer ?? row.proposed;
        return (
          <fieldset key={row.itemId} className="wrrow">
            <legend>{row.market}</legend>
            {row.note && <p>{row.note}</p>}
            <div className="pills">
              {PILLS.map(([value, label]) => (
                <label key={value} className="pill">
                  {/* onClick, not onChange: tapping the pre-picked proposal must answer it too. */}
                  <input
                    type="radio"
                    name={`wr-${row.itemId}`}
                    value={value}
                    checked={picked === value}
                    readOnly
                    disabled={busy}
                    onClick={() => onAnswer(row.itemId, value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

const split = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The languages card: a comma-separated list. The word being typed (after the last comma) completes
 *  from the product's own list (`options`); a word the list has never heard of is kept as written. */
export function LanguagesCard({
  languages,
  options,
  busy,
  onSave,
}: {
  languages: string[];
  options: string[];
  busy: boolean;
  onSave: (languages: string[]) => void;
}) {
  const stored = languages.join(", ");
  const [text, setText] = useState(stored);
  // What the server holds wins after a save (the walk re-reads it).
  useEffect(() => setText(stored), [stored]);
  const words = text.split(",");
  const typing = words[words.length - 1]!.trim();
  const listed = words.slice(0, -1).map((w) => w.trim()).filter(Boolean);
  const completions = typing
    ? options.filter((o) => o.toLowerCase().startsWith(typing.toLowerCase()) && !same(o, typing) && !listed.some((l) => same(l, o)))
    : [];
  const offList = typing && completions.length === 0 && !options.some((o) => same(o, typing)) ? typing : null;
  return (
    <form
      className="card form langs"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(split(text));
      }}
    >
      <h3 className="ctitle">{C_LANGUAGES}</h3>
      <p className="conseq">{C_LANGUAGES_SAFE}</p>
      <div className="fields">
        <label>
          {C_LANGUAGES_LABEL}
          <input value={text} placeholder={C_LANGUAGES_HINT} aria-autocomplete="list" onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      {completions.length > 0 && (
        <div className="sugg" role="group" aria-label={C_COMPLETIONS}>
          {completions.map((o) => (
            <button key={o} type="button" className="btn sm" onClick={() => setText(`${[...listed, o].join(", ")}, `)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {offList && <p className="note">{offListCopy(offList)}</p>}
      <span className="row">
        <button type="submit" className="btn sm" disabled={busy}>
          {C_SAVE}
        </button>
      </span>
    </form>
  );
}
