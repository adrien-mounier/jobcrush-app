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
import type { ReviewJob, ReviewLine, ReviewState } from "../../../lib/api";
import { ItemList, type ItemListProps } from "./Item";

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
const LEAD_ABOUT = "I wrote this from your whole CV. Keep it, or change it.";
const C_ABOUT_EDIT = "Edit it";
const C_ABOUT_UNDO = "Undo my changes";
const C_ABOUT_SEE = "See what your CV said";
const C_ABOUT_HIDE = "Hide what your CV said";
const C_ABOUT_ORIG = "What your CV said";
const LEAD_QUIET = "Nothing to answer here. Edit or remove anything that's wrong.";
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} in gold below. Edit or remove anything else that's wrong.`;

export type Screen =
  | { kind: "details"; key: "details"; title: string; sub: null; letterhead: ReviewState["letterhead"] }
  | { kind: "about"; key: "about"; title: string; sub: null; about: NonNullable<ReviewState["about"]> }
  | { kind: "job"; key: string; title: string; sub: string; job: ReviewJob; lines: ReviewLine[] }
  | { kind: "section"; key: string; title: string; sub: null; tag: string; lines: ReviewLine[] };

const datesOf = (job: ReviewJob) => (job.dates ? [job.dates.start, job.dates.end].filter(Boolean).join(" – ") : "");

export function screensOf(state: ReviewState): Screen[] {
  const out: Screen[] = [];
  const { header, phone, email } = state.letterhead;
  if (header || phone || email) out.push({ kind: "details", key: "details", title: C_DETAILS, sub: null, letterhead: state.letterhead });
  for (const section of state.sections) {
    if ("jobs" in section) {
      for (const job of section.jobs) {
        if (job.lines.length === 0) continue;
        out.push({ kind: "job", key: `job:${job.id}`, title: job.employer, sub: [job.title, datesOf(job)].filter(Boolean).join(" · "), job, lines: job.lines });
      }
    } else if (section.tag === "profile" && state.about) {
      // #371: About you replaces the summary's lines with the text written from the whole CV — even
      // for a CV with no summary. Until the review wrote one, the summary shows as read, below.
      out.push({ kind: "about", key: "about", title: TITLES.profile!, sub: null, about: state.about });
    } else if (section.lines.length > 0) {
      out.push({ kind: "section", key: `section:${section.tag}`, title: TITLES[section.tag] ?? section.heading, sub: null, tag: section.tag, lines: section.lines });
    }
  }
  return out;
}

/** The cards on a screen the person must answer. None today. #378 counts a job's unanswered
 *  drafted lines, #380 its open removal suggestions — the lead sentence says how many. */
export function toAnswer(_screen: Screen): number {
  return 0;
}

/** What still holds the footer button on this screen, named as the button says it ("Answer X and
 *  Y to continue"). Empty today. #376 names each target market with no work-rights answer; #378
 *  and #380 add "the suggestion" / "the suggestions" after them. */
export function blockersOf(_screen: Screen): string[] {
  return [];
}

export function leadFor(screen: Screen): string {
  if (screen.kind === "details") return LEAD_DETAILS;
  if (screen.kind === "about") return LEAD_ABOUT;
  const n = toAnswer(screen);
  return n > 0 ? leadSuggestions(n) : LEAD_QUIET;
}

/** One screen's body. Add a screen kind here: #371 the About you card, #381 the details fields,
 *  #376 the Where you can work card above Additional information, #382 the skills groups. */
export function ScreenBody({ screen, list, aboutDraft }: { screen: Screen; list: Omit<ItemListProps, "lines">; aboutDraft: AboutDraft }): ReactNode {
  if (screen.kind === "about") return <AboutCard about={screen.about} {...aboutDraft} />;
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
  return (
    <div className="card">
      <ItemList lines={screen.lines} {...list} onEdit={editable ? list.onEdit : undefined} />
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
