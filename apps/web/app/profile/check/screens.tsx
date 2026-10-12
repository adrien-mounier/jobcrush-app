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
import type { ReviewJob, ReviewLine, ReviewState, ReviewWorkRights, WorkRightsAnswer } from "../../../lib/api";
import { ItemList, type ItemListProps } from "./Item";
import { LanguagesCard, WorkCard } from "./cards";

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
const LEAD_WORK = "Tell me where you can work.";
const LEAD_NO_LANGUAGES = "Your CV lists no languages. Tell me the ones you speak.";
const leadSuggestions = (n: number) => `${n === 1 ? "One suggestion" : `${n} suggestions`} in gold below. Edit or remove anything else that's wrong.`;

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
    } else {
      const extra = sectionExtras(state, section.tag, section.lines);
      if (section.lines.length > 0 || extra)
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
  if (tag === "lang" && lines.length === 0) return { languages: state.languages };
  return null;
}

/** The cards on a screen the person must answer. None today. #378 counts a job's unanswered
 *  drafted lines, #380 its open removal suggestions — the lead sentence says how many. */
export function toAnswer(_screen: Screen): number {
  return 0;
}

/** What still holds the footer button on this screen, named as the button says it ("Answer X and
 *  Y to continue"). #376: each target market with no work-rights answer, by name — a proposal from
 *  the CV is not an answer. #378 and #380 add "the suggestion" / "the suggestions" after them. */
export function blockersOf(screen: Screen): string[] {
  if (screen.kind !== "section" || !screen.workRights) return [];
  return screen.workRights.filter((r) => r.answer === null).map((r) => r.market);
}

export function leadFor(screen: Screen): string {
  if (screen.kind === "details") return LEAD_DETAILS;
  if (screen.kind === "section" && screen.workRights) return LEAD_WORK;
  if (screen.kind === "section" && screen.languages) return LEAD_NO_LANGUAGES;
  const n = toAnswer(screen);
  return n > 0 ? leadSuggestions(n) : LEAD_QUIET;
}

/** One screen's body. Add a screen kind here: #371 the About you card, #381 the details fields,
 *  #376 the Where you can work card above Additional information, #382 the skills groups. */
export interface CardAnswers {
  onWorkRights: (itemId: string, answer: WorkRightsAnswer) => void;
  onLanguages: (languages: string[]) => void;
}

export function ScreenBody({ screen, list, answers }: { screen: Screen; list: Omit<ItemListProps, "lines">; answers: CardAnswers }): ReactNode {
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
  const items =
    screen.lines.length > 0 ? (
      <div className="card">
        <ItemList lines={screen.lines} {...list} />
      </div>
    ) : null;
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
