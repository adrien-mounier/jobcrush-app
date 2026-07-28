"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./frontdoor.css";
import {
  ensureSession,
  getSourceEntry,
  saveSourceEntry,
  uploadCv,
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
  | { phase: "reading"; feed: string[] }
  | { phase: "success" }
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

  const restore = async () => {
    setLoading(true);
    setLoadError(false);
    setLoadSlow(false);
    const slowTimer = setTimeout(() => setLoadSlow(true), 10_000);
    timers.current.push(slowTimer);
    try {
      const entry = await getSourceEntry();
      clearTimeout(slowTimer);
      if (entry) {
        setView("source");
        const choice = entry.checkpoint === "source_selected" ? entry.choice : null;
        setConfirmedChoice(choice);
        setVisibleChoice(choice);
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
        setCv({ phase: "success" });
      } else if (snapshot.status === "failed") {
        source.close();
        setCv({ phase: "error", message: "Something went wrong reading that CV." });
      } else {
        setCv({ phase: "reading", feed: snapshot.progress.feed ?? [] });
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
    setCv({ phase: "reading", feed: [] });
    try {
      const { jobId } = await uploadCv(file);
      openJobStream(jobId);
    } catch {
      setCv({ phase: "error", message: "Couldn’t upload that — check your connection." });
    }
  };

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
            {cv.phase === "reading" && <p role="status">Reading your CV…</p>}
            {cv.phase === "success" && <p role="status">CV read.</p>}
            {cv.phase === "error" && <p role="alert">{cv.message}</p>}
          </div>
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
