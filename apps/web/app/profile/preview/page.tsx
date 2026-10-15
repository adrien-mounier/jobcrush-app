"use client";

// #390 (ADR-0019) — Preview as CV: the master CV as it would print, tailored as though the person
// were applying for their own job. The document is the server's render (the PDF's own), read-only
// in a sandboxed iframe; the wait is narrated over the same `/api/jobs/:id/events` stream every
// other wait uses (tailor/draft.tsx's own watch, ported); Download PDF is a plain link to the
// server's gated PDF door, so the browser's own download handles it.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "../../deck.css";
import "./preview.css";
import { ensureSession, getCvPreview, requestCvPreview, type CvPreviewView, type JobSnapshot } from "../../../lib/api";

const WAIT_CEILING_MS = 180_000;

const V1 = "Writing your CV…";
const V2 = "This can take a minute. Every line comes from your own profile.";
const V3 = "We could not finish writing this CV.";
const V4 = "Press Try again — nothing already done is re-done.";
const V5 = "Try again";
const V6 = "Download PDF";
const V7 = "‹ Back to your profile";
const V8 = "your CV";
const V9 = "It is a full-page CV — scroll inside to read it all.";

type Phase =
  | { kind: "writing" }
  | { kind: "ready"; view: CvPreviewView }
  | { kind: "failed"; cameBack?: string; fix?: string };

export default function CvPreviewPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "writing" });
  const streamRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelledRef = useRef(false);

  const settle = useCallback((next: Phase) => {
    streamRef.current?.close();
    clearTimeout(watchdogRef.current);
    if (!cancelledRef.current) setPhase(next);
  }, []);

  const read = useCallback(async () => {
    try {
      settle({ kind: "ready", view: await getCvPreview() });
    } catch {
      settle({ kind: "failed" });
    }
  }, [settle]);

  const load = useCallback(async () => {
    setPhase({ kind: "writing" });
    clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => settle({ kind: "failed" }), WAIT_CEILING_MS);
    try {
      await ensureSession();
      const started = await requestCvPreview();
      // The stored preview still matches the profile — nothing to watch, nothing spent.
      if (started.ready || !started.jobId) return void (await read());
      const source = new EventSource(`/api/jobs/${started.jobId}/events`);
      streamRef.current = source;
      source.onmessage = (event) => {
        let snapshot: JobSnapshot;
        try {
          snapshot = JSON.parse(event.data) as JobSnapshot;
        } catch {
          return settle({ kind: "failed" });
        }
        if (snapshot.status === "completed") void read();
        else if (snapshot.status === "failed") settle({ kind: "failed", ...snapshot.progress.tailorDraft?.failure });
      };
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) settle({ kind: "failed" });
      };
    } catch (err) {
      // A held door (409) carries the server's own line; the profile greys the door before this.
      settle({ kind: "failed", cameBack: err instanceof Error ? err.message : undefined });
    }
  }, [read, settle]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
      streamRef.current?.close();
      clearTimeout(watchdogRef.current);
    };
  }, [load]);

  return (
    <main className="cvpreview">
      <div className="topbar">
        <Link className="back" href="/profile">
          {V7}
        </Link>
        <span className="title">{V8}</span>
      </div>
      {phase.kind === "writing" && (
        <div className="preview-wait" role="status">
          <p className="preview-wait-line">{V1}</p>
          <p className="preview-sub">{V2}</p>
        </div>
      )}
      {phase.kind === "failed" && (
        <div className="preview-wait">
          <p role="alert">{phase.cameBack ?? V3}</p>
          <p className="preview-sub">{phase.fix ?? V4}</p>
          <button type="button" onClick={() => void load()}>
            {V5}
          </button>
        </div>
      )}
      {phase.kind === "ready" && (
        <div className="preview">
          <p className="preview-for">
            Tailored for <strong>{phase.view.job.title}</strong> at {phase.view.job.employer}.
          </p>
          <a className="preview-download" href="/api/profile/cv-preview/pdf" download>
            {V6}
          </a>
          <iframe className="preview-frame" sandbox="" srcDoc={phase.view.html} title="Your CV" />
          <p className="preview-sub">{V9}</p>
        </div>
      )}
    </main>
  );
}
