"use client";

// #303 / #291 door B, "its own room" — the screen the paste door opens. It takes the advert text and
// the application link SIDE BY SIDE: the link is asked up front, is optional, and is pre-filled when
// the pasted text carries one, so both answers to the link question arrive at once and neither
// blocks the read.
//
// #304 filled the right-hand column. While the advert is read he WATCHES THE WORK HAPPEN: three
// honestly named steps over the same job/progress stream the front door's CV read uses, with the
// requirements lifting out of his advert as they are read and nothing scored on screen before it
// has been read. An advert that comes back with no job gets a full failure screen naming what came
// back and what usually fixes it — with his text kept, because he pasted it deliberately and
// absence is not an option.
//
// Landing: that job's own screen, never back on the deck (#291 ruling 2). He asked for this job.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ensureSession,
  linkInText,
  pasteJob,
  type JobSnapshot,
  type PasteFailure,
  type PasteProgress,
  type PasteStep,
} from "../../lib/api";
import { PasteDoor } from "../pastedoor";
import "../deck.css";
import "./paste.css";

const H1 = "Paste a job you found";
const LEDE =
  "The whole advert, as you copied it. It is stored, read and scored like a job we found for you — it just came from you.";
const TA_LABEL = "The advert";
const TA_PLACEHOLDER = "Paste the advert…";
const LINK_LABEL = "Link of the application";
const LINK_HINT = "optional — it goes to the top of your application email";
const GO = "Read it";
const GOING = "Reading…";
const AGAIN = "Read it again";
const PANEL_H = "What this job asks for";
const PANEL_EMPTY =
  "Nothing yet. Paste the advert and this fills in as we read it — you will see what we found before anything is scored.";
const REQS_H = "What it asks for, in the advert's own words";
const REQS_WAIT = "Nothing read out of it yet.";

// The three steps, in the order the server runs them. The words are the spec's own and they are
// honest: each names work that is really happening while it is shown as happening.
const STEPS: Array<{ id: PasteStep; label: string }> = [
  { id: "reading", label: "Reading the advert" },
  { id: "employer", label: "Looking up the employer" },
  { id: "profile", label: "Checking it against your profile" },
];
const DONE_SR = "done";
const NOW_SR = "in progress";

const FAIL_H = "That did not come back as a job";
const FAIL_CAME = "What came back";
const FAIL_FIX = "What usually fixes it";
const FAIL_KEPT = "Your advert is still below, exactly as you pasted it. Nothing was lost.";
// Only ever seen when the read never reports at all — the connection dropped, or the request never
// left. Everything the server itself refuses arrives with its own two lines.
const FALLBACK_FAILURE: PasteFailure = {
  code: "no_answer",
  cameBack: "We never heard back about that read.",
  fix: "Press Read it again — your text is still here, and nothing was lost.",
};

const START: PasteProgress = { step: "reading", requirements: [], employer: null };
/** How long the whole read is given before the screen stops waiting and says so. Generous: a cold
 *  first read of a long advert is two model calls and a web search, and the honest answer to "this
 *  is slow" is to let it be slow. What it must never become is endless. */
const WAIT_CEILING_MS = 180_000;

export default function PasteScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PasteProgress | null>(null);
  const [failure, setFailure] = useState<PasteFailure | null>(null);
  // The pre-fill may only ever happen to a field he has not touched — once he types (or clears) it,
  // the answer is his. Tracked in a ref, not state: nothing renders differently because of it.
  const linkTouched = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef<HTMLHeadingElement>(null);
  const streamRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void ensureSession().catch(() => {});
    // Route-change focus (the house rule): he pressed a door to get here, so the room he opened is
    // what should be announced, not wherever focus happened to land.
    headingRef.current?.focus();
    // A stream left open past this screen goes on reconnecting for a read nobody is watching.
    return () => {
      streamRef.current?.close();
      clearTimeout(watchdogRef.current);
    };
  }, []);

  // A full screen that replaced what he was reading has to be announced and reachable, not just
  // rendered — the same route-change rule as the heading above, applied to a state change.
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  const onText = (value: string) => {
    setText(value);
    if (linkTouched.current) return;
    const found = linkInText(value);
    if (found) setLink(found);
  };

  const failWith = (why: PasteFailure) => {
    streamRef.current?.close();
    clearTimeout(watchdogRef.current);
    setFailure(why);
    setBusy(false);
  };

  const read = async () => {
    setBusy(true);
    setFailure(null);
    setProgress(START);
    // The ceiling on the whole wait, and it is the ONLY thing standing between him and a spinner
    // that never ends. The server guards its own crashes, but nothing on the server can report an
    // API that died mid-read or a stream the browser is still hopefully reconnecting to — and a
    // narrated wait with no end is worse than any failure screen.
    clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => failWith(FALLBACK_FAILURE), WAIT_CEILING_MS);
    try {
      const { jobId } = await pasteJob(text, link.trim() || null);
      // The front door's own stream, unchanged (apps/web/app/page.tsx): one event per update, the
      // current state replayed on connect, and closed by the server when the job is terminal — so
      // a read that finished before this attached still reports its outcome.
      const source = new EventSource(`/api/jobs/${jobId}/events`);
      streamRef.current = source;
      source.onmessage = (event) => {
        // A message this screen cannot read is a dead wait if it escapes: the handler unwinds, the
        // stream stays open, and nothing ever sets `busy` back.
        let snapshot: JobSnapshot;
        try {
          snapshot = JSON.parse(event.data) as JobSnapshot;
        } catch {
          failWith(FALLBACK_FAILURE);
          return;
        }
        const paste = snapshot.progress.paste;
        if (paste) setProgress(paste);
        if (snapshot.status === "completed" && paste?.result) {
          source.close();
          clearTimeout(watchdogRef.current);
          router.push(`/job/${encodeURIComponent(paste.result.adId)}`);
        } else if (snapshot.status === "completed" || snapshot.status === "failed") {
          failWith(paste?.failure ?? FALLBACK_FAILURE);
        }
      };
      source.onerror = () => {
        // EventSource reconnects by itself on a blip, and readyState is CONNECTING while it does —
        // so a dropped Wi-Fi second must not throw a failure screen at him. CLOSED means the
        // browser has given up. Everything the reconnect never recovers from is the ceiling above.
        if (source.readyState === EventSource.CLOSED) failWith(FALLBACK_FAILURE);
      };
    } catch (e) {
      failWith({ ...FALLBACK_FAILURE, cameBack: e instanceof Error ? e.message : FALLBACK_FAILURE.cameBack });
    }
  };

  const stepState = (id: PasteStep) => {
    if (!progress) return "todo";
    const at = STEPS.findIndex((step) => step.id === progress.step);
    const mine = STEPS.findIndex((step) => step.id === id);
    return mine < at ? "done" : mine === at ? "now" : "todo";
  };

  return (
    <div className={`jobdeck pastescreen${failure ? " failed" : ""}`}>
      <div className="topbar">
        <span className="wordmark">JobCrush</span>
        <span className="spacer" />
        <PasteDoor inert />
      </div>

      <div className="desk">
        <div className="head">
          <h1 tabIndex={-1} ref={headingRef}>
            {H1}
          </h1>
          <p className="lede">{LEDE}</p>
        </div>

        {/* No `role="alert"` on the block below: focus moves to its heading the moment it renders
            (the house route-change rule, applied to a state change that replaces the screen), and an
            alert region on the same node makes several screen readers say the whole thing twice. */}
        {failure && (
          <div className="failure" data-testid="paste-failure">
            <h2 tabIndex={-1} ref={failureRef}>
              {FAIL_H}
            </h2>
            <p className="came">
              <b>{FAIL_CAME}:</b> {failure.cameBack}
            </p>
            <p className="fix">
              <b>{FAIL_FIX}:</b> {failure.fix}
            </p>
            <p className="kept">{FAIL_KEPT}</p>
          </div>
        )}

        <div className="left">
          <label className="sr-only" htmlFor="advert">
            {TA_LABEL}
          </label>
          <textarea
            id="advert"
            className="ta"
            placeholder={TA_PLACEHOLDER}
            value={text}
            disabled={busy}
            onChange={(e) => onText(e.target.value)}
          />
          <div className="field">
            <label htmlFor="applylink">
              {LINK_LABEL} <i>— {LINK_HINT}</i>
            </label>
            <input
              id="applylink"
              type="url"
              placeholder="https://…"
              value={link}
              disabled={busy}
              onChange={(e) => {
                linkTouched.current = true;
                setLink(e.target.value);
              }}
            />
          </div>
          <button type="button" className="go" disabled={busy || text.trim().length === 0} onClick={read}>
            {busy ? GOING : failure ? AGAIN : GO}
          </button>
        </div>

        {!failure && (
          <div className="right" aria-live="polite">
            <h2>{PANEL_H}</h2>
            {!progress ? (
              <p className="empty">{PANEL_EMPTY}</p>
            ) : (
              <>
                <ol className="steps">
                  {STEPS.map((step) => {
                    const state = stepState(step.id);
                    return (
                      <li
                        key={step.id}
                        data-testid={`paste-step-${step.id}`}
                        data-state={state}
                        aria-current={state === "now" ? "step" : undefined}
                      >
                        <span className="mark" aria-hidden="true" />
                        {/* The label in an element of its own: the screen-reader suffix below is
                            part of the step's meaning and NOT part of its name, and a test that
                            reads the whole <li> cannot tell the two apart. */}
                        <span className="label">{step.label}</span>
                        {state !== "todo" && <span className="sr-only"> — {state === "done" ? DONE_SR : NOW_SR}</span>}
                      </li>
                    );
                  })}
                </ol>
                {/* What the employer lookup came back with. Shown rather than kept, so the step he
                    is made to wait for pays him back with something he did not know. */}
                {progress.employer && (
                  <p className="employer" data-testid="paste-employer">
                    {progress.employer}
                  </p>
                )}
                <h3>{REQS_H}</h3>
                {progress.requirements.length === 0 ? (
                  <p className="empty">{REQS_WAIT}</p>
                ) : (
                  <ul className="reqs" data-testid="paste-requirements">
                    {/* Keyed by position as well as text: an advert may state the same line twice,
                        and two identical keys is a React list that renders one of them. */}
                    {progress.requirements.map((requirement, index) => (
                      <li key={`${index}-${requirement}`}>{requirement}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
