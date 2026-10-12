"use client";

// #377 — the screens of check mode: what each section of the profile becomes on the walk, and
// what each screen shows. The walk's engine (page.tsx) knows only the Screen shape; this file is
// where a ticket adds a screen kind, a card type or a blocker.
//
// Order: the server's own (rootcv.ts SECTIONS, as GET /review lists them) — Your details first,
// then About you (the `profile` section), one screen per job, then every other section in print
// order. Certifications gets its own screen in that slot (the product has the section; the
// prototype had no lines for it). A section with no items is skipped — so Personal projects appears
// the day #373 gives it lines — with two exceptions (#376, ADR-0018 clauses 5 and 8): Languages is
// never skipped (a CV with none gets the card asking which languages the person speaks), and
// Additional information exists whenever there is a target market to answer "Where you can work" for.
import type { ReactNode } from "react";
import type { ContactField, ReviewJob, ReviewLine, ReviewState, ReviewWorkRights, WorkRightsAnswer } from "../../../lib/api";
import { ItemList, RemoveCard, type ItemListProps } from "./Item";
import { DismissedRow, SuggestionCard } from "./SuggestionCard";
import { LanguagesCard, WorkCard } from "./cards";

const C_DETAILS = "Your details";
const C_NOT_FOUND = "Not found in your CV";
/** #381: Your details' fields in the prototype's order, each with its label and the browser's
 *  autofill hint and keyboard. */
const DETAIL_FIELDS: Array<{ field: ContactField; label: string; type: string; autoComplete: string }> = [
  { field: "name", label: "Name", type: "text", autoComplete: "name" },
  { field: "title", label: "Title", type: "text", autoComplete: "organization-title" },
  { field: "email", label: "Email", type: "email", autoComplete: "email" },
  { field: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { field: "location", label: "Location", type: "text", autoComplete: "address-level2" },
];
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
const LEAD_WORK = "Tell me where you can work.";
const leadWorkAndSuggestions = (n: number) => `Tell me where you can work, and answer ${n === 1 ? "the suggestion" : "the suggestions"} in the list.`;
const LEAD_NO_LANGUAGES = "Your CV lists no languages. Tell me the ones you speak.";
// #380: "below", not "in gold below" — a removal suggestion is coral.
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} below. Edit or remove anything else that's wrong.`;

export type Screen =
  | { kind: "details"; key: "details"; title: string; sub: null; letterhead: ReviewState["letterhead"] }
  | { kind: "job"; key: string; title: string; sub: string; job: ReviewJob; lines: ReviewLine[] }
  | {
      kind: "section";
      key: string;
      title: string;
      sub: null;
      tag: string;
      lines: ReviewLine[];
      /** #376: the "Where you can work" rows — on the Additional information screen only. */
      workRights?: ReviewWorkRights[];
      /** #376: the languages the person said they speak — on an empty Languages screen only. */
      languages?: string[];
    };

const datesOf = (job: ReviewJob) => (job.dates ? [job.dates.start, job.dates.end].filter(Boolean).join(" – ") : "");
/** #378: a draft the person said No thanks to is shown nowhere (after its few seconds of Undo), so
 *  a screen holding nothing else is no screen. */
const shown = (lines: ReviewLine[]) => lines.some((l) => l.state !== "dismissed");

export function screensOf(state: ReviewState): Screen[] {
  const out: Screen[] = [];
  if (Object.values(state.letterhead).some(Boolean)) out.push({ kind: "details", key: "details", title: C_DETAILS, sub: null, letterhead: state.letterhead });
  for (const section of state.sections) {
    if ("jobs" in section) {
      for (const job of section.jobs) {
        if (!shown(job.lines)) continue;
        out.push({ kind: "job", key: `job:${job.id}`, title: job.employer, sub: [job.title, datesOf(job)].filter(Boolean).join(" · "), job, lines: job.lines });
      }
    } else {
      const extra = sectionExtras(state, section.tag, section.lines);
      if (shown(section.lines) || extra)
        out.push({ kind: "section", key: `section:${section.tag}`, title: TITLES[section.tag] ?? section.heading, sub: null, tag: section.tag, lines: section.lines, ...extra });
    }
  }
  // #376: no Additional information section on the paper yet, but a market to answer — the screen
  // exists for the card alone, last.
  if (!out.some((s) => s.key === `section:${ADDITIONAL}`)) {
    const extra = sectionExtras(state, ADDITIONAL, []);
    if (extra) out.push({ kind: "section", key: `section:${ADDITIONAL}`, title: TITLES[ADDITIONAL]!, sub: null, tag: ADDITIONAL, lines: [], ...extra });
  }
  return out;
}

const ADDITIONAL = "additional";
/** #376: what a section's screen carries besides its items — null when nothing, which (with no
 *  items) skips the screen. */
function sectionExtras(state: ReviewState, tag: string, lines: ReviewLine[]): { workRights: ReviewWorkRights[] } | { languages: string[] } | null {
  if (tag === ADDITIONAL && state.workRights.length > 0) return { workRights: state.workRights };
  if (tag === "lang" && !shown(lines)) return { languages: state.languages };
  return null;
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
 *  Y to continue"). #376: each target market with no work-rights answer first, by name — a
 *  proposal from the CV is not an answer; then the open suggestions. */
export function blockersOf(screen: Screen): string[] {
  const markets = screen.kind === "section" && screen.workRights ? screen.workRights.filter((r) => r.answer === null).map((r) => r.market) : [];
  const n = toAnswer(screen);
  return [...markets, ...(n === 0 ? [] : [n === 1 ? "the suggestion" : "the suggestions"])];
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
  if (screen.kind === "section" && screen.workRights) return n > 0 ? leadWorkAndSuggestions(n) : LEAD_WORK;
  if (screen.kind === "section" && screen.languages) return LEAD_NO_LANGUAGES;
  return n > 0 ? leadSuggestions(n) : LEAD_QUIET;
}

/** One screen's body. Add a screen kind here: #371 the About you card, #381 the details fields,
 *  #376 the Where you can work card above Additional information, #382 the skills groups. */
export interface DetailsProps {
  /** What each field shows: the person's typing, else the saved value, else "". */
  values: Record<ContactField, string>;
  onChange: (field: ContactField, value: string) => void;
}

/** #376: how the walk answers the person's own-fact cards — work rights per market, languages. */
export interface CardAnswers {
  onWorkRights: (itemId: string, answer: WorkRightsAnswer) => void;
  onLanguages: (languages: string[]) => void;
}

export function ScreenBody({
  screen,
  list,
  drafts,
  details,
  answers,
}: {
  screen: Screen;
  list: Omit<ItemListProps, "lines" | "card">;
  drafts: DraftAnswers;
  details: DetailsProps;
  answers: CardAnswers;
}): ReactNode {
  if (screen.kind === "details") {
    // #381 (ADR-0018 clause 5): the person's own facts — a plain card of fields, no button of its
    // own; the footer button saves.
    return (
      <div className="card form">
        <div className="fields">
          {DETAIL_FIELDS.map(({ field, label, type, autoComplete }) => (
            <label key={field}>
              {label}
              <input
                name={field}
                type={type}
                autoComplete={autoComplete}
                value={details.values[field]}
                placeholder={C_NOT_FOUND}
                disabled={list.busy}
                onChange={(e) => details.onChange(field, e.target.value)}
              />
            </label>
          ))}
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
  const items =
    screen.lines.length > 0 ? (
      <div className="card">
        <ItemList lines={screen.lines} {...list} onEdit={editable ? list.onEdit : undefined} card={card} />
      </div>
    ) : null;
  // #376: the person's own facts sit in plain cards — Where you can work above the Additional
  // information list; the languages card on a Languages screen the CV left empty.
  if (screen.kind === "section" && screen.workRights)
    return (
      <>
        <WorkCard rows={screen.workRights} busy={list.busy} onAnswer={answers.onWorkRights} />
        {items}
      </>
    );
  if (screen.kind === "section" && screen.languages)
    return <LanguagesCard languages={screen.languages} busy={list.busy} onSave={answers.onLanguages} />;
  return items;
}
