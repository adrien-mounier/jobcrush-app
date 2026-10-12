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
import { useState, type ReactNode } from "react";
import type { ContactField, ReviewJob, ReviewLine, ReviewState, SkillGroup } from "../../../lib/api";
import { ItemList, RemoveCard, type ItemListProps } from "./Item";
import { SkillsBody, type GroupActions } from "./Skills";
import { DismissedRow, SuggestionCard } from "./SuggestionCard";

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
const LEAD_ABOUT = "I wrote this from your whole CV. Keep it, or change it.";
const C_ABOUT_EDIT = "Edit it";
const C_ABOUT_UNDO = "Undo my changes";
const C_ABOUT_SEE = "See what your CV said";
const C_ABOUT_HIDE = "Hide what your CV said";
const C_ABOUT_ORIG = "What your CV said";
const LEAD_QUIET = "Nothing to answer here. Edit or remove anything that's wrong.";
// #380: "below", not "in gold below" — a removal suggestion is coral.
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} below. Edit or remove anything else that's wrong.`;

export type Screen =
  | { kind: "details"; key: "details"; title: string; sub: null; letterhead: ReviewState["letterhead"] }
  | { kind: "about"; key: "about"; title: string; sub: null; about: NonNullable<ReviewState["about"]> }
  | { kind: "job"; key: string; title: string; sub: string; job: ReviewJob; lines: ReviewLine[] }
  | { kind: "section"; key: string; title: string; sub: null; tag: string; lines: ReviewLine[] }
  /** #382: the Skills section — its items in named groups. Grouping is never an item to answer. */
  | { kind: "skills"; key: string; title: string; sub: null; tag: string; lines: ReviewLine[]; groups: SkillGroup[] };

const datesOf = (job: ReviewJob) => (job.dates ? [job.dates.start, job.dates.end].filter(Boolean).join(" – ") : "");
/** #378: a draft the person said No thanks to is shown nowhere (after its few seconds of Undo), so
 *  a screen holding nothing else is no screen. */
const shown = (lines: ReviewLine[]) => lines.some((l) => l.state !== "dismissed");

export function screensOf(state: ReviewState): Screen[] {
  const out: Screen[] = [];
  // #385: check mode brought back by a re-upload shows only the new items (and the suggestions made
  // on them); a screen with nothing new — Your details among them — is skipped.
  const fresh = state.newItems && new Set(state.newItems);
  const its = (lines: ReviewLine[]) => (fresh ? lines.filter((l) => fresh.has(l.id)) : lines);
  if (!fresh && Object.values(state.letterhead).some(Boolean)) out.push({ kind: "details", key: "details", title: C_DETAILS, sub: null, letterhead: state.letterhead });
  for (const section of state.sections) {
    if ("jobs" in section) {
      for (const job of section.jobs) {
        const lines = its(job.lines);
        if (!shown(lines)) continue;
        out.push({ kind: "job", key: `job:${job.id}`, title: job.employer, sub: [job.title, datesOf(job)].filter(Boolean).join(" · "), job, lines });
      }
    } else if (section.tag === "profile" && state.about) {
      // #371: About you replaces the summary's lines with the text written from the whole CV — even
      // for a CV with no summary. Until the review wrote one, the summary shows as read, below.
      // #385: it is not an item a re-upload brings, so check mode brought back skips it.
      if (!fresh) out.push({ kind: "about", key: "about", title: TITLES.profile!, sub: null, about: state.about });
    } else if (shown(its(section.lines))) {
      const base = { key: `section:${section.tag}`, title: TITLES[section.tag] ?? section.heading, sub: null, tag: section.tag, lines: its(section.lines) };
      out.push(section.groups ? { ...base, kind: "skills", groups: section.groups } : { ...base, kind: "section" });
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
  return screen.kind === "details" || screen.kind === "about" ? 0 : screen.lines.filter((l) => OPEN_SUGGESTION_STATES.has(l.state)).length;
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
  if (screen.kind === "about") return LEAD_ABOUT;
  const n = toAnswer(screen);
  return n > 0 ? leadSuggestions(n) : LEAD_QUIET;
}

/** One screen's body. Add a screen kind here: #371 the About you card, #381 the details fields,
 *  #376 the Where you can work card above Additional information, #382 the skills groups. */
export interface DetailsProps {
  /** What each field shows: the person's typing, else the saved value, else "". */
  values: Record<ContactField, string>;
  onChange: (field: ContactField, value: string) => void;
}

export function ScreenBody({
  screen,
  list,
  drafts,
  details,
  aboutDraft,
  groups,
}: {
  screen: Screen;
  list: Omit<ItemListProps, "lines" | "card">;
  drafts: DraftAnswers;
  details: DetailsProps;
  aboutDraft: AboutDraft;
  groups: GroupActions;
}): ReactNode {
  if (screen.kind === "about") return <AboutCard about={screen.about} {...aboutDraft} />;
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
  if (screen.kind === "skills") {
    return (
      <div className="card">
        <SkillsBody lines={screen.lines} groups={screen.groups} list={{ ...list, card }} actions={groups} />
      </div>
    );
  }
  return (
    <div className="card">
      <ItemList lines={screen.lines} {...list} onEdit={editable ? list.onEdit : undefined} card={card} />
    </div>
  );
}

/** #371: the person's words while they edit About you — null when not editing. The walk's engine
 *  owns it (page.tsx) so it survives Back/Next and the footer button can save it. */
export interface AboutDraft {
  draft: string | null;
  onDraft: (text: string | null) => void;
}

/** #371 (ADR-0018 clause 5): About you in a plain card — the text, "Edit it", and the CV's own
 *  summary one tap away, read-only. No confirm here: the footer button keeps or saves it. */
function AboutCard({ about, draft, onDraft }: { about: NonNullable<ReviewState["about"]> } & AboutDraft) {
  const [open, setOpen] = useState(false);
  if (draft !== null) {
    return (
      <div className="card form">
        <label className="sr-only" htmlFor="about-ed">
          {TITLES.profile}
        </label>
        <textarea id="about-ed" className="ed" autoFocus value={draft} onChange={(e) => onDraft(e.target.value)} />
        <span className="row">
          <button type="button" className="btn sm ghost" onClick={() => onDraft(null)}>
            {C_ABOUT_UNDO}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="card form">
      <p className="about">{about.text}</p>
      <span className="row">
        <button type="button" className="btn sm" onClick={() => onDraft(about.text)}>
          {C_ABOUT_EDIT}
        </button>
        {about.original !== null && (
          <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? C_ABOUT_HIDE : C_ABOUT_SEE}
          </button>
        )}
      </span>
      {open && about.original !== null && (
        <div className="orig">
          <span className="hd">{C_ABOUT_ORIG}</span>
          <p>{about.original}</p>
        </div>
      )}
    </div>
  );
}
