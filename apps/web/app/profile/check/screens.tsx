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
import type { ContactField, ReviewJob, ReviewLine, ReviewState } from "../../../lib/api";
import { ItemList, type ItemListProps } from "./Item";

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
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} in gold below. Edit or remove anything else that's wrong.`;

export type Screen =
  | { kind: "details"; key: "details"; title: string; sub: null; letterhead: ReviewState["letterhead"] }
  | { kind: "job"; key: string; title: string; sub: string; job: ReviewJob; lines: ReviewLine[] }
  | { kind: "section"; key: string; title: string; sub: null; tag: string; lines: ReviewLine[] };

const datesOf = (job: ReviewJob) => (job.dates ? [job.dates.start, job.dates.end].filter(Boolean).join(" – ") : "");

export function screensOf(state: ReviewState): Screen[] {
  const out: Screen[] = [];
  if (Object.values(state.letterhead).some(Boolean)) out.push({ kind: "details", key: "details", title: C_DETAILS, sub: null, letterhead: state.letterhead });
  for (const section of state.sections) {
    if ("jobs" in section) {
      for (const job of section.jobs) {
        if (job.lines.length === 0) continue;
        out.push({ kind: "job", key: `job:${job.id}`, title: job.employer, sub: [job.title, datesOf(job)].filter(Boolean).join(" · "), job, lines: job.lines });
      }
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

export function ScreenBody({ screen, list, details }: { screen: Screen; list: Omit<ItemListProps, "lines">; details: DetailsProps }): ReactNode {
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
  return (
    <div className="card">
      <ItemList lines={screen.lines} {...list} />
    </div>
  );
}
