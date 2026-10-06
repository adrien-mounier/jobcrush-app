"use client";

// #338 — "Your CV, reviewed", layout C (owner decision 2026-10-05, recorded on #338): the CV itself,
// on paper, as it will print. Every part of the review is a mark on that paper; tapping a mark opens
// the one bottom sheet, where the person acts on it. This ticket builds the paper, the sheet, the
// letterhead check, line untick / kept / re-tick, the end-date and conflict pills, and the confirm —
// which is also exactly what the person sees when the AI review has failed (nothing says so). The
// AI's marks (fixes, suggestions, drafted lines, word choices) land on this same paper with
// #341/#342/#343. Copy is the prototype's own (apps/web/prototypes on branch prototype/cv-review-332).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import "../review.css";
import {
  answerReviewEndDate,
  completeReview,
  ensureSession,
  getReview,
  saveContact,
  setLineState,
  settleReviewConflict,
  type ProfileContactField,
  type ReviewJob,
  type ReviewLine,
  type ReviewState,
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
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Sheet =
  | { kind: "line"; line: ReviewLine }
  | { kind: "contact" }
  | { kind: "end"; job: ReviewJob }
  | { kind: "conflict" };

const checkCount = (state: ReviewState): number =>
  (state.conflict ? 1 : 0) +
  state.sections.reduce((n, s) => n + ("jobs" in s ? s.jobs.filter((j) => j.endDateQuestion).length : 0), 0);

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

export default function ReviewPage() {
  const router = useRouter();
  const [state, setState] = useState<ReviewState | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const next: ReviewLine = { ...line, state: line.state === "ticked" ? "kept" : "ticked" };
    void run(async () => {
      await setLineState(line.id, next.state);
      setState((s) => (s ? withLine(s, next) : s));
      close();
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
  const hasContent =
    state.letterhead.header !== null ||
    state.sections.some((s) => ("jobs" in s ? s.jobs.length > 0 : s.lines.length > 0));

  const lineButton = (line: ReviewLine) => (
    <li key={line.id} className={line.state === "kept" ? "kept" : undefined}>
      <button type="button" className="line" onClick={(e) => open({ kind: "line", line }, e.currentTarget)}>
        {line.state === "kept" && <span className="ktag">kept · </span>}
        {line.text}
      </button>
    </li>
  );

  return (
    <main className="review">
      <header className="rhead">
        <h1>{R1}</h1>
        <p className="lede">{R2}</p>
        <div className="chud">
          <span className="count" aria-live="polite">
            <b>{toCheck}</b> to check
          </span>
          {toCheck > 0 && (
            <button type="button" className="btn-s" onClick={nextMark}>
              {R3}
            </button>
          )}
        </div>
      </header>

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
                  <article key={job.id} className="pjob">
                    <div className="h">
                      <span className="t">{job.title}</span>
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
                    {job.lines.length > 0 && <ul>{job.lines.map(lineButton)}</ul>}
                  </article>
                ))}
              </section>
            );
          }
          if (section.lines.length === 0) return null;
          return (
            <section key={section.tag} className="psec" aria-label={section.heading}>
              <h5>{section.heading}</h5>
              <ul>{section.lines.map(lineButton)}</ul>
            </section>
          );
        })}
      </div>

      <footer className="foot">
        <p>{R15}</p>
        <button type="button" className="cta" disabled={busy} onClick={finish}>
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
            {sheet.kind === "line" && (
              <>
                <h2 id="sheet-title" tabIndex={-1}>
                  {sheet.line.state === "ticked" ? R7 : R8}
                </h2>
                <blockquote className="quote">{sheet.line.text}</blockquote>
                <button
                  type="button"
                  className={`btn-s${sheet.line.state === "kept" ? " gold" : ""}`}
                  disabled={busy}
                  onClick={() => toggleLine(sheet.line)}
                >
                  {sheet.line.state === "ticked" ? R9 : R10}
                </button>
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
