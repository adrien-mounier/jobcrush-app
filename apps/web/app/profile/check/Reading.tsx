"use client";

// Owner, 2026-10-16: while the review runs (it can take ~5 min) check mode is a loading screen, never
// a walk over sections still being filled in — the walk opens once the run is over (page.tsx also
// opens it past a time limit, so a run that never ends cannot hold her here). The screen is the reading lamp: her own CV as the paper sheet, a band of lamplight
// passing down it, and its lines inking in as the run's units land — progress the run really
// reports (done / total), never a timer. Under reduced motion the lamp holds still where the run is.
import type { CSSProperties, RefObject } from "react";
import type { ReviewState } from "../../../lib/api";

const C_TITLE = "Reading your CV";
const C_SUB = "I'm checking every line before you go through it.";
const minutesCopy = (n: number) => (n <= 1 ? "About a minute left." : `About ${n} minutes left.`);
/** How many lines of her CV the sheet shows — enough to fill the page, never a scroll. */
const SHEET_ROWS = 22;

type Row = { text: string; kind: "name" | "role" | "head" | "line" };

/** Her CV, in reading order, as the sheet's rows. */
function rowsOf(state: ReviewState): Row[] {
  const rows: Row[] = [];
  const name = state.letterhead.name?.value;
  if (name) rows.push({ text: name, kind: "name" });
  for (const s of state.sections) {
    rows.push({ text: s.heading, kind: "head" });
    if ("jobs" in s) {
      for (const j of s.jobs) {
        rows.push({ text: [j.title, j.employer].filter(Boolean).join(" · "), kind: "role" });
        for (const l of j.lines) rows.push({ text: l.text, kind: "line" });
      }
    } else for (const l of s.lines) rows.push({ text: l.text, kind: "line" });
  }
  return rows.slice(0, SHEET_ROWS);
}

/** `headingRef`: the page's own — focus lands on "Reading your CV" when the screen opens. */
export function Reading({ state, headingRef }: { state: ReviewState; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const progress = state.progress!;
  const share = progress.total > 0 ? progress.done / progress.total : 0;
  const rows = rowsOf(state);
  const inked = Math.round(share * rows.length);
  return (
    <div className="reading">
      <div className="sheet" aria-hidden="true" style={{ "--at": share } as CSSProperties}>
        {rows.map((r, i) => (
          <p key={i} className={`${r.kind}${i < inked ? " inked" : ""}`}>
            {r.text}
          </p>
        ))}
        <i className="lamp" />
      </div>
      <h1 tabIndex={-1} ref={headingRef}>
        {C_TITLE}
      </h1>
      <p className="sub">{C_SUB}</p>
      <div className="readprog" aria-hidden="true">
        {Array.from({ length: progress.total }, (_, i) => (
          <i key={i} className={i < progress.done ? "done" : ""} />
        ))}
      </div>
      <p className="left" role="status">
        {minutesCopy(progress.minutesLeft)}
      </p>
    </div>
  );
}
