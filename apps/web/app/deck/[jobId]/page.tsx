"use client";

// JC-23 — the confirm deck. The user turns mined candidate claims into confirmed facts, then builds
// their verified root CV (JC-27) behind the mechanical gate (JC-31). Two tiers (JC-22): machine-touched
// claims get an individual yes/edit/remove card; verbatim claims batch by CV section with tap-to-remove.
//
// Interactions match the API's synchronous design: individual decisions save on the spot; batch
// keep/remove is local until "Build", which commits the batch then builds. No freeform editor — an
// edit becomes a user-authored, auto-confirmed claim (kickoff decision 7).
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  buildRootCv,
  confirmClaim,
  editClaim,
  ensureSession,
  openDeck,
  rejectClaim,
  type BuildResult,
  type DeckClaim,
} from "../../../lib/api";

export default function DeckScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const [claims, setClaims] = useState<DeckClaim[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // batch claims toggled off
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        const deck = await openDeck(jobId);
        setClaims(deck.claims);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open your deck");
      }
    })();
  }, [jobId]);

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

  const toggleBatch = (id: string) =>
    setRemoved((r) => {
      const next = new Set(r);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const undecided = individual.filter((c) => c.decision === "pending").length;

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      // Commit batch decisions now (kept → confirm, removed → reject), then build over the confirmed set.
      // ponytail: a call per batch claim; fine at deck sizes — a bulk endpoint only if decks grow big.
      for (const [, group] of batchBySection) {
        for (const c of group) {
          await (removed.has(c.id) ? rejectClaim(c.id) : confirmClaim(c.id));
        }
      }
      setBuilt(await buildRootCv());
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not build your CV");
    } finally {
      setBusy(false);
    }
  };

  if (error && !claims) return <main><p className="error">{error}</p></main>;
  if (!claims) return <main><p className="lede">Opening your deck…</p></main>;
  if (built) return <BuildOutcome result={built} onFix={() => setBuilt(null)} />;

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
            <div className="card" key={c.id}>
              {editing?.id === c.id ? (
                <>
                  <textarea
                    rows={3}
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
                  <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{c.text}</p>
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

      {error && <p className="error">{error}</p>}
      <button
        className="btn"
        style={{ marginTop: 12 }}
        onClick={build}
        disabled={busy || undecided > 0}
      >
        {busy ? "Building…" : "Build my verified CV"}
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

// The build result: a clean gate flips to `ready` and shows the master CV; a failing gate loops back
// with the reasons (each names a claim), never a dead end (kickoff decision 5).
function BuildOutcome({ result, onFix }: { result: BuildResult; onFix: () => void }) {
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
  return (
    <main style={{ maxWidth: 720 }}>
      <h1>You own your facts</h1>
      <p className="lede">
        Every line below traces to something you confirmed. This is your verified master CV.
      </p>
      <div className="card">
        {result.rootCv.markdown.split("\n").map((line, i) => {
          if (line.startsWith("## ")) return <h3 key={i}>{line.slice(3)}</h3>;
          if (line.startsWith("- ")) return <p key={i} style={{ margin: "4px 0" }}>• {line.slice(2)}</p>;
          if (line.startsWith("# ")) return null;
          return null;
        })}
      </div>
    </main>
  );
}
