"use client";

// #310 — the Tailor ending's draft: the CV brain's document for THIS job, with the #154 disclosure
// panel re-homed beneath it (what the draft held back and why) and the conservation notices when it
// shipped lossy. Mounted when the queue empties (or "I'm done" is pressed); it starts the build,
// watches the same `/api/jobs/:id/events` stream the paste door uses (paste/page.tsx's own watch,
// ported), and reads the checkpointed draft — a reload or a return re-spends nothing server-side.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTailorDraft,
  requestTailorDraft,
  type JobDisclosure,
  type JobSnapshot,
  type TailorDraftView,
} from "../../lib/api";

const WAIT_CEILING_MS = 180_000;

const D1 = "Writing your CV for this job…";
const D2 = "This can take a minute. Every line comes from your own facts.";
// The fallback failure words, for the failures the server cannot narrate (the watchdog, a dead
// stream) — a server-reported failure carries its own plain words in the job record instead.
const D3 = "We could not finish writing this CV.";
const D4 = "Press Try again — everything you answered is saved, and nothing already done is re-done.";
const D5 = "Try again";
const D6 = "It is a full-page CV — scroll inside to read it all.";

type Phase =
  | { kind: "writing" }
  | { kind: "ready"; view: TailorDraftView }
  | { kind: "failed"; cameBack?: string; fix?: string };

// #154: one block per job. A choice (facts held back, explained as relevance to this posting) and a
// fault of ours (an over-full line, explained as compression) are worded differently on purpose —
// dressing the fault up as a choice is what ADR-0004 clause 1 forbids. "Your profile", never "your
// CV": on this screen "your CV" is the draft above. Profile wording prints whole, never trimmed.
function DisclosureBlock({ d }: { d: JobDisclosure }) {
  return (
    <section className="disclose">
      <p className="disclose-job">
        {d.employer}
        {d.role ? ` — ${d.role}` : ""}
      </p>
      <p className="disclose-lede">
        Your profile holds <strong>{d.factCount} facts</strong> about this job. They cannot all
        print at full length, so this draft prints the ones this job rewards most.
      </p>

      {d.heldBack.length > 0 && (
        <details>
          <summary>
            <strong>
              {d.heldBack.length} {d.heldBack.length === 1 ? "fact is" : "facts are"} not printed
            </strong>{" "}
            — the ones that matter least for this job. Kept for when a job needs them. Show them
          </summary>
          <ul>
            {/* Index keys throughout this static, render-once panel: two held-back facts (or two
                lint notices) can legitimately carry identical text, and a text key then collides
                (QA gate D3 — the dev overlay's error badge covered a real control). */}
            {d.heldBack.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      {d.overfull.map((o, i) => (
        <div key={i} className="disclose-overfull" role="status">
          <p>
            <strong>One printed line carries {o.count} facts at once</strong>
            {o.lostResult ? ", and states what none of them achieved:" : ":"}
          </p>
          <p className="disclose-line">“{o.text}”</p>
          <p className="disclose-lede">Your profile says:</p>
          <ul>
            {o.sources.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <p>
            {o.lostResult
              ? `We could not fit these ${o.count} facts and keep what they achieved. Check this line.`
              : `We packed ${o.count} facts from your profile into this line. A line carrying this much loses detail. Check it.`}
          </p>
        </div>
      ))}
    </section>
  );
}

export function TailorDraft() {
  const [phase, setPhase] = useState<Phase>({ kind: "writing" });
  const streamRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelledRef = useRef(false);

  const settle = useCallback((next: Phase) => {
    streamRef.current?.close();
    clearTimeout(watchdogRef.current);
    if (!cancelledRef.current) setPhase(next);
  }, []);

  const readDraft = useCallback(async () => {
    try {
      settle({ kind: "ready", view: await getTailorDraft() });
    } catch {
      settle({ kind: "failed" });
    }
  }, [settle]);

  const load = useCallback(async () => {
    setPhase({ kind: "writing" });
    // The ceiling on the whole wait — the only thing standing between him and a spinner that never
    // ends (paste/page.tsx's own rule, same number).
    clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => settle({ kind: "failed" }), WAIT_CEILING_MS);
    try {
      const started = await requestTailorDraft();
      // The checkpoint already matches the current facts — nothing to watch, nothing spent.
      if (started.ready || !started.jobId) return void (await readDraft());
      const source = new EventSource(`/api/jobs/${started.jobId}/events`);
      streamRef.current = source;
      source.onmessage = (event) => {
        let snapshot: JobSnapshot;
        try {
          snapshot = JSON.parse(event.data) as JobSnapshot;
        } catch {
          return settle({ kind: "failed" });
        }
        if (snapshot.status === "completed") void readDraft();
        else if (snapshot.status === "failed")
          settle({ kind: "failed", ...snapshot.progress.tailorDraft?.failure });
      };
      source.onerror = () => {
        // EventSource reconnects on a blip; CLOSED means the browser gave up (paste's rule).
        if (source.readyState === EventSource.CLOSED) settle({ kind: "failed" });
      };
    } catch {
      settle({ kind: "failed" });
    }
  }, [readDraft, settle]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
      streamRef.current?.close();
      clearTimeout(watchdogRef.current);
    };
  }, [load]);

  if (phase.kind === "writing") {
    return (
      <div className="draft draft-wait" role="status">
        <p className="draft-wait-line">{D1}</p>
        <p className="draft-wait-sub">{D2}</p>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div className="draft draft-fail">
        <p role="alert">{phase.cameBack ?? D3}</p>
        <p className="draft-wait-sub">{phase.fix ?? D4}</p>
        <button type="button" onClick={() => void load()}>
          {D5}
        </button>
      </div>
    );
  }

  const { view } = phase;
  return (
    <div className="draft">
      <iframe className="draft-frame" sandbox="" srcDoc={view.html} title="Your tailored CV" />
      <p className="draft-hint">{D6}</p>
      {view.disclosure.map((d) => (
        <DisclosureBlock key={`${d.employer}-${d.role}`} d={d} />
      ))}
      {view.conservationNotices.map((n, i) => (
        <p key={i} className="draft-notice" role="status">
          {n}
        </p>
      ))}
    </div>
  );
}
