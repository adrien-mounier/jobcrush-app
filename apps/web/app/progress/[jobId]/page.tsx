"use client";

// JC-15 parsing progress: a live SSE feed of real extracted facts — the wait is where
// trust is built (spec §5-4), so we show what the pipeline actually found, not a spinner.
// EventSource auto-reconnects; every message is a full job snapshot, so a reconnect is
// self-healing (no Last-Event-ID bookkeeping needed).
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobSnapshot } from "../../../lib/api";

export default function ProgressScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.onmessage = (event) => {
      setConnectionLost(false);
      const snapshot = JSON.parse(event.data) as JobSnapshot;
      setJob(snapshot);
      if (snapshot.status === "completed") {
        source.close();
        router.push(`/preview/${jobId}`);
      } else if (snapshot.status === "failed") {
        source.close();
      }
    };
    source.onerror = () => setConnectionLost(true);
    return () => source.close();
  }, [jobId, router]);

  const feed = job?.progress.feed ?? [];
  const failed = job?.status === "failed";
  const unparseable = failed && job?.error === "unparseable_cv";

  return (
    <main>
      <h1>Reading your CV…</h1>
      <p className="lede">
        {failed
          ? "We hit a snag."
          : "This usually takes a minute or two. Here's what we're finding:"}
      </p>

      <div className="card">
        {/* The wait is where trust is built — announce each newly-found fact to screen readers too. */}
        <ul className="feed" aria-live="polite" aria-label="What we're finding in your CV">
          {feed.length === 0 && <li>Warming up…</li>}
          {feed.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>

      {connectionLost && !failed && (
        <p className="lede" role="status">Connection hiccup — reconnecting automatically…</p>
      )}

      {unparseable && (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            That file looks like a scanned image with no selectable text — we never guess at
            those. Pasting your CV text works just as well:
          </p>
          <button className="btn" onClick={() => router.push("/paste")}>
            Paste my CV text
          </button>
        </div>
      )}
      {failed && !unparseable && (
        <div className="card">
          <p style={{ marginTop: 0 }} className="error" role="alert">
            Something went wrong while processing your CV.
          </p>
          <button className="btn" onClick={() => router.push("/import")}>
            Try again
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginLeft: 8 }}
            onClick={() => router.push("/paste")}
          >
            Paste text instead
          </button>
        </div>
      )}
      {!failed && (
        <p className="lede" suppressHydrationWarning>
          Started {Math.round((Date.now() - startedAt.current) / 1000)}s ago on this screen.
        </p>
      )}
    </main>
  );
}
