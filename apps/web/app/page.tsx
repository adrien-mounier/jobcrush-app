"use client";

// #15 front door (screen 0): the invitation ("Answer questions. Collect jobs.") + Ready?, plus a
// bottom-anchored CV shortcut that skips straight into a mined draft. Both paths end on
// /discovery (#16's placeholder for now). Built to front-door-spec.md (Shape A of
// apps/web/prototypes/front-door-options.prototype.html) — see that doc for the full state
// machine, timings, and copy this file implements.
//
// The root is a fixed full-viewport dark layer (frontdoor.css) that paints over the global
// .brandbar without editing layout.tsx (spec §1) — it unmounts on navigation and normal chrome
// resumes on /discovery.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./frontdoor.css";
import { ensureSession, setStage, uploadCv, type JobSnapshot } from "../lib/api";

const L1 = "Answer questions.";
const L2 = "Collect jobs.";
const TYPE_SPEED = 36; // ms/char, per spec §5

const ALLOWED_EXT = [".pdf", ".docx", ".txt"];
const MAX_BYTES = 10 * 1024 * 1024;

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

// Writes `text` into `el` one character per tick, collecting each timeout in `bag` so a skip
// (tap-to-finish) can cancel mid-word. Ported from the prototype's `type()` helper.
function typeInto(
  el: HTMLElement | null,
  text: string,
  speed: number,
  bag: ReturnType<typeof setTimeout>[],
  done: () => void,
) {
  if (!el) {
    done();
    return;
  }
  let i = 0;
  const tick = () => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) bag.push(setTimeout(tick, speed));
    else done();
  };
  tick();
}

type CvState =
  | { phase: "idle" }
  | { phase: "reading"; feed: string[] }
  | { phase: "success" }
  | { phase: "error"; message: string };

export default function FrontDoor() {
  const router = useRouter();

  const l1Ref = useRef<HTMLSpanElement>(null);
  const l2Ref = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Every setTimeout the component schedules (typewriter, door-parting, the CV-read hold) lands
  // in this one bag, so a single unmount sweep cancels all of them regardless of which flow
  // started them (CODING_STANDARDS: effects clean up timers + SSE in teardown).
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [caretLine, setCaretLine] = useState<"l1" | "l2" | null>(null);
  const [revealed, setRevealed] = useState(false); // Ready?/Upload it stop being `inert`
  const [footnoteIn, setFootnoteIn] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [cv, setCv] = useState<CvState>({ phase: "idle" });

  // Typewriter + reveal + tap-to-finish + reduced-motion (spec §5, §6). useLayoutEffect (not
  // useEffect) so the reduced-motion branch paints the finished invitation before first paint
  // instead of flashing empty text then the full line.
  useLayoutEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const arrive = () => {
      setRevealed(true);
      timers.current.push(setTimeout(() => setFootnoteIn(true), 260));
    };

    // Shared by tap-anywhere, any keydown, and the reduced-motion branch: cancel everything
    // in-flight, show the finished invitation, reveal both controls at once, and stop listening
    // (so a later tap on Upload it / Ready? is never swallowed by this handler).
    const finish = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (l1Ref.current) l1Ref.current.textContent = L1;
      if (l2Ref.current) l2Ref.current.textContent = L2;
      setCaretLine(null);
      setRevealed(true);
      setFootnoteIn(true);
      document.removeEventListener("click", finish);
      document.removeEventListener("keydown", finish);
    };

    if (reduced) {
      finish();
      return;
    }

    document.addEventListener("click", finish);
    document.addEventListener("keydown", finish);

    setCaretLine("l1");
    typeInto(l1Ref.current, L1, TYPE_SPEED, timers.current, () => {
      timers.current.push(
        setTimeout(() => {
          setCaretLine("l2");
          typeInto(l2Ref.current, L2, TYPE_SPEED, timers.current, () => {
            timers.current.push(
              setTimeout(() => {
                setCaretLine(null);
                arrive();
              }, 300),
            );
          });
        }, 190),
      );
    });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      document.removeEventListener("click", finish);
      document.removeEventListener("keydown", finish);
    };
  }, []);

  // The control that led here (the file input / Upload it) is gone from view by the time an
  // error renders, so focus needs a deliberate new home rather than being left stranded on body.
  useEffect(() => {
    if (cv.phase === "error") errorRef.current?.focus();
  }, [cv.phase]);

  // Unmount safety net: close any live SSE connection outright (EventSource does not do this on
  // its own), on top of the typewriter effect's own listener/timer cleanup above.
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      timers.current.forEach(clearTimeout);
    };
  }, []);

  // Shared by both the Ready? path and the CV-success path (§7): fade Ready?/footnote out, part
  // the headline, then let the caller navigate. Plays in full every time — never short-circuited
  // to an instant navigate, reduced motion aside (the global rule collapses it to ~1ms there).
  const runDoorParting = () =>
    new Promise<void>((resolve) => {
      setRevealed(false);
      setFootnoteIn(false);
      timers.current.push(
        setTimeout(() => setSplitting(true), 130),
        setTimeout(resolve, 560),
      );
    });

  const pressReady = async () => {
    if (readyBusy) return;
    setReadyBusy(true);
    setReadyError(null);
    try {
      await ensureSession();
      await setStage("discovery");
      await runDoorParting();
      router.push("/discovery");
    } catch (e) {
      setReadyBusy(false);
      setReadyError(e instanceof Error ? e.message : "something went wrong — try again");
    }
  };

  const openJobStream = (jobId: string) => {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = source;
    source.onmessage = (event) => {
      const snapshot = JSON.parse(event.data) as JobSnapshot;
      if (snapshot.status === "completed") {
        source.close();
        eventSourceRef.current = null;
        setCv({ phase: "success" });
        // Fire the stage transition alongside the ~800ms confirmation beat rather than after it —
        // it's normally already settled by the time the hold ends, and we still await it below
        // before navigating, so the functional order (CV read -> discovery stage set -> navigate)
        // holds either way.
        const stagePromise = setStage("discovery").catch(() => {});
        timers.current.push(
          setTimeout(async () => {
            await stagePromise;
            await runDoorParting();
            router.push(`/discovery?job=${jobId}`);
          }, 800),
        );
      } else if (snapshot.status === "failed") {
        source.close();
        eventSourceRef.current = null;
        setCv({
          phase: "error",
          message:
            snapshot.error === "unparseable_cv"
              ? "That looks like a scanned image with no readable text — we never guess at those. Try a text-based file, or just answer the questions."
              : "Something went wrong reading that CV. Try another file, or just answer the questions.",
        });
      } else {
        setCv({ phase: "reading", feed: snapshot.progress.feed ?? [] });
      }
    };
    // EventSource auto-reconnects on its own (matches the progress/[jobId] pattern) — a hiccup
    // just pauses the feed until it resumes; no extra state or copy for it (not in spec §4).
    source.onerror = () => {};
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return; // dialog cancelled — stay idle, no change
    if (!hasAllowedExtension(file.name)) {
      setCv({ phase: "error", message: "That's not a file we can read — PDF, Word, or plain text." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setCv({ phase: "error", message: "That file's over 10 MB. Try a smaller PDF, Word, or text file." });
      return;
    }
    setCv({ phase: "reading", feed: [] });
    try {
      await ensureSession();
      const { jobId } = await uploadCv(file);
      openJobStream(jobId);
    } catch {
      setCv({ phase: "error", message: "Couldn't upload that — check your connection and try again." });
    }
  };

  return (
    <main className={`frontdoor${splitting ? " split" : ""}`} data-cv={cv.phase}>
      <div className="invite">
        <div className="stack">
          <p className="h">
            <span className="ln l1">
              <span className="gh">{L1}</span>
              <span className="tx" ref={l1Ref} />
              {caretLine === "l1" && <span className="caret" />}
            </span>
            <span className="ln l2 g">
              <span className="gh">{L2}</span>
              <span className="tx" ref={l2Ref} />
              {caretLine === "l2" && <span className="caret" />}
            </span>
          </p>
          <button
            type="button"
            className={`ready${revealed ? " in" : ""}`}
            inert={!revealed}
            // Gate the keyboard the same way the CSS gates the pointer while the CV is read/shown
            // (one active path) — otherwise Tab+Enter races a second navigation against the mine.
            disabled={readyBusy || cv.phase === "reading" || cv.phase === "success"}
            onClick={pressReady}
          >
            Ready?
          </button>
          {readyError && (
            <p className="err" role="alert">
              {readyError}
            </p>
          )}
        </div>
      </div>

      <div className={`footnote${footnoteIn ? " in" : ""}`}>
        {cv.phase === "idle" && (
          <p>
            Already have a CV?{" "}
            <button
              type="button"
              className="upload"
              inert={!revealed}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload it
            </button>{" "}
            and skip the questions it already answers.
          </p>
        )}
        {cv.phase === "reading" && (
          <div className="reading">
            <span className="dot" aria-hidden="true" />
            <p className="label">Reading your CV…</p>
            <ul className="feed" aria-live="polite" aria-label="What we're finding in your CV">
              {cv.feed.length === 0 ? (
                <li>Warming up…</li>
              ) : (
                cv.feed.slice(-3).map((line, i, arr) => (
                  <li key={line} style={{ opacity: 0.4 + (0.6 * (i + 1)) / arr.length }}>
                    {line}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        {cv.phase === "success" && (
          <p className="cvread" role="status" aria-live="assertive">
            CV read.
          </p>
        )}
        {cv.phase === "error" && (
          <div>
            <p className="err" role="alert" ref={errorRef} tabIndex={-1}>
              {cv.message}
            </p>
            <button type="button" className="retry" onClick={() => fileInputRef.current?.click()}>
              Try another
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onFile(file);
        }}
      />
    </main>
  );
}
