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
const LEAD_QUIET = "Nothing to answer here. Edit or remove anything that's wrong.";
// #380: "below", not "in gold below" — a removal suggestion is coral.
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} below. Edit or remove anything else that's wrong.`;

export type Screen =
  | { kind: "details"; key: "details"; title: string; sub: null; letterhead: ReviewState["letterhead"] }
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
    } else if (section.lines.length > 0) {
      out.push({ kind: "section", key: `section:${section.tag}`, title: TITLES[section.tag] ?? section.heading, sub: null, tag: section.tag, lines: section.lines });
    }
  }
  return out;
}

/** A line's states that are a suggestion the person has not answered yet — the server's own set
 *  (cvReview.ts OPEN_SUGGESTION_STATES). #380: an item the review proposes to remove. #378 adds
 *  `drafted` here, nowhere else. */
const OPEN_SUGGESTION_STATES: ReadonlySet<ReviewLine["state"]> = new Set<ReviewLine["state"]>(["removal-suggested"]);

/** The cards on a screen the person must answer — the lead sentence says how many. */
export function toAnswer(screen: Screen): number {
  return screen.kind === "details" ? 0 : screen.lines.filter((l) => OPEN_SUGGESTION_STATES.has(l.state)).length;
}

/** What still holds the footer button on this screen, named as the button says it ("Answer X and
 *  Y to continue"). #376 names each target market with no work-rights answer, before the
 *  suggestions. */
export function blockersOf(screen: Screen): string[] {
  const open = toAnswer(screen);
  return open === 0 ? [] : [open === 1 ? "the suggestion" : "the suggestions"];
}

export function leadFor(screen: Screen): string {
  if (screen.kind === "details") return LEAD_DETAILS;
  const n = toAnswer(screen);
  return n > 0 ? leadSuggestions(n) : LEAD_QUIET;
}

/** One screen's body. Add a screen kind here: #371 the About you card, #381 the details fields,
 *  #376 the Where you can work card above Additional information, #382 the skills groups. */
export function ScreenBody({ screen, list }: { screen: Screen; list: Omit<ItemListProps, "lines"> }): ReactNode {
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
