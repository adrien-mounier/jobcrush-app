"use client";

// JC-23 — the confirm deck. The user turns mined candidate claims into confirmed facts, then builds
// their verified root CV (JC-27) behind the mechanical gate (JC-31). Two tiers (JC-22): machine-touched
// claims get an individual yes/edit/remove card; verbatim claims batch by CV section with tap-to-remove.
//
// Interactions match the API's synchronous design: individual decisions save on the spot; batch
// keep/remove is local until "Build", which commits the batch then builds. No freeform editor — an
// edit becomes a user-authored, auto-confirmed claim (kickoff decision 7).
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  answerGrill,
  buildRootCv,
  confirmClaim,
  editClaim,
  ensureSession,
  openDeck,
  openGrill,
  rejectClaim,
  type BuildResult,
  type DeckClaim,
  type GrillQuestion,
} from "../../../lib/api";

export default function DeckScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const [claims, setClaims] = useState<DeckClaim[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // batch claims toggled off
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [grill, setGrill] = useState<GrillQuestion[] | null>(null); // set → grill phase
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        const deck = await openDeck(jobId);
        setClaims(deck.claims);
        // Rehydrate batch drops from the server so they survive a refresh / app-switch (the drops
        // persist on tap below). Kept-by-default claims stay off this set.
        setRemoved(
          new Set(deck.claims.filter((c) => c.tier === "batch" && c.decision === "rejected").map((c) => c.id)),
        );
      } catch (e) {
        if ((e as { code?: string }).code === "login_required") {
          localStorage.setItem("jc_job", jobId); // same-browser stash for the OAuth return
          router.replace(`/signup?job=${jobId}`); // …and on the link, so it survives a cross-browser open
          return;
        }
        setError(e instanceof Error ? e.message : "could not open your deck");
      }
    })();
  }, [jobId, router]);

  const individual = useMemo(() => (claims ?? []).filter((c) => c.tier === "individual"), [claims]);
  const batchBySection = useMemo(() => {
    const groups = new Map<string, DeckClaim[]>();
    for (const c of (claims ?? []).filter((c) => c.tier === "batch")) {
      const key = c.role === "profile" ? "About you" : c.role;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return [...groups.entries()];
  }, [claims]);

  const setDecision = (id: string, decision: DeckClaim["decision"], text?: string) =>
    setClaims((cs) =>
      (cs ?? []).map((c) => (c.id === id ? { ...c, decision, ...(text ? { text } : {}) } : c)),
    );

  const decideIndividual = async (id: string, kind: "confirm" | "reject") => {
    setError(null);
    try {
      await (kind === "confirm" ? confirmClaim(id) : rejectClaim(id));
      setDecision(id, kind === "confirm" ? "confirmed" : "rejected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save that");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null);
    try {
      await editClaim(editing.id, editing.text);
      setDecision(editing.id, "confirmed", editing.text);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save your edit");
    }
  };

  // Persist each batch keep/drop on tap (optimistic, revert on failure) so a refresh or app-switch
  // never loses a decision. confirm/reject are idempotent, so a re-tap is always safe.
  const toggleBatch = async (id: string) => {
    const willRemove = !removed.has(id);
    setError(null);
    setRemoved((r) => {
      const next = new Set(r);
      willRemove ? next.add(id) : next.delete(id);
      return next;
    });
    try {
      await (willRemove ? rejectClaim(id) : confirmClaim(id));
    } catch (e) {
      setRemoved((r) => {
        const next = new Set(r);
        willRemove ? next.delete(id) : next.add(id); // revert the optimistic toggle
        return next;
      });
      setError(e instanceof Error ? e.message : "could not save that");
    }
  };

  const undecided = individual.filter((c) => c.decision === "pending").length;

  // Drops are already persisted per-tap; here we only need to confirm the kept batch claims that were
  // never tapped (verbatim → kept by default), in parallel + idempotent, before looking for gaps.
  // ponytail: a call per kept claim; fine at deck sizes — a bulk endpoint only if decks grow big.
  const continueToGrill = async () => {
    setBusy(true);
    setError(null);
    try {
      const keptBatch = (claims ?? []).filter((c) => c.tier === "batch" && !removed.has(c.id));
      await Promise.all(keptBatch.map((c) => confirmClaim(c.id)));
      const g = await openGrill(jobId);
      if (g.questions.length > 0) setGrill(g.questions); // → grill phase
      else setBuilt(await buildRootCv()); // no gaps → straight to the CV
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not continue");
    } finally {
      setBusy(false);
    }
  };

  // Submit whatever the user answered (blank = skipped, never blocks), then build.
  const buildFromGrill = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const q of grill ?? []) {
        const a = answers[q.gapId]?.trim();
        if (a) await answerGrill(jobId, q.gapId, a);
      }
      setBuilt(await buildRootCv());
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not build your CV");
    } finally {
      setBusy(false);
    }
  };

  if (error && !claims)
    return (
      <main>
        <h1>This draft isn&apos;t available</h1>
        <p className="lede">
          We couldn&apos;t open it — it may have expired, or the link was incomplete. Upload your CV
          again to pick up where you left off.
        </p>
        <button className="btn" onClick={() => router.push("/import")}>
          Upload my CV
        </button>
      </main>
    );
  if (!claims) return <main><p className="lede">Opening your deck…</p></main>;
  if (built) return <BuildOutcome result={built} onFix={() => setBuilt(null)} onRebuilt={setBuilt} />;

  if (grill)
    return (
      <main style={{ maxWidth: 720 }}>
        <h1>A couple of quick questions</h1>
        <p className="lede">
          These fill small gaps we spotted in your CV. Answer what you can — skip anything you&apos;d
          rather not; nothing here is required.
        </p>
        {grill.map((q) => (
          <div className="card" data-testid="grill-question" key={q.gapId}>
            <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{q.question}</p>
            <input
              type="text"
              aria-label={q.question}
              placeholder="Your answer — or leave blank to skip"
              value={answers[q.gapId] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.gapId]: e.target.value }))}
            />
          </div>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" style={{ marginTop: 12 }} onClick={buildFromGrill} disabled={busy}>
          {busy ? "Building…" : "Build my verified CV"}
        </button>
      </main>
    );

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Confirm your facts</h1>
      <p className="lede">
        These came straight from your CV. Approve the ones that are right, fix any that aren&apos;t —
        then we build your verified master CV. Nothing you reject appears in it.
      </p>

      {individual.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.1rem" }}>Worth a closer look</h2>
          {individual.map((c) => (
            <div className="card" data-testid="individual-claim" key={c.id}>
              {editing?.id === c.id ? (
                <>
                  <textarea
                    rows={3}
                    aria-label="Edit this fact"
                    value={editing.text}
                    onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                  />
                  <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <button className="btn" onClick={saveEdit} disabled={editing.text.trim().length < 1}>
                      Save
                    </button>
                    <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ margin: "0 0 6px", fontWeight: 600 }} data-testid="claim-text">
                    {c.text}
                  </p>
                  <p className="lede" style={{ fontSize: "0.85rem", margin: "0 0 12px" }}>
                    From your CV: “{c.source_quote}”
                  </p>
                  {c.decision === "pending" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => decideIndividual(c.id, "confirm")}>
                        Looks right
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setEditing({ id: c.id, text: c.text })}
                      >
                        Edit
                      </button>
                      <button className="btn btn-secondary" onClick={() => decideIndividual(c.id, "reject")}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: "var(--jc-ink-muted)" }}>
                      {c.decision === "confirmed" ? "✓ Kept" : "Removed"} ·{" "}
                      <button
                        onClick={() => setDecision(c.id, "pending")}
                        style={{ background: "none", border: "none", color: "var(--jc-accent)", cursor: "pointer", padding: 0, font: "inherit" }}
                      >
                        change
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </>
      )}

      {batchBySection.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.1rem", marginTop: 24 }}>Straight from your CV</h2>
          <p className="lede">These we copied word-for-word. Tap any that don&apos;t belong to drop them.</p>
          {batchBySection.map(([section, group]) => (
            <div className="card" key={section}>
              <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{section}</p>
              <div>
                {group.map((c) => (
                  <button
                    key={c.id}
                    className="chip"
                    data-on={!removed.has(c.id)}
                    aria-pressed={!removed.has(c.id)}
                    onClick={() => toggleBatch(c.id)}
                    title={removed.has(c.id) ? "Dropped — tap to keep" : "Kept — tap to drop"}
                  >
                    {removed.has(c.id) ? "✕ " : ""}
                    {c.text}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <button
        className="btn"
        style={{ marginTop: 12 }}
        onClick={continueToGrill}
        disabled={busy || undecided > 0}
      >
        {busy ? "Working…" : "Continue"}
      </button>
      {undecided > 0 && (
        <p className="lede" style={{ marginTop: 8 }}>
          {undecided} claim{undecided === 1 ? "" : "s"} above still {undecided === 1 ? "needs" : "need"} a
          decision.
        </p>
      )}
    </main>
  );
}

// Evidence provenance → the shared badge palette (spec §5, tokens.css). A rendered line carries one
// classification today; if a future graph attaches several to a bullet, surface the least-grounded so
// the eye lands on what still needs a look.
const CLS_META: Record<string, { key: string; label: string }> = {
  Verified: { key: "verified", label: "Verified" },
  Derived: { key: "derived", label: "Derived" },
  "Partially-Supported": { key: "partial", label: "Partial" },
  "Unsupported-but-Plausible": { key: "suggested", label: "Suggested" },
  Negative: { key: "negative", label: "Negative" },
};
const CLS_RANK = ["Verified", "Derived", "Partially-Supported", "Unsupported-but-Plausible", "Negative"];
function evidenceBadge(classifications: string[]): { key: string; label: string } {
  let worst = classifications[0] ?? "Verified";
  for (const c of classifications) if (CLS_RANK.indexOf(c) > CLS_RANK.indexOf(worst)) worst = c;
  return CLS_META[worst] ?? { key: "verified", label: worst };
}

// The build result: a clean gate flips to `ready` and shows the master CV; a failing gate loops back
// with the reasons (each names a claim), never a dead end (kickoff decision 5).
//
// The ready screen is the root-CV REVIEW (kickoff decision 7): read-only rendering from the trace —
// every bullet keeps its claim pointer — with a "fix" affordance per line. A fix reopens the claim
// (edit → user-authored via the store, or remove → reject) and rebuilds, so the CV re-renders from
// verified facts. Never a freeform editor over the CV text itself.
function BuildOutcome({
  result,
  onFix,
  onRebuilt,
}: {
  result: BuildResult;
  onFix: () => void;
  onRebuilt: (r: BuildResult) => void;
}) {
  const [fixing, setFixing] = useState<{ nodeId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (result.stage !== "ready") {
    return (
      <main>
        <h1>Almost there</h1>
        <p className="lede">A couple of things need another look before we can certify your CV:</p>
        <div className="card">
          <ul>
            {result.gate.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
        <button className="btn" onClick={onFix}>
          Back to my facts
        </button>
      </main>
    );
  }

  // Group the trace entries by section, preserving render order.
  const sections: Array<[string, typeof result.rootCv.trace.entries]> = [];
  for (const e of result.rootCv.trace.entries) {
    const last = sections[sections.length - 1];
    if (last && last[0] === e.section) last[1].push(e);
    else sections.push([e.section, [e]]);
  }

  // The fix flows through the claims store, then the CV rebuilds (re-audited, re-gated).
  const applyFix = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onRebuilt(await buildRootCv());
      setFixing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not apply your fix");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 720 }}>
      <div className="verified-seal">✓ Verified · watermark removed</div>
      <h1>You own your facts</h1>
      <p className="lede">
        The watermark&apos;s off. This is your verified master CV — every line traces to a fact you
        confirmed, and nothing you didn&apos;t. It&apos;s yours to keep. Spot something off? Fix the
        fact behind the line and the CV re-renders.
      </p>

      <div className="badge-legend">
        <span>
          <span className="badge" data-cls="verified">Verified</span> word-for-word from your CV
        </span>
        <span>
          <span className="badge" data-cls="derived">Derived</span> reworded from it
        </span>
        <span>
          <span className="badge" data-cls="partial">Partial</span> worth a closer look
        </span>
      </div>

      <div className="card cv-doc" data-testid="rootcv">
        {sections.map(([section, entries]) => (
          <section key={section}>
            <h3>{section}</h3>
            {entries.map((e) => {
              const nodeId = e.nodeIds[0];
              if (fixing?.nodeId === nodeId)
                return (
                  <div key={nodeId} data-testid="fix-editor" style={{ margin: "8px 0" }}>
                    <textarea
                      rows={3}
                      aria-label="Edit this line"
                      value={fixing.text}
                      onChange={(ev) => setFixing({ nodeId, text: ev.target.value })}
                    />
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        disabled={busy || fixing.text.trim().length < 1}
                        onClick={() => applyFix(() => editClaim(nodeId, fixing.text))}
                      >
                        {busy ? "Rebuilding…" : "Save fix"}
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => applyFix(() => rejectClaim(nodeId))}
                      >
                        Remove this line
                      </button>
                      <button className="btn btn-secondary" disabled={busy} onClick={() => setFixing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              const badge = evidenceBadge(e.classifications);
              return (
                <div key={nodeId} className="cv-line" data-testid="cv-bullet">
                  <span className="badge" data-cls={badge.key} title={`${badge.label} — how we sourced this line`}>
                    {badge.label}
                  </span>
                  <span className="cv-line-text">{e.bullet}</span>
                  <button
                    className="cv-fix"
                    onClick={() => setFixing({ nodeId, text: e.bullet })}
                    title="Something wrong? Fix the fact behind this line."
                  >
                    fix
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="card" style={{ marginTop: 24 }}>
        <p style={{ marginTop: 0, fontWeight: 600 }}>What happens next</p>
        <p className="lede" style={{ marginBottom: 0 }}>
          We start matching this verified CV against live postings and bring back roles worth your
          time — tailored to the facts you just confirmed. That&apos;s rolling out now; you&apos;re at
          the front of the line.
        </p>
      </div>
    </main>
  );
}
