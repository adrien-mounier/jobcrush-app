"use client";

// JC-16 preview screen: the watermarked draft, rendered in a sandboxed iframe from the
// server's HTML (watermark is part of that render, not a UI overlay). Ends on the S2 hook —
// in S1 that's a notify-me button, which doubles as the tester-feedback channel.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobSnapshot } from "../../../lib/api";

export default function PreviewScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const jobRes = await fetch(`/api/jobs/${jobId}`);
        if (!jobRes.ok) throw new Error("preview not found");
        if (cancelled) return;
        setJob(await jobRes.json());
        // The rendered HTML can lag the job's completion by a beat. Poll while the server says
        // "not_ready" instead of flashing a dead-end error the user can't act on; a real miss
        // (not_found) or any other failure stops immediately.
        for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
          const htmlRes = await fetch(`/api/previews/${jobId}`);
          if (htmlRes.ok) {
            const text = await htmlRes.text();
            if (!cancelled) setHtml(text);
            return;
          }
          const body = (await htmlRes.json().catch(() => ({}))) as { error?: { code?: string } };
          if (body.error?.code !== "not_ready") throw new Error("could not load the preview");
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!cancelled) throw new Error("your draft is taking longer than usual — refresh in a moment");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "could not load the preview");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const posting = job?.progress.preview;

  // If the job itself never loaded (stale/foreign preview URL → the API 401s a no-session tab or
  // 404s a job this session doesn't own), don't dress the dead-end up as a real draft. Mirror the
  // deck's "not available" screen. A loaded job with only slow HTML keeps the chrome below.
  if (error && !job)
    return (
      <main>
        <h1>This draft isn&apos;t available</h1>
        <p className="lede">
          We couldn&apos;t open it — it may have expired, or the link belongs to another session.
          Upload your CV to start a fresh draft.
        </p>
        <Link className="btn" href="/import">
          Upload my CV
        </Link>
      </main>
    );

  return (
    <main style={{ maxWidth: 860 }}>
      <h1>Your draft, tailored{posting ? ` for ${posting.postingCompany}` : ""}</h1>
      {posting && (
        <p className="lede">
          Written against a real posting: <strong>{posting.postingTitle}</strong> at{" "}
          <strong>{posting.postingCompany}</strong>. Every line came from your own CV.
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {!html && !error && <p className="lede">Loading your draft…</p>}
      {html && (
        <>
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
          <p className="lede mobile-hint" style={{ marginTop: 8, fontSize: "0.85rem" }}>
            It&apos;s a full-page CV — scroll inside to read it all.
          </p>
        </>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <p style={{ marginTop: 0, fontWeight: 600 }}>
          This is a draft — the facts aren&apos;t verified yet.
        </p>
        <p className="lede" style={{ marginBottom: 12 }}>
          Next step: confirm your facts to make this real — a quick review where you approve each
          claim, then the watermark comes off and you own a verified master CV.
        </p>
        <Link className="btn" href={`/job-blocks/${jobId}`}>
          Confirm my facts
        </Link>
        {/* Set the contract before the wall so it isn't a surprise. */}
        <p className="lede" style={{ margin: "10px 0 0", fontSize: "0.85rem" }}>
          Takes an email, no password — your draft saves to your account.
        </p>
      </div>
    </main>
  );
}
