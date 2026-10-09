"use client";

// #338 — "Your CV, reviewed", layout C (owner decision 2026-10-05, recorded on #338): the CV itself,
// on paper, as it will print. Every part of the review is a mark on that paper; tapping a mark opens
// the one bottom sheet, where the person acts on it. #338 built the paper, the sheet, the letterhead
// check, line untick / kept / re-tick, the end-date and conflict pills, and the confirm — which is
// also exactly what the person sees when the AI review has failed (nothing says so). #341 lays the
// AI's first marks on it: the progress card while the review runs (finished jobs open as they
// arrive, the confirm waits), the fix — corrected words in green, Undo / Use fix in the sheet — and
// the amber suggestion band with its one-sentence reason. #342 adds the drafted lines: a dashed gold
// box at the end of its job with a + to tick, its flags inline, its source under it without a tap,
// the full source and Edit in the sheet, and the COMPLETE ✓ stamp on a job with nothing missing.
// #343 adds the word choices: a vague phrase in an unticked draft wears a dotted gold underline, and
// a tap opens the draft's sheet on that phrase's choices — from the CV first, then typical, plus the
// person's own words. They came with the stored review, so nothing waits on the AI.
// #362: while a part of the CV has no review answer (still going, or given up), the counter never
// reads "0 to check" — that would claim a finished, clean check.
// Copy is the prototype's own (apps/web/prototypes on branch prototype/cv-review-332).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import "../review.css";
import {
  answerReviewEndDate,
  completeReview,
  ensureSession,
  getReview,
  saveContact,
  setDraftText,
  setFixApplied,
  setLineState,
  settleReviewConflict,
  tickDraft,
  type ProfileContactField,
  type ReviewJob,
  type ReviewLine,
  type ReviewState,
  type ReviewVague,
} from "../../lib/api";

const R1 = "Your CV, reviewed";
const R2 = "This is your CV as it will print. Tap a mark to check it.";
const R3 = "Next ↓";
const R4 = "↑ CHECK YOUR DETAILS";
const R5 = "Your details";
const R6 = "Check these. They go at the top of every CV.";
const R7 = "On your CV";
const R8 = "Kept, not on your CV";
const R9 = "Untick — keep it for when a job needs it";
const R10 = "Tick — put it back on my CV";
const R11 = "end date?";
const R12 = "Not sure";
const R13 = "Save";
const R14 = "I'm done — show my jobs";
const R15 = "You can come back to this page at any time.";
const R16 = "Without an end date, this job adds nothing to your years of experience.";
const R17 = "Couldn't save that — try again.";
const R18 = "Couldn't load your CV.";
const R19 = "Try again";
const R20 = "Loading your CV…";
const R21 = "Nothing was read from a CV yet.";
const R22 = "Edit";
const R23 = "Cancel";
const R24 = "Close";
const R25 = "Month";
const R26 = "Year";
// #341
const R27 = "Checking your CV…";
const R28 = "You can start with the parts that are ready.";
const R29 = "Still checking this job";
const R30 = "Your jobs open when the check is finished.";
const R31 = "We fixed a small mistake";
const R32 = "Undo";
const R33 = "Use fix";
const R34 = "Suggestion: untick this line.";
const R35 = "fixed";
const R36 = "suggestion";
// #342
const R37 = "new line";
const R38 = "New line, not on your CV yet";
const R39 = "Tick — put it on my CV";
const R40 = "Jobs like this ask:";
const R41 = "From your CV:";
const R42 = "This job is already complete.";
const R43 = "COMPLETE ✓";
const R44 = "new";
const R45 = "Why:";
// #343
const R46 = "choose a word";
const R47 = "From your CV";
const R48 = "Typical";
const R49 = "YOUR CV";
const R50 = "TYPICAL";
const R51 = "Your CV does not say.";
const R52 = "Or type your own";
const R53 = "Use";
const specificCopy = (phrase: string) => `Make "${phrase}" specific:`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** How often the screen re-reads the review while the run is going. */
const POLL_MS = 3000;

type Sheet =
  /** `phrase` (#343): the vague phrase the tap landed on — the sheet opens on its choices. */
  | { kind: "line"; line: ReviewLine; job: ReviewJob | null; phrase?: string }
  | { kind: "contact" }
  | { kind: "end"; job: ReviewJob }
  | { kind: "conflict" }
  | { kind: "complete"; job: ReviewJob };

const allLines = (state: ReviewState): ReviewLine[] =>
  state.sections.flatMap((s) => ("jobs" in s ? s.jobs.flatMap((j) => j.lines) : s.lines));
/** A suggestion is open while the line it is on is still ticked. */
const suggested = (line: ReviewLine) => line.suggestion !== null && line.state === "ticked";
const checkCount = (state: ReviewState): number =>
  (state.conflict ? 1 : 0) +
  state.sections.reduce((n, s) => n + ("jobs" in s ? s.jobs.filter((j) => j.endDateQuestion).length : 0), 0) +
  allLines(state).filter(suggested).length;
/** #342: the drafted lines the person has not ticked or kept — "to tick or leave". */
const newCount = (state: ReviewState): number => allLines(state).filter((l) => l.state === "drafted").length;
const hasMarks = (state: ReviewState) => allLines(state).some((l) => l.fix !== null || l.suggestion !== null || l.draft !== null);
const newLinesCopy = (n: number) => (n === 1 ? "1 new line is not ticked. It will not go on your CV." : `${n} new lines are not ticked. They will not go on your CV.`);
const askCopy = (family: string | null) => (family ? `${family} jobs ask:` : R40);

/** #343: a vague phrase where the line reads it — as the model wrote it, or as one of its choices
 *  the person picked (`set`), so a pick can be changed again. Words the person typed, or edited the
 *  phrase away with, are theirs: nothing is marked there. */
interface Spot {
  vague: ReviewVague;
  words: string;
  set: boolean;
}
/** A draft's text cut round its spots, in reading order. */
function segments(text: string, vague: ReviewVague[]): Array<string | Spot> {
  const found = vague
    .flatMap((v) => {
      const spot = [v.phrase, ...v.options.map((o) => o.text)]
        .map((words, i) => ({ vague: v, words, set: i > 0, at: text.indexOf(words) }))
        .find((s) => s.at >= 0);
      return spot ? [spot] : [];
    })
    .sort((a, b) => a.at - b.at);
  const out: Array<string | Spot> = [];
  let at = 0;
  for (const { at: start, ...spot } of found) {
    if (start < at) continue; // overlaps the spot before it
    out.push(text.slice(at, start), spot);
    at = start + spot.words.length;
  }
  out.push(text.slice(at));
  return out.filter((s) => s !== "");
}
/** The spots an unticked draft still has; a ticked draft is an ordinary line. */
const spotsOf = (line: ReviewLine): Spot[] =>
  line.state === "drafted" ? segments(line.text, line.draft?.vague ?? []).filter((s): s is Spot => typeof s !== "string") : [];

function withLine(state: ReviewState, line: ReviewLine): ReviewState {
  const swap = (l: ReviewLine) => (l.id === line.id ? line : l);
  return {
    ...state,
    sections: state.sections.map((s) =>
      "jobs" in s
        ? { ...s, jobs: s.jobs.map((j) => ({ ...j, lines: j.lines.map(swap) })) }
        : { ...s, lines: s.lines.map(swap) },
    ),
  };
}

/** The words a fix changed: the span between the longest common prefix and suffix of the two
 *  texts, widened to whole words — so a dropped letter ("accross" → "across") marks the word, not
 *  an empty span, and a reader sees which word moved. */
function changed(a: string, b: string): { prefix: string; from: string; to: string; suffix: string } {
  const ws = (c: string | undefined) => c === undefined || /\s/.test(c);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  let aEnd = a.length - end;
  let bEnd = b.length - end;
  while (start > 0 && !ws(b[start - 1])) start -= 1;
  while (!ws(a[aEnd])) aEnd += 1;
  while (!ws(b[bEnd])) bEnd += 1;
  return { prefix: b.slice(0, start), from: a.slice(start, aEnd), to: b.slice(start, bEnd), suffix: b.slice(bEnd) };
}

const minutesCopy = (n: number) => `About ${n} ${n === 1 ? "minute" : "minutes"} left. ${R28}`;
/** "Checking your CV… 1 of 3 jobs ready" — the count only when the paper has jobs to count (a CV
 *  with none is checked as one piece). */
const readyCopy = (done: number, total: number, hasJobs: boolean) =>
  hasJobs ? `${R27} ${done} of ${total} ${total === 1 ? "job" : "jobs"} ready` : R27;

export default function ReviewPage() {
  const router = useRouter();
  const [state, setState] = useState<ReviewState | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      await ensureSession();
      setState(await getReview());
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // While the run is going, re-read the review on a recursive timeout chain (never setInterval —
  // the deck's own rule): finished jobs open as they arrive, and the card goes when the run does. A
  // read that fails keeps the paper as it is and tries again on the next tick.
  const running = state?.progress !== null && state?.progress !== undefined;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(async () => {
      try {
        setState(await getReview());
      } catch {
        // the paper stays; the next tick re-reads
      } finally {
        setPollTick((n) => n + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [running, pollTick]);

  // One sheet at a time: focus moves in when it opens and returns to the mark that opened it.
  // Keyed to the committed sheet state, never a timer (CODING_STANDARDS, focus management).
  useEffect(() => {
    if (sheet) {
      sheetRef.current?.querySelector<HTMLElement>("h2")?.focus();
    } else {
      // The mark that opened the sheet may be gone by now — an answered date or a settled conflict
      // takes its pill off the paper — so focus lands on the paper itself rather than the body.
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
      else paperRef.current?.focus();
    }
  }, [sheet]);

  function open(next: Sheet, opener: HTMLElement) {
    openerRef.current = opener;
    setError(null);
    setSheet(next);
  }
  const close = () => setSheet(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(R17);
    } finally {
      setBusy(false);
    }
  }

  function toggleLine(line: ReviewLine) {
    const state = line.state === "ticked" ? "kept" : "ticked";
    const next: ReviewLine = { ...line, state };
    void run(async () => {
      await setLineState(line.id, state);
      setState((s) => (s ? withLine(s, next) : s));
      close();
    });
  }

  // Undo a fix, or use it again. The sheet stays open on the line, now reading the text the server
  // holds, so the person sees what they just did and can change their mind.
  function toggleFix(current: Extract<Sheet, { kind: "line" }>) {
    const { line } = current;
    if (!line.fix) return;
    const applied = !line.fix.applied;
    void run(async () => {
      const saved = await setFixApplied(line.id, applied);
      const next: ReviewLine = { ...line, text: saved.text, fix: { ...line.fix!, applied } };
      setState((s) => (s ? withLine(s, next) : s));
      setSheet({ ...current, line: next });
    });
  }

  // #342: the tick on a draft — it becomes an ordinary line on the paper, with its "new" tag.
  function tickDraftLine(line: ReviewLine) {
    void run(async () => {
      const saved = await tickDraft(line.id);
      setState((s) => (s ? withLine(s, { ...line, text: saved.text, state: "ticked" }) : s));
      close();
    });
  }

  // #342: the person's own wording for a draft, before the tick. The sheet stays open on it.
  function saveDraftText(current: Extract<Sheet, { kind: "line" }>, text: string) {
    void run(async () => {
      const saved = await setDraftText(current.line.id, text);
      const next: ReviewLine = { ...current.line, text: saved.text };
      setState((s) => (s ? withLine(s, next) : s));
      setSheet({ ...current, line: next });
    });
  }

  function nextMark() {
    const paper = paperRef.current;
    if (!paper) return;
    const marks = [...paper.querySelectorAll<HTMLElement>(".mark")];
    const cutoff = window.scrollY + 80;
    const target = marks.find((m) => m.getBoundingClientRect().top + window.scrollY > cutoff) ?? marks[0];
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  }

  function finish() {
    void run(async () => {
      await completeReview();
      router.push("/deck");
    });
  }

  if (failed) {
    return (
      <main className="review">
        <div className="loadstate" role="alert">
          <p>{R18}</p>
          <button type="button" className="btn-s" onClick={() => void load()}>
            {R19}
          </button>
        </div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="review">
        <div className="loadstate" aria-live="polite">
          <p>{R20}</p>
        </div>
      </main>
    );
  }

  const toCheck = checkCount(state);
  const toTick = newCount(state);
  // #362: nothing says why (never show the kitchen).
  const showCheck = toCheck > 0 || !state.unchecked;
  const hasContent =
    state.letterhead.header !== null ||
    state.sections.some((s) => ("jobs" in s ? s.jobs.length > 0 : s.lines.length > 0));

  // The line on the paper: a kept line grey, a fixed line with its corrected words marked green, a
  // suggested line on an amber band. Its accessible name is its text, whatever it wears.
  const lineText = (line: ReviewLine): ReactNode => {
    if (!line.fix?.applied) return line.text;
    const d = changed(line.fix.original, line.text);
    if (!d.to) return line.text; // a pure deletion leaves no word to mark
    return (
      <>
        {d.prefix}
        <mark className="fx">{d.to}</mark>
        {d.suffix}
      </>
    );
  };
  // #342: the flags a draft wears, inline, and its source under it — shown without a tap.
  const flags = (line: ReviewLine) => line.draft?.flags.map((f) => <span key={f} className="flag">{f}</span>);
  const sourceLine = (line: ReviewLine, job: ReviewJob | null) =>
    [line.draft?.mustHave ? `${askCopy(job?.family ?? null)} "${line.draft.mustHave}"` : null, line.draft?.quote ? `${R41} "${line.draft.quote}"` : null]
      .filter(Boolean)
      .join(" · ");
  const lineButton = (line: ReviewLine, job: ReviewJob | null) => {
    if (line.state === "drafted") {
      // The new-line box: a dashed gold outline at the end of the job, a + to tick it.
      return (
        <li key={line.id} className="nl">
          {/* A tap on a vague phrase opens the sheet on its choices; anywhere else, on the line. The
              phrase is a span, since a button cannot hold a button; the sheet offers the same
              phrases as buttons, so a keyboard reaches every choice. */}
          <button
            type="button"
            className="line mark"
            onClick={(e) => {
              const phrase = (e.target as HTMLElement).closest<HTMLElement>(".ph")?.dataset.phrase;
              open({ kind: "line", line, job, phrase }, e.currentTarget);
            }}
          >
            <span className="sr-only">{R37} · </span>
            {flags(line)}
            {segments(line.text, line.draft?.vague ?? []).map((s, i) =>
              typeof s === "string" ? (
                s
              ) : (
                <span key={i} className={`ph${s.set ? " set" : ""}`} data-phrase={s.vague.phrase}>
                  {s.words}
                </span>
              ),
            )}
          </button>
          <button type="button" className="plus" aria-label={R39} disabled={busy} onClick={() => tickDraftLine(line)}>
            +
          </button>
          <small className="src">{sourceLine(line, job)}</small>
        </li>
      );
    }
    const isSuggested = suggested(line);
    const classes = [line.state === "kept" ? "kept" : "", isSuggested ? "sg" : ""].filter(Boolean).join(" ");
    return (
      <li key={line.id} className={classes || undefined}>
        <button
          type="button"
          className={`line${isSuggested ? " mark" : ""}`}
          onClick={(e) => open({ kind: "line", line, job }, e.currentTarget)}
        >
          {line.state === "kept" && <span className="ktag">kept · </span>}
          {/* The band is amber on the paper; a reader who cannot see the colour hears the word. */}
          {isSuggested && <span className="sr-only">{R36} · </span>}
          {lineText(line)}
          {/* A ticked draft is an ordinary bullet with a small "new" tag. */}
          {line.draft && <span className="ntag"> {R44}</span>}
        </button>
      </li>
    );
  };

  return (
    <main className="review">
      <header className="rhead">
        <h1>{R1}</h1>
        <p className="lede">{R2}</p>
        <div className="chud">
          <span className="count" aria-live="polite">
            {showCheck && (
              <>
                <b>{toCheck}</b> to check
              </>
            )}
            {toTick > 0 && (
              <>
                {showCheck && " · "}
                <b>{toTick}</b> {toTick === 1 ? "new line" : "new lines"} to tick or leave
              </>
            )}
          </span>
          {toCheck + toTick > 0 && (
            <button type="button" className="btn-s" onClick={nextMark}>
              {R3}
            </button>
          )}
        </div>
        {(running || hasMarks(state)) && (
          <div className="legend">
            <span className="l1">{R35}</span>
            <span className="l2">{R36}</span>
            <span className="l3">{R37}</span>
            {allLines(state).some((l) => spotsOf(l).length > 0) && <span className="l4">{R46}</span>}
          </div>
        )}
      </header>

      {state.progress && (
        <div className="prog" role="status">
          <p>{readyCopy(state.progress.done, state.progress.total, state.sections.some((s) => "jobs" in s && s.jobs.length > 0))}</p>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${Math.max(8, Math.round((100 * state.progress.done) / Math.max(1, state.progress.total)))}%` }} />
          </div>
          <small>{minutesCopy(state.progress.minutesLeft)}</small>
        </div>
      )}

      <div className="paper" ref={paperRef} tabIndex={-1}>
        {!hasContent && <p className="empty">{R21}</p>}
        <button
          type="button"
          className="lhmark mark"
          aria-label={R5}
          onClick={(e) => open({ kind: "contact" }, e.currentTarget)}
        >
          {state.letterhead.header && <p className="lh">{state.letterhead.header}</p>}
          <p className="contact">
            {[state.letterhead.phone?.value, state.letterhead.email?.value].filter(Boolean).join(" · ")}
          </p>
        </button>
        <span className="lhnote" aria-hidden="true">
          {R4}
        </span>
        {state.conflict && (
          <p className="conflict">
            <button
              type="button"
              className="pill mark"
              aria-label={state.conflict.question}
              onClick={(e) => open({ kind: "conflict" }, e.currentTarget)}
            >
              {state.conflict.values.join(" or ")}?
            </button>
          </p>
        )}

        {state.sections.map((section) => {
          if ("jobs" in section) {
            if (section.jobs.length === 0) return null;
            return (
              <section key={section.tag} className="psec" aria-label={section.heading}>
                <h5>{section.heading}</h5>
                {section.jobs.map((job) => (
                  <article key={job.id} className={`pjob${job.checking ? " busy" : ""}`}>
                    <div className="h">
                      <span className="t">{job.title}</span>
                      {/* The stamp's name starts with its visible text (label-in-name), then says what it means. */}
                      {job.complete && (
                        <button type="button" className="stamp" aria-label={`${R43} ${R42}`} onClick={(e) => open({ kind: "complete", job }, e.currentTarget)}>
                          {R43}
                        </button>
                      )}
                      {job.dates && (
                        <span className="dt">
                          {job.dates.start} –{" "}
                          {job.dates.end ??
                            (job.endDateQuestion ? (
                              <button
                                type="button"
                                className="pill mark"
                                aria-label={job.endDateQuestion}
                                onClick={(e) => open({ kind: "end", job }, e.currentTarget)}
                              >
                                {R11}
                              </button>
                            ) : (
                              "?"
                            ))}
                        </span>
                      )}
                    </div>
                    {job.employer && <div className="e">{job.employer}</div>}
                    {job.checking && (
                      <span className="pchecking">
                        <span className="spin" aria-hidden="true" />
                        {R29}
                      </span>
                    )}
                    {job.lines.length > 0 && <ul>{job.lines.map((line) => lineButton(line, job))}</ul>}
                  </article>
                ))}
              </section>
            );
          }
          if (section.lines.length === 0) return null;
          return (
            <section key={section.tag} className="psec" aria-label={section.heading}>
              <h5>{section.heading}</h5>
              <ul>{section.lines.map((line) => lineButton(line, null))}</ul>
            </section>
          );
        })}
      </div>

      <footer className="foot">
        <p>{running ? R30 : `${toTick > 0 ? `${newLinesCopy(toTick)} ` : ""}${R15}`}</p>
        <button type="button" className="cta" disabled={busy || running} onClick={finish}>
          {R14}
        </button>
        {error && !sheet && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </footer>

      {sheet && (
        <>
          <div className="scrim" onClick={close} aria-hidden="true" />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            ref={sheetRef}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <button type="button" className="link close" onClick={close}>
              {R24}
            </button>
            {sheet.kind === "line" && sheet.line.state === "drafted" && (
              <DraftSheet
                key={sheet.line.id}
                line={sheet.line}
                job={sheet.job}
                phrase={sheet.phrase}
                busy={busy}
                onSave={(text) => saveDraftText(sheet, text)}
                onTick={() => tickDraftLine(sheet.line)}
              />
            )}
            {sheet.kind === "line" && sheet.line.state !== "drafted" && (
              <>
                <h2 id="sheet-title" tabIndex={-1}>
                  {sheet.line.state === "ticked" ? R7 : R8}
                </h2>
                <blockquote className="quote">{sheet.line.text}</blockquote>
                {sheet.line.draft && <DraftSource line={sheet.line} job={sheet.job} />}
                {sheet.line.fix && <FixRow line={sheet.line} busy={busy} onToggle={() => toggleFix(sheet)} />}
                {suggested(sheet.line) && (
                  <div className="sugg">
                    <b>{R34}</b> {sheet.line.suggestion!.reason}
                  </div>
                )}
                <button
                  type="button"
                  className={`btn-s${sheet.line.state === "kept" ? " gold" : suggested(sheet.line) ? " warn" : ""}`}
                  disabled={busy}
                  onClick={() => toggleLine(sheet.line)}
                >
                  {sheet.line.state === "ticked" ? R9 : R10}
                </button>
              </>
            )}
            {sheet.kind === "complete" && (
              <>
                <h2 id="sheet-title" tabIndex={-1}>
                  {R42}
                </h2>
                <p className="sub">Your lines already show everything {sheet.job.family} jobs ask for.</p>
              </>
            )}
            {sheet.kind === "contact" && (
              <>
                <h2 id="sheet-title" tabIndex={-1}>
                  {R5}
                </h2>
                <p className="sub">{R6}</p>
                {state.letterhead.header && <p className="asread">{state.letterhead.header}</p>}
                <ContactRow
                  field="phone"
                  label="Phone"
                  value={state.letterhead.phone}
                  onSaved={(v) => setState((s) => (s ? { ...s, letterhead: { ...s.letterhead, phone: v } } : s))}
                />
                <ContactRow
                  field="email"
                  label="Email"
                  value={state.letterhead.email}
                  onSaved={(v) => setState((s) => (s ? { ...s, letterhead: { ...s.letterhead, email: v } } : s))}
                />
              </>
            )}
            {sheet.kind === "end" && (
              <EndDateAsk
                job={sheet.job}
                busy={busy}
                onNotSure={close}
                onSave={(answer) =>
                  run(async () => {
                    await answerReviewEndDate(sheet.job.blockId!, answer);
                    setState(await getReview());
                    close();
                  })
                }
              />
            )}
            {sheet.kind === "conflict" && state.conflict && (
              <>
                <h2 id="sheet-title" tabIndex={-1}>
                  {state.conflict.question}
                </h2>
                <div className="choices">
                  {state.conflict.values.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="btn-s"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await settleReviewConflict(state.conflict!.fieldId, value);
                          setState(await getReview());
                          close();
                        })
                      }
                    >
                      {value}
                    </button>
                  ))}
                  <button type="button" className="link mute" onClick={close}>
                    {R12}
                  </button>
                </div>
              </>
            )}
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}

// #341: the fix, in the sheet — the words struck → corrected, and Undo (then Use fix).
function FixRow({ line, busy, onToggle }: { line: ReviewLine; busy: boolean; onToggle: () => void }) {
  const fix = line.fix!;
  const d = changed(fix.original, fix.corrected);
  return (
    <div className="fixrow">
      <p className="fixhead">{R31}</p>
      <p className="fixdiff">
        <s>{d.from || fix.original}</s> → <span className="to">{d.to || fix.corrected}</span>
      </p>
      <button type="button" className="link" disabled={busy} onClick={onToggle}>
        {fix.applied ? R32 : R33}
      </button>
    </div>
  );
}

// #342: a draft's source in full — its flags, why it was offered (the must-have, in the family's
// words), and the CV words it came from.
function DraftSource({ line, job }: { line: ReviewLine; job: ReviewJob | null }) {
  const draft = line.draft!;
  return (
    <div className="why">
      {draft.flags.length > 0 && (
        <p>
          {draft.flags.map((f) => (
            <span key={f} className="flag">
              {f}
            </span>
          ))}
        </p>
      )}
      {draft.mustHave && (
        <p>
          <b>{R45}</b> {askCopy(job?.family ?? null)} &quot;{draft.mustHave}&quot;
        </p>
      )}
      {draft.quote && (
        <p>
          <b>{R41}</b> &quot;{draft.quote}&quot;
        </p>
      )}
    </div>
  );
}

// #342: the sheet on a draft the person has not ticked: the line, its full source, Edit (the
// person's own wording, saved before the tick) and the tick. #343: its vague phrases are buttons in
// the quote; the open one shows its choices, and a choice or the person's own words replace the
// phrase through the same save as Edit.
function DraftSheet({
  line,
  job,
  phrase,
  busy,
  onSave,
  onTick,
}: {
  line: ReviewLine;
  job: ReviewJob | null;
  phrase?: string;
  busy: boolean;
  onSave: (text: string) => void;
  onTick: () => void;
}) {
  // Keyed by the line (the caller's `key`), so a save that lands a new `line.text` is shown by the
  // quote, and a different draft opens fresh; the box only ever holds this draft's wording.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const [openPhrase, setOpenPhrase] = useState<string | null>(phrase ?? null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  // The open phrase, while the line still reads it or a choice for it.
  const open = spotsOf(line).find((s) => s.vague.phrase === openPhrase);
  const inputId = `review-draft-${line.id}`;
  return (
    <>
      <h2 id="sheet-title" tabIndex={-1}>
        {R38}
      </h2>
      {editing ? (
        <form
          className="draftedit"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !busy) {
              onSave(draft.trim());
              setEditing(false);
            }
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {R38}
          </label>
          <textarea id={inputId} ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row">
            <button type="submit" className="btn-s gold" disabled={busy || !draft.trim()}>
              {R13}
            </button>
            <button type="button" className="link mute" onClick={() => setEditing(false)}>
              {R23}
            </button>
          </div>
        </form>
      ) : (
        <blockquote className="quote">
          {segments(line.text, line.draft?.vague ?? []).map((s, i) =>
            typeof s === "string" ? (
              s
            ) : (
              <button
                key={i}
                type="button"
                className={`ph${s.set ? " set" : ""}${openPhrase === s.vague.phrase ? " open" : ""}`}
                aria-expanded={openPhrase === s.vague.phrase}
                onClick={() => setOpenPhrase(openPhrase === s.vague.phrase ? null : s.vague.phrase)}
              >
                {s.words}
              </button>
            ),
          )}
        </blockquote>
      )}
      {!editing && open && (
        <WordChoices
          key={open.vague.phrase}
          vague={open.vague}
          busy={busy}
          onUse={(words) => {
            setOpenPhrase(null);
            onSave(line.text.replace(open.words, () => words));
          }}
        />
      )}
      <DraftSource line={line} job={job} />
      <div className="row">
        <button type="button" className="btn-s gold" disabled={busy} onClick={onTick}>
          {R39}
        </button>
        {!editing && (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {R22}
          </button>
        )}
      </div>
    </>
  );
}

// #343: one vague phrase's choices — the CV's first, then typical, each tagged — and the person's
// own words beside them.
function WordChoices({ vague, busy, onUse }: { vague: ReviewVague; busy: boolean; onUse: (words: string) => void }) {
  const [own, setOwn] = useState("");
  const cv = vague.options.filter((o) => o.from === "CV");
  const typical = vague.options.filter((o) => o.from === "TYPICAL");
  const chip = (o: ReviewVague["options"][number]) => (
    <button key={`${o.from}:${o.text}`} type="button" className={`chip ${o.from === "CV" ? "cv" : "typ"}`} disabled={busy} onClick={() => onUse(o.text)}>
      <span className="mk">{o.from === "CV" ? R49 : R50}</span>
      <span className="t">
        {o.text}
        {o.quote && <small>&quot;{o.quote}&quot;</small>}
      </span>
    </button>
  );
  return (
    <div className="wordchoices" role="group" aria-label={specificCopy(vague.phrase)}>
      <p className="ch-h">{specificCopy(vague.phrase)}</p>
      <p className="ch-g">{R47}</p>
      {cv.length ? cv.map(chip) : <p className="ch-none">{R51}</p>}
      {typical.length > 0 && (
        <>
          <p className="ch-g">{R48}</p>
          {typical.map(chip)}
        </>
      )}
      <form
        className="own"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim() && !busy) onUse(own.trim());
        }}
      >
        <input aria-label={R52} placeholder={R52} value={own} onChange={(e) => setOwn(e.target.value)} />
        <button type="submit" className="btn-s gold" disabled={busy || !own.trim()}>
          {R53}
        </button>
      </form>
    </div>
  );
}

// One letterhead field with its own Edit (#190's door, in the sheet). A "read" value is the CV's
// own; a saved one is the person's and permanently outranks a later re-read (ADR-0008 §3).
function ContactRow({
  field,
  label,
  value,
  onSaved,
}: {
  field: "phone" | "email";
  label: string;
  value: ProfileContactField | null;
  onSaved: (value: ProfileContactField) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `review-${field}`;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save() {
    const next = draft.trim();
    if (!next || saving) return;
    setSaving(true);
    setError(null);
    try {
      const record = await saveContact(field, next);
      onSaved(record[field] ?? { value: next, origin: "person-said" });
      setEditing(false);
    } catch {
      setError(R17);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lhrow">
      <span className="lbl">{label}</span>
      {editing ? (
        <form
          className="lhedit"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
          <input id={inputId} ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn-s gold" disabled={saving}>
            {R13}
          </button>
          <button type="button" className="link mute" onClick={() => setEditing(false)}>
            {R23}
          </button>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <span className="val">{value?.value ?? "—"}</span>
          <button type="button" className="link" aria-label={`${R22} ${label}`} onClick={() => setEditing(true)}>
            {R22}
          </button>
        </>
      )}
    </div>
  );
}

// "When did you leave {employer}?" — month optional, year required, and "Not sure", which stores
// nothing (it closes the sheet and sends no request).
function EndDateAsk({
  job,
  busy,
  onSave,
  onNotSure,
}: {
  job: ReviewJob;
  busy: boolean;
  onSave: (answer: string) => void;
  onNotSure: () => void;
}): ReactNode {
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const valid = /^\d{4}$/.test(year.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(month ? `${month} ${year.trim()}` : year.trim());
      }}
    >
      <h2 id="sheet-title" tabIndex={-1}>
        {job.endDateQuestion}
      </h2>
      <p className="sub">{R16}</p>
      <div className="dateask">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label={R25}>
          <option value="">{R25}</option>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input inputMode="numeric" placeholder={R26} aria-label={R26} value={year} onChange={(e) => setYear(e.target.value)} />
        <button type="submit" className="btn-s gold" disabled={busy || !valid}>
          {R13}
        </button>
      </div>
      <button type="button" className="link mute" onClick={onNotSure}>
        {R12}
      </button>
    </form>
  );
}
