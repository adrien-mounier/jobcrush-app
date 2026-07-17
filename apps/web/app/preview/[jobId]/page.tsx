"use client";

// JC-16 preview screen: the watermarked draft, rendered in a sandboxed iframe from the
// server's HTML (watermark is part of that render, not a UI overlay). Ends on the S2 hook —
// in S1 that's a notify-me button, which doubles as the tester-feedback channel.
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobSnapshot } from "../../../lib/api";

export default function PreviewScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const jobRes = await fetch(`/api/jobs/${jobId}`);
        if (!jobRes.ok) throw new Error("preview not found");
        setJob(await jobRes.json());
        const htmlRes = await fetch(`/api/previews/${jobId}`);
        if (!htmlRes.ok) throw new Error("preview not ready yet");
        setHtml(await htmlRes.text());
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not load the preview");
      }
    })();
  }, [jobId]);

  const posting = job?.progress.preview;

  return (
    <main style={{ maxWidth: 860 }}>
      <h1>Your draft, tailored{posting ? ` for ${posting.postingCompany}` : ""}</h1>
      {posting && (
        <p className="lede">
          Written against a real posting: <strong>{posting.postingTitle}</strong> at{" "}
          <strong>{posting.postingCompany}</strong>. Every line came from your own CV.
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {!html && !error && <p className="lede">Loading your draft…</p>}
      {html && (
        <iframe
          sandbox=""
          srcDoc={html}
          title="Tailored CV draft"
          style={{
            width: "100%",
            height: "75vh",
            border: "1px solid var(--jc-line)",
            borderRadius: "var(--jc-radius-card)",
            background: "white",
          }}
        />
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <p style={{ marginTop: 0, fontWeight: 600 }}>
          This is a draft — the facts aren&apos;t verified yet.
        </p>
        <p className="lede" style={{ marginBottom: 12 }}>
          Next step: confirm your facts to make this real — a 2-minute review where you approve
          each claim, then the watermark comes off and the hunt begins. That part is almost
          ready.
        </p>
        {notified ? (
          <p style={{ margin: 0, color: "var(--jc-verified)" }}>
            Noted — you&apos;ll be first to know. Thanks for trying the preview!
          </p>
        ) : (
          <button className="btn" onClick={() => setNotified(true)}>
            Notify me when it opens
          </button>
        )}
      </div>
    </main>
  );
}
