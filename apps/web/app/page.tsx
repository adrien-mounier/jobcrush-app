"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./frontdoor.css";
import {
  ensureSession,
  getSessionCheckpoint,
  saveImportResolution,
  saveSourceEntry,
  setStage,
  uploadCv,
  type ImportProof,
  type JobSnapshot,
  type SourceEntry,
} from "../lib/api";

const L1 = "Answer questions.";
const L2 = "Collect jobs.";
const TYPE_SPEED = 36;
const ALLOWED_EXT = [".pdf", ".docx", ".txt"];
const MAX_BYTES = 10 * 1024 * 1024;

type Choice = "cv" | "questions";
type CvState =
  | { phase: "idle" }
  | { phase: "reading"; slow: boolean }
  | { phase: "proof"; proof: ImportProof; restored?: boolean }
  | { phase: "error"; message: string };

function typeInto(
  el: HTMLElement | null,
  text: string,
  bag: ReturnType<typeof setTimeout>[],
  done: () => void,
) {
  if (!el) return done();
  let i = 0;
  const tick = () => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) bag.push(setTimeout(tick, TYPE_SPEED));
    else done();
  };
  tick();
}

export default function FrontDoor() {
  const l1Ref = useRef<HTMLSpanElement>(null);
  const l2Ref = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null);
  const readyErrorRef = useRef<HTMLDivElement>(null);
  const choiceErrorRef = useRef<HTMLDivElement>(null);
  const importHeadingRef = useRef<HTMLHeadingElement>(null);
  const conflictInputRef = useRef<HTMLInputElement>(null);
  const importErrorRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const openedFromInvitation = useRef(false);

  const [loading, setLoading] = useState(true);
  const [loadSlow, setLoadSlow] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<"invitation" | "source">("invitation");
  const [caretLine, setCaretLine] = useState<"l1" | "l2" | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyError, setReadyError] = useState(false);
  const [confirmedChoice, setConfirmedChoice] = useState<Choice | null>(null);
  const [visibleChoice, setVisibleChoice] = useState<Choice | null>(null);
  const [pendingChoice, setPendingChoice] = useState<Choice | null>(null);
  const [choiceError, setChoiceError] = useState<Choice | null>(null);
  const [cv, setCv] = useState<CvState>({ phase: "idle" });
  const [conflictValue, setConflictValue] = useState("");
  const [conflictError, setConflictError] = useState(false);
  const [importAction, setImportAction] = useState<"saving" | "continuing" | null>(null);
  const [importError, setImportError] = useState<"saving" | "continuing" | null>(null);

  const restore = async () => {
    setLoading(true);
    setLoadError(false);
    setLoadSlow(false);
    const slowTimer = setTimeout(() => setLoadSlow(true), 10_000);
    timers.current.push(slowTimer);
    try {
      const session = await getSessionCheckpoint();
      clearTimeout(slowTimer);
      if (session?.sourceEntry || session?.importProof) {
        setView("source");
        const choice = session.sourceEntry?.checkpoint === "source_selected"
          ? session.sourceEntry.choice
          : null;
        setConfirmedChoice(choice);
        setVisibleChoice(choice);
        if (session.importProof) {
          setConflictValue(session.importProof.conflict?.userResolvedValue ?? "");
          setCv({ phase: "proof", proof: session.importProof, restored: true });
        }
      } else {
        setView("invitation");
      }
      setLoading(false);
    } catch {
      clearTimeout(slowTimer);
      setLoadError(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    void restore();
    return () => {
      eventSourceRef.current?.close();
      timers.current.forEach(clearTimeout);
    };
    // Restore runs once on mount; retry calls it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (loading || loadError || view !== "invitation") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (l1Ref.current) l1Ref.current.textContent = L1;
      if (l2Ref.current) l2Ref.current.textContent = L2;
      setCaretLine(null);
      setRevealed(true);
      document.removeEventListener("click", finish);
      document.removeEventListener("keydown", finish);
    };
    if (reduced) {
      finish();
      return;
    }
    setRevealed(false);
    if (l1Ref.current) l1Ref.current.textContent = "";
    if (l2Ref.current) l2Ref.current.textContent = "";
    setCaretLine("l1");
    document.addEventListener("click", finish);
    document.addEventListener("keydown", finish);
    typeInto(l1Ref.current, L1, timers.current, () => {
      timers.current.push(
        setTimeout(() => {
          setCaretLine("l2");
          typeInto(l2Ref.current, L2, timers.current, () => {
            timers.current.push(setTimeout(finish, 300));
          });
        }, 190),
      );
    });
    return () => {
      document.removeEventListener("click", finish);
      document.removeEventListener("keydown", finish);
    };
  }, [loadError, loading, view]);

  useEffect(() => {
    if (view === "source" && openedFromInvitation.current) {
      sourceHeadingRef.current?.focus();
      openedFromInvitation.current = false;
    }
  }, [view]);

  const openSources = async () => {
    if (readyBusy) return;
    setReadyBusy(true);
    setReadyError(false);
    try {
      await ensureSession();
      await saveSourceEntry({ checkpoint: "invited", choice: null });
      openedFromInvitation.current = true;
      setView("source");
    } catch {
      setReadyError(true);
      setReadyBusy(false);
      requestAnimationFrame(() => readyErrorRef.current?.focus());
    }
  };

  const openJobStream = (jobId: string) => {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = source;
    source.onmessage = (event) => {
      const snapshot = JSON.parse(event.data) as JobSnapshot;
      if (snapshot.status === "completed") {
        source.close();
        const proof = snapshot.progress.importProof;
        setConflictValue(proof?.conflict?.userResolvedValue ?? "");
        setCv(
          proof
            ? { phase: "proof", proof }
            : { phase: "error", message: "We couldn’t read your CV." },
        );
      } else if (snapshot.status === "failed") {
        source.close();
        setCv({ phase: "error", message: "We couldn’t read your CV." });
      } else {
        setCv((current) => ({ phase: "reading", slow: current.phase === "reading" && current.slow }));
      }
    };
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
      setCv({ phase: "error", message: "That’s not a file I can read — use PDF, Word, or text." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setCv({ phase: "error", message: "That file is over 10 MB." });
      return;
    }
    setCv({ phase: "reading", slow: false });
    const slowTimer = setTimeout(() => {
      setCv((current) => current.phase === "reading" ? { phase: "reading", slow: true } : current);
    }, 10_000);
    timers.current.push(slowTimer);
    try {
      const { jobId } = await uploadCv(file);
      openJobStream(jobId);
    } catch {
      setCv({ phase: "error", message: "Couldn’t upload that — check your connection." });
    }
  };

  useEffect(() => {
    if (cv.phase !== "proof" && cv.phase !== "error") return;
    if (cv.phase === "proof" && cv.restored) return;
    importHeadingRef.current?.focus();
  }, [cv]);

  const continueToQuestions = async () => {
    if (importAction) return;
    setImportError(null);
    setImportAction("continuing");
    try {
      await setStage("discovery");
      window.location.assign("/discovery");
    } catch {
      setImportAction(null);
      setImportError("continuing");
      requestAnimationFrame(() => importErrorRef.current?.focus());
    }
  };

  const saveConflict = async (proof: ImportProof) => {
    if (!proof.conflict || importAction) return;
    const value = conflictValue.trim();
    if (!value) {
      setConflictError(true);
      conflictInputRef.current?.focus();
      return;
    }
    setConflictError(false);
    setImportError(null);
    setImportAction("saving");
    try {
      const result = await saveImportResolution(proof.conflict.fieldId, value);
      setCv({ phase: "proof", proof: result.importProof });
      await setStage("discovery");
      window.location.assign("/discovery");
    } catch {
      setImportAction(null);
      setImportError("saving");
      requestAnimationFrame(() => importErrorRef.current?.focus());
    }
  };

  const retryCv = () => fileInputRef.current?.click();

  const choose = async (choice: Choice) => {
    if (pendingChoice) return;
    setVisibleChoice(choice);
    setPendingChoice(choice);
    setChoiceError(null);
    try {
      const result = await saveSourceEntry({ checkpoint: "source_selected", choice });
      setConfirmedChoice(result.sourceEntry.choice);
      setVisibleChoice(result.sourceEntry.choice);
      setPendingChoice(null);
      if (choice === "cv") fileInputRef.current?.click();
    } catch {
      setVisibleChoice(confirmedChoice);
      setPendingChoice(null);
      setChoiceError(choice);
      requestAnimationFrame(() => choiceErrorRef.current?.focus());
    }
  };

  const busy = loading || readyBusy || pendingChoice !== null;

  return (
    <main
      className="frontdoor"
      data-testid="front-door"
      data-view={view}
      aria-busy={busy}
      data-cv={cv.phase}
    >
      {view === "invitation" ? (
        <div className="invite">
          <div className="stack">
            <p className="h">
              <span className="ln l1">
                <span className="gh">{L1}</span>
                <span className="tx" ref={l1Ref}>{loading || loadError ? L1 : ""}</span>
                {caretLine === "l1" && <span className="caret" />}
              </span>
              <span className="ln l2 g">
                <span className="gh">{L2}</span>
                <span className="tx" ref={l2Ref}>{loading || loadError ? L2 : ""}</span>
                {caretLine === "l2" && <span className="caret" />}
              </span>
            </p>
            {loading ? (
              <p className={loadSlow ? "restore restore-slow" : "sr-only"} aria-live="polite">
                {loadSlow ? "Restoring your progress is taking longer…" : "Restoring your progress…"}
              </p>
            ) : loadError ? (
              <div className="async-error" role="alert">
                We couldn’t restore your progress. <button onClick={() => void restore()}>Try again</button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={`ready${revealed ? " in" : ""}`}
                  disabled={!revealed || readyBusy}
                  onClick={() => void openSources()}
                >
                  {readyBusy ? "Opening…" : "Ready?"}
                </button>
                {readyError && (
                  <div className="async-error" role="alert" tabIndex={-1} ref={readyErrorRef}>
                    We couldn’t open this right now.{" "}
                    <button type="button" onClick={() => void openSources()}>Try again</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <section className="source-screen">
          <p className="wordmark">JobCrush</p>
          {cv.phase === "idle" ? (
            <>
              <h1 id="source-heading" tabIndex={-1} ref={sourceHeadingRef}>
                Can something you already have help?
              </h1>
              <p className="source-intro">A CV can skip questions you’ve already answered.</p>
              <div className="source-actions" role="group" aria-labelledby="source-heading" data-testid="source-actions">
            <SourceButton source="cv" title="Use my CV" subtitle="Upload PDF, Word, or text" selected={visibleChoice === "cv"} disabled={pendingChoice !== null} onClick={() => void choose("cv")} />
            <button type="button" className="source-action" data-source="linkedin" disabled aria-label="Use LinkedIn — Coming soon">
              <span className="source-tile">in</span>
              <span><strong>Use LinkedIn</strong><small>Profile import</small></span>
              <span className="trailing">Coming soon</span>
            </button>
            <SourceButton source="questions" title="Start questions instead" subtitle="Begin without a document" selected={visibleChoice === "questions"} disabled={pendingChoice !== null} onClick={() => void choose("questions")} />
              </div>
              <p className="temporary">
                No account needed. Your answers are temporary and expire after 7 days.
              </p>
              <div className="checkpoint" data-testid="source-checkpoint-status">
            {pendingChoice && <p role="status" aria-live="polite">Saving your choice…</p>}
            {choiceError && (
              <div role="alert" tabIndex={-1} ref={choiceErrorRef}>
                We couldn’t save that choice.{" "}
                <button type="button" onClick={() => void choose(choiceError)}>Try again</button>
              </div>
            )}
              </div>
            </>
          ) : (
            <ImportPanel
              cv={cv}
              headingRef={importHeadingRef}
              conflictInputRef={conflictInputRef}
              importErrorRef={importErrorRef}
              conflictValue={conflictValue}
              conflictError={conflictError}
              action={importAction}
              importError={importError}
              onConflictValue={(value) => {
                setConflictValue(value);
                setConflictError(false);
              }}
              onSave={(proof) => void saveConflict(proof)}
              onContinue={() => void continueToQuestions()}
              onRetry={retryCv}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onFile(file);
            }}
          />
        </section>
      )}
    </main>
  );
}

function ImportPanel({
  cv,
  headingRef,
  conflictInputRef,
  importErrorRef,
  conflictValue,
  conflictError,
  action,
  importError,
  onConflictValue,
  onSave,
  onContinue,
  onRetry,
}: {
  cv: Exclude<CvState, { phase: "idle" }>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  conflictInputRef: React.RefObject<HTMLInputElement | null>;
  importErrorRef: React.RefObject<HTMLDivElement | null>;
  conflictValue: string;
  conflictError: boolean;
  action: "saving" | "continuing" | null;
  importError: "saving" | "continuing" | null;
  onConflictValue: (value: string) => void;
  onSave: (proof: ImportProof) => void;
  onContinue: () => void;
  onRetry: () => void;
}) {
  if (cv.phase === "reading") {
    return (
      <div className="import-status" role="status" aria-live="polite" aria-busy="true">
        <h1>Reading your CV…</h1>
        <p>{cv.slow ? "This is taking longer than usual. Your CV progress is safe." : "Finding useful facts so you don’t repeat yourself."}</p>
      </div>
    );
  }

  const proof = cv.phase === "proof" ? cv.proof : null;
  const failed = cv.phase === "error" || proof?.outcome === "failed";
  const noUsefulFacts = proof?.outcome === "no_useful_facts";
  const partial = proof?.outcome === "partial";
  const conflict = proof
    && proof.outcome !== "failed"
    && proof.outcome !== "no_useful_facts"
    ? proof.conflict
    : null;
  const heading = failed
    ? "We couldn’t read your CV"
    : noUsefulFacts
      ? "We couldn’t find useful facts"
    : partial
      ? "We read part of your CV"
      : proof && proof.skippedQuestionCount === 0
        ? "Your CV gave us useful facts"
        : "Your CV saved you some questions";
  const body = cv.phase === "error"
    ? cv.message
    : failed
    ? "Your session is still here. Try your CV again, or continue without it."
    : noUsefulFacts
      ? "Try another CV, or continue with questions."
    : partial
      ? "The facts below are saved. We’ll ask only for missing information that matters."
      : proof && proof.skippedQuestionCount === 0
        ? "We’ll use them in the next step."
        : "We found information we can use in the next step.";

  return (
    <>
      <div className="import-status">
        <h1 tabIndex={-1} ref={headingRef}>{heading}</h1>
        <p role={failed && !(cv.phase === "proof" && cv.restored) ? "alert" : undefined}>{body}</p>
      </div>
      {proof && proof.outcome !== "failed" && proof.outcome !== "no_useful_facts" && (
        <div className="import-proof">
          <dl className="proof-metrics">
            <div><dd>{proof.usefulFactCount}</dd><dt>{proof.usefulFactCount === 1 ? "useful fact found" : "useful facts found"}</dt></div>
            <div><dd>{proof.skippedQuestionCount}</dd><dt>{proof.skippedQuestionCount === 1 ? "question skipped" : "questions skipped"}</dt></div>
          </dl>
          <ul className="proof-facts">
            {proof.representativeFacts.map((fact) => (
              <li key={fact.id}><span>From your CV</span>{fact.text}</li>
            ))}
          </ul>
          {conflict && (
            <div className="conflict">
              <label htmlFor="import-conflict">{conflict.label}</label>
              <input
                id="import-conflict"
                ref={conflictInputRef}
                value={conflictValue}
                onChange={(event) => onConflictValue(event.target.value)}
                aria-describedby="conflict-helper"
                aria-invalid={conflictError}
              />
              <p id="conflict-helper">Your answer will be used if you import this CV again.</p>
              {conflictError && <p role="alert">Enter your answer, or choose Answer later.</p>}
            </div>
          )}
        </div>
      )}
      <div className="import-actions">
        {failed || noUsefulFacts ? (
          <>
            <button type="button" className="primary" onClick={onRetry}>
              {noUsefulFacts ? "Try another CV" : "Try again"}
            </button>
            <button type="button" onClick={onContinue} disabled={action === "continuing"}>
              {action === "continuing" ? "Continuing…" : "Continue with questions"}
            </button>
          </>
        ) : conflict ? (
          <>
            <button type="button" className="primary" onClick={() => onSave(proof!)} disabled={action === "saving"}>
              {action === "saving" ? "Saving…" : "Save and continue"}
            </button>
            <button type="button" onClick={onContinue} disabled={action === "continuing"}>
              {action === "continuing" ? "Continuing…" : "Answer later"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary" onClick={onContinue} disabled={action === "continuing"}>
              {action === "continuing" ? "Continuing…" : "Ask me what’s missing"}
            </button>
            {partial && <button type="button" onClick={onRetry}>Try the CV again</button>}
          </>
        )}
      </div>
      {importError && (
        <div className="async-error" role="alert" tabIndex={-1} ref={importErrorRef}>
          {importError === "saving"
            ? "We couldn’t save your answer."
            : "We couldn’t continue right now."}{" "}
          <button
            type="button"
            onClick={importError === "saving" && proof ? () => onSave(proof) : onContinue}
          >
            Try again
          </button>
        </div>
      )}
    </>
  );
}

function SourceButton({
  source,
  title,
  subtitle,
  selected,
  disabled,
  onClick,
}: {
  source: Choice;
  title: string;
  subtitle: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="source-action"
      data-source={source}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="source-tile">{source === "cv" ? "CV" : "Q"}</span>
      <span><strong>{title}</strong><small>{subtitle}</small></span>
      <span className="trailing">{selected ? "Selected" : ""}</span>
    </button>
  );
}
