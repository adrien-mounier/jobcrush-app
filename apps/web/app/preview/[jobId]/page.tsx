"use client";

// JC-16 preview screen: the watermarked draft, rendered in a sandboxed iframe from the
// server's HTML (watermark is part of that render, not a UI overlay). Ends on the S2 hook —
// in S1 that's a notify-me button, which doubles as the tester-feedback channel.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobDisclosure, JobSnapshot } from "../../../lib/api";

// #154: one block per job. Two things live here and they are deliberately worded differently —
// facts held back are a CHOICE (relevance to this posting, explained as such), an over-full line is
// a FAULT of ours (compression), and explaining the fault as a choice is exactly what ADR-0004
// clause 1 forbids. "Your profile", never "your CV": on this screen "your CV" is the draft the
// person is looking at. Profile wording is printed whole, never trimmed to fit the panel.
function JobBlock({ d }: { d: JobDisclosure }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <p style={{ marginTop: 0, fontWeight: 600 }}>
        {d.employer}
        {d.role ? ` — ${d.role}` : ""}
      </p>
      <p className="lede" style={{ marginBottom: 12 }}>
        Your profile holds <strong>{d.factCount} facts</strong> about this job. They cannot all
        print at full length, so this draft prints the ones this job rewards most.
      </p>

      {d.heldBack.length > 0 && (
        <details style={{ marginBottom: 12 }}>
          <summary>
            <strong>
              {d.heldBack.length} {d.heldBack.length === 1 ? "fact is" : "facts are"} not printed
            </strong>{" "}
            — the ones that matter least for this job. Kept for when a job needs them. Show them
          </summary>
          <ul style={{ marginTop: 8 }}>
            {d.heldBack.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      {d.overfull.map((o) => (
        <div key={o.text} role="status" style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 6 }}>
            ⚠️ <strong>One printed line carries {o.count} facts at once</strong>
            {o.lostResult ? ", and states what none of them achieved:" : ":"}
          </p>
          <p style={{ margin: "0 0 8px", fontStyle: "italic" }}>“{o.text}”</p>
          <p className="lede" style={{ margin: "0 0 4px" }}>
            Your profile says:
          </p>
          <ul style={{ marginTop: 0 }}>
            {o.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}>
            {o.lostResult
              ? `We could not fit these ${o.count} facts and keep what they achieved. Check this line.`
              : `We packed ${o.count} facts from your profile into this line. A line carrying this much loses detail. Check it.`}
          </p>
        </div>
      ))}
    </section>
  );
}

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

      {html && posting?.disclosure?.map((d) => <JobBlock key={`${d.employer}-${d.role}`} d={d} />)}

      {/* #159's loss notices have been sent to this screen since it was built and rendered by it
          never — they only ever appeared on the wait screen, where they scroll past before the
          person has seen the CV. Anything the per-job block above does not already cover lands
          here. */}
      {html &&
        posting?.conservationNotices?.map((n) => (
          <p key={n} className="lede" style={{ marginTop: 16 }} role="status">
            {n}
          </p>
        ))}

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
