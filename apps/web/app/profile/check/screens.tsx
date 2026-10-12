"use client";

// #377 — the screens of check mode: what each section of the profile becomes on the walk, and
// what each screen shows. The walk's engine (page.tsx) knows only the Screen shape; this file is
// where a ticket adds a screen kind, a card type or a blocker.
//
// Order: the server's own (rootcv.ts SECTIONS, as GET /review lists them) — Your details first,
// then About you (the `profile` section), one screen per job, then every other section in print
// order. Certifications gets its own screen in that slot (the product has the section; the
// prototype had no lines for it). A section with no items is skipped — so Personal projects and
// Languages appear the day #373 and #376 give them lines, with no change here.
import type { ReactNode } from "react";
import type { ReviewJob, ReviewLine, ReviewState } from "../../../lib/api";
import { ItemList, RemoveCard, type ItemListProps } from "./Item";
import { DismissedRow, SuggestionCard } from "./SuggestionCard";

const C_DETAILS = "Your details";
/** A section's screen title — the profile's words, not the master CV's headings. A tag not listed
 *  here keeps the heading the server sent. */
const TITLES: Record<string, string> = {
  profile: "About you",
  project: "Personal projects",
  skill: "Skills",
  cert: "Certifications",
  edu: "Education",
  lang: "Languages",
  additional: "Additional information",
};
const LEAD_DETAILS = "Check how I read your details. Fix anything that's wrong.";
const LEAD_QUIET = "Nothing to answer here. Edit or remove anything that's wrong.";
// #380: "below", not "in gold below" — a removal suggestion is coral.
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} below. Edit or remove anything else that's wrong.`;

export type Screen =
  | { kind: "details"; key: "details"; title: string; sub: null; letterhead: ReviewState["letterhead"] }
  | { kind: "job"; key: string; title: string; sub: string; job: ReviewJob; lines: ReviewLine[] }
  | { kind: "section"; key: string; title: string; sub: null; tag: string; lines: ReviewLine[] };

const datesOf = (job: ReviewJob) => (job.dates ? [job.dates.start, job.dates.end].filter(Boolean).join(" – ") : "");
/** #378: a draft the person said No thanks to is shown nowhere (after its few seconds of Undo), so
 *  a screen holding nothing else is no screen. */
const shown = (lines: ReviewLine[]) => lines.some((l) => l.state !== "dismissed");

export function screensOf(state: ReviewState): Screen[] {
  const out: Screen[] = [];
  const { header, phone, email } = state.letterhead;
  if (header || phone || email) out.push({ kind: "details", key: "details", title: C_DETAILS, sub: null, letterhead: state.letterhead });
  for (const section of state.sections) {
    if ("jobs" in section) {
      for (const job of section.jobs) {
        if (!shown(job.lines)) continue;
        out.push({ kind: "job", key: `job:${job.id}`, title: job.employer, sub: [job.title, datesOf(job)].filter(Boolean).join(" · "), job, lines: job.lines });
      }
    } else if (shown(section.lines)) {
      out.push({ kind: "section", key: `section:${section.tag}`, title: TITLES[section.tag] ?? section.heading, sub: null, tag: section.tag, lines: section.lines });
    }
  }
  return out;
}

/** A line's states that are a suggestion the person has not answered yet — the server's own set
 *  (cvReview.ts OPEN_SUGGESTION_STATES): #378's add suggestions (`drafted`) and #380's removal
 *  suggestions (`removal-suggested`). A `dismissed` draft is answered. */
const OPEN_SUGGESTION_STATES: ReadonlySet<ReviewLine["state"]> = new Set<ReviewLine["state"]>(["drafted", "removal-suggested"]);

/** The cards on a screen the person must answer, of both kinds — the lead sentence says how many. */
export function toAnswer(screen: Screen): number {
  return screen.kind === "details" ? 0 : screen.lines.filter((l) => OPEN_SUGGESTION_STATES.has(l.state)).length;
}

/** What still holds the footer button on this screen, named as the button says it ("Answer X and
 *  Y to continue"). #376 names each target market with no work-rights answer first; then the
 *  open suggestions. */
export function blockersOf(screen: Screen): string[] {
  const n = toAnswer(screen);
  return n === 0 ? [] : [n === 1 ? "the suggestion" : "the suggestions"];
}

/** #378: how the walk answers an add suggestion, and the drafts dismissed moments ago (their No
 *  thanks row shows for a few seconds, with Undo). */
export interface DraftAnswers {
  justDismissed: ReadonlySet<string>;
  onAdd: (id: string, text?: string) => void;
  onSaveText: (id: string, text: string) => void;
  onDismiss: (id: string) => void;
  onUndo: (id: string) => void;
}

export function leadFor(screen: Screen): string {
  if (screen.kind === "details") return LEAD_DETAILS;
  const n = toAnswer(screen);
  return n > 0 ? leadSuggestions(n) : LEAD_QUIET;
}

/** One screen's body. Add a screen kind here: #371 the About you card, #381 the details fields,
 *  #376 the Where you can work card above Additional information, #382 the skills groups. */
export function ScreenBody({ screen, list, drafts }: { screen: Screen; list: Omit<ItemListProps, "lines" | "card">; drafts: DraftAnswers }): ReactNode {
  if (screen.kind === "details") {
    const { header, phone, email } = screen.letterhead;
    const [name, ...rest] = (header ?? "").split("\n");
    const contact = [email?.value, phone?.value].filter(Boolean).join(" · ");
    return (
      <div className="card">
        <div className="clean">
          {name && <div className="name">{name}</div>}
          {rest.length > 0 && <div>{rest.join("\n")}</div>}
          {contact && <span>{contact}</span>}
        </div>
      </div>
    );
  }
  // #379: ✎ on every item except About you's, whose editing is its own (#371).
  const editable = screen.kind === "job" || screen.tag !== "profile";
  const family = screen.kind === "job" ? screen.job.family : null;
  const card = (line: ReviewLine): ReactNode => {
    if (line.state === "drafted" && line.draft)
      return (
        <SuggestionCard
          key={line.id}
          line={line}
          job={screen.title}
          family={family}
          busy={list.busy}
          onAdd={drafts.onAdd}
          onSaveText={drafts.onSaveText}
          onDismiss={drafts.onDismiss}
        />
      );
    if (line.state === "dismissed" && drafts.justDismissed.has(line.id)) return <DismissedRow key={line.id} busy={list.busy} onUndo={() => drafts.onUndo(line.id)} />;
    // #380: Remove it is the ordinary removal (→ the tray), Keep it the ordinary put-back (→ in).
    if (line.state === "removal-suggested") return <RemoveCard key={line.id} line={line} busy={list.busy} onRemove={list.onRemove} onKeep={list.onPutBack} />;
    return null;
  };
  return (
    <div className="card">
      <ItemList lines={screen.lines} {...list} onEdit={editable ? list.onEdit : undefined} card={card} />
    </div>
  );
}
