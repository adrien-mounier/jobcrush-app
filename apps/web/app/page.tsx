"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "./frontdoor.css";
import {
  ensureSession,
  getIntent,
  getSessionCheckpoint,
  pasteCv,
  saveImportResolution,
  saveIntent,
  saveSourceEntry,
  setStage,
  uploadCv,
  type ImportProof,
  type IntentState,
  type JobSnapshot,
  type SourceEntry,
} from "../lib/api";
import { areaSuggestions, matchAreaText } from "../lib/areaMatch";
import { joinOxfordless as joinCoverage, lookForSentence } from "../lib/intentCopy";

const L1 = "Answer questions.";
const L2 = "Collect jobs.";
// #257: how long the "Got it." confirmation stays up before the hand-off to /discovery — the same
// sub-second bridge as discovery's own deck handoff (discovery/page.tsx).
const INTENT_HANDOFF_MS = 800;
const TYPE_SPEED = 36;
const ALLOWED_EXT = [".pdf", ".docx", ".txt"];
const MAX_BYTES = 10 * 1024 * 1024;
// #270: the paste route's own bounds (`z.string().min(100).max(100_000)` in routes/cv.ts), checked
// here so a person is told what is wrong instead of reading a 400. The floor is measured on the
// TRIMMED text (whitespace is not a CV); the ceiling on the RAW text, which is what the server counts.
const MIN_PASTE_CHARS = 100;
const MAX_PASTE_CHARS = 100_000;

// #184 (#172): the coverage list rendered in the early-access line — Oxford-less; the joining rule
// itself moved to lib/intentCopy.ts (#257) so this file and discovery's persistent confirmation
// line can never drift apart. The list always comes from the resolved response, never hard-coded.

type Choice = "cv" | "questions";
// #270: what the person picked ON THIS SCREEN. "cv" and "paste" are two doors into the same read, so
// both save the server's `cv` choice — a person who pastes is not a different kind of visitor
// downstream. Only the tile highlight and what happens next differ, and a restored session (which
// only ever knew "cv") comes back on the file tile.
type Source = Choice | "paste";
type CvState =
  | { phase: "idle" }
  | { phase: "paste"; text: string; error: string | null }
  | { phase: "reading"; slow: boolean }
  | { phase: "proof"; proof: ImportProof; restored?: boolean }
  | { phase: "error"; message: string };

function typeInto(
  el: HTMLElement | null,
  text: string,
  bag: ReturnType<typeof setTimeout>[],
  done: () => void,
) {
  if (!el) return done();
  let i = 0;
  const tick = () => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) bag.push(setTimeout(tick, TYPE_SPEED));
    else done();
  };
  tick();
}

export default function FrontDoor() {
  const l1Ref = useRef<HTMLSpanElement>(null);
  const l2Ref = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null);
  const readyErrorRef = useRef<HTMLDivElement>(null);
  const choiceErrorRef = useRef<HTMLDivElement>(null);
  const importHeadingRef = useRef<HTMLHeadingElement>(null);
  const conflictInputRef = useRef<HTMLInputElement>(null);
  const importErrorRef = useRef<HTMLDivElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  // #270: the tile that opened the paste view, so closing it returns focus where it came from.
  const pasteTileRef = useRef<HTMLButtonElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const openedFromInvitation = useRef(false);

  const [loading, setLoading] = useState(true);
  const [loadSlow, setLoadSlow] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<"invitation" | "source" | "intent">("invitation");
  const [caretLine, setCaretLine] = useState<"l1" | "l2" | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyError, setReadyError] = useState(false);
  const [confirmedChoice, setConfirmedChoice] = useState<Source | null>(null);
  const [visibleChoice, setVisibleChoice] = useState<Source | null>(null);
  const [pendingChoice, setPendingChoice] = useState<Source | null>(null);
  const [choiceError, setChoiceError] = useState<{ choice: Source; saved: boolean } | null>(null);
  const [cv, setCv] = useState<CvState>({ phase: "idle" });
  const [conflictValue, setConflictValue] = useState("");
  const [conflictError, setConflictError] = useState(false);
  const [importAction, setImportAction] = useState<"saving" | "continuing" | null>(null);
  const [importError, setImportError] = useState<"saving" | "continuing" | null>(null);
  const [intent, setIntent] = useState<IntentState | null>(null);
  const [intentFresh, setIntentFresh] = useState(false);
  const [intentLoadError, setIntentLoadError] = useState(false);

  const openIntent = async (fresh: boolean) => {
    setIntentLoadError(false);
    setIntentFresh(fresh);
    setView("intent");
    try {
      setIntent(await getIntent());
    } catch {
      setIntentLoadError(true);
    }
  };

  const advanceToIntent = async (fresh: boolean) => {
    await setStage("discovery");
    await openIntent(fresh);
  };

  const restore = async () => {
    setLoading(true);
    setLoadError(false);
    setLoadSlow(false);
    const slowTimer = setTimeout(() => setLoadSlow(true), 10_000);
    timers.current.push(slowTimer);
    try {
      const session = await getSessionCheckpoint();
      clearTimeout(slowTimer);
      if (session?.sourceEntry || session?.importProof) {
        setView("source");
        const choice = session.sourceEntry?.checkpoint === "source_selected"
          ? session.sourceEntry.choice
          : null;
        setConfirmedChoice(choice);
        setVisibleChoice(choice);
        if (session.stage === "discovery") {
          await openIntent(false);
        } else if (session.importProof) {
          setConflictValue(session.importProof.conflict?.userResolvedValue ?? "");
          setCv({ phase: "proof", proof: session.importProof, restored: true });
        } else if (choice === "questions") {
          await openIntent(false);
        }
      } else {
        setView("invitation");
      }
      setLoading(false);
    } catch {
      clearTimeout(slowTimer);
      setLoadError(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    void restore();
    return () => {
      eventSourceRef.current?.close();
      timers.current.forEach(clearTimeout);
    };
    // Restore runs once on mount; retry calls it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (loading || loadError || view !== "invitation") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (l1Ref.current) l1Ref.current.textContent = L1;
      if (l2Ref.current) l2Ref.current.textContent = L2;
      setCaretLine(null);
      setRevealed(true);
      document.removeEventListener("click", finish);
      document.removeEventListener("keydown", finish);
    };
    if (reduced) {
      finish();
      return;
    }
    setRevealed(false);
    if (l1Ref.current) l1Ref.current.textContent = "";
    if (l2Ref.current) l2Ref.current.textContent = "";
    setCaretLine("l1");
    document.addEventListener("click", finish);
    document.addEventListener("keydown", finish);
    typeInto(l1Ref.current, L1, timers.current, () => {
      timers.current.push(
        setTimeout(() => {
          setCaretLine("l2");
          typeInto(l2Ref.current, L2, timers.current, () => {
            timers.current.push(setTimeout(finish, 300));
          });
        }, 190),
      );
    });
    return () => {
      document.removeEventListener("click", finish);
      document.removeEventListener("keydown", finish);
    };
  }, [loadError, loading, view]);

  useEffect(() => {
    if (view === "source" && openedFromInvitation.current) {
      sourceHeadingRef.current?.focus();
      openedFromInvitation.current = false;
    }
  }, [view]);

  const openSources = async () => {
    if (readyBusy) return;
    setReadyBusy(true);
    setReadyError(false);
    try {
      await ensureSession();
      await saveSourceEntry({ checkpoint: "invited", choice: null });
      openedFromInvitation.current = true;
      setView("source");
    } catch {
      setReadyError(true);
      setReadyBusy(false);
      requestAnimationFrame(() => readyErrorRef.current?.focus());
    }
  };

  const openJobStream = (jobId: string) => {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = source;
    source.onmessage = (event) => {
      const snapshot = JSON.parse(event.data) as JobSnapshot;
      // #270: a finished job is read the same way whether it succeeded or failed. An unreadable scan
      // ends `failed` WITH a proof, and that proof is what carries the "paste the text instead"
      // guidance — discarding it here for a bare one-liner meant the advice only ever appeared after
      // a reload, i.e. never, for the person who most needs it.
      if (snapshot.status === "completed" || snapshot.status === "failed") {
        source.close();
        const proof = snapshot.progress.importProof;
        setConflictValue(proof?.conflict?.userResolvedValue ?? "");
        setCv(
          proof
            ? { phase: "proof", proof }
            : { phase: "error", message: "We couldn’t read your CV." },
        );
      } else {
        setCv((current) => ({ phase: "reading", slow: current.phase === "reading" && current.slow }));
      }
    };
  };

  // #270: one place starts a read, whichever door the CV came through — the same "this is taking
  // longer" timer and the same hand-off to the job stream. Only the send and the failure copy differ.
  const startRead = async (send: () => Promise<{ jobId: string }>, onFail: () => void) => {
    setCv({ phase: "reading", slow: false });
    const slowTimer = setTimeout(() => {
      setCv((current) => current.phase === "reading" ? { phase: "reading", slow: true } : current);
    }, 10_000);
    timers.current.push(slowTimer);
    try {
      const { jobId } = await send();
      openJobStream(jobId);
    } catch {
      clearTimeout(slowTimer);
      onFail();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
      setCv({ phase: "error", message: "That’s not a file I can read — use PDF, Word, or text." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setCv({ phase: "error", message: "That file is over 10 MB." });
      return;
    }
    await startRead(
      () => uploadCv(file),
      () => setCv({ phase: "error", message: "Couldn’t upload that — check your connection." }),
    );
  };

  // #270: pasted text takes the same road as an uploaded file — the same job, the same event stream,
  // the same proof screen. The only difference is where the bytes came from.
  const openPaste = () => setCv({ phase: "paste", text: "", error: null });

  const submitPaste = async () => {
    if (cv.phase !== "paste") return;
    const { text } = cv;
    // Every refusal below hands the text back untouched — nothing here may cost them their typing.
    const refuse = (error: string) => {
      setCv({ phase: "paste", text, error });
      pasteRef.current?.focus();
    };
    if (text.trim().length < MIN_PASTE_CHARS) {
      return refuse(
        `That looks too short to be a CV. Paste the whole thing — at least ${MIN_PASTE_CHARS} characters.`,
      );
    }
    if (text.length > MAX_PASTE_CHARS) {
      return refuse("That’s more text than we can read at once — paste your CV on its own.");
    }
    await startRead(
      () => pasteCv(text),
      () => refuse("We couldn’t send that — check your connection."),
    );
  };

  useEffect(() => {
    if (cv.phase !== "proof" && cv.phase !== "error") return;
    if (cv.phase === "proof" && cv.restored) return;
    importHeadingRef.current?.focus();
  }, [cv]);

  useEffect(() => {
    if (cv.phase === "paste") pasteRef.current?.focus();
    // Entering the paste view is the only time focus moves; typing must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv.phase]);

  const continueToQuestions = async () => {
    if (importAction) return;
    setImportError(null);
    setImportAction("continuing");
    try {
      await advanceToIntent(true);
      setImportAction(null);
    } catch {
      setImportAction(null);
      setImportError("continuing");
      requestAnimationFrame(() => importErrorRef.current?.focus());
    }
  };

  const saveConflict = async (proof: ImportProof) => {
    if (!proof.conflict || importAction) return;
    const value = conflictValue.trim();
    if (!value) {
      setConflictError(true);
      conflictInputRef.current?.focus();
      return;
    }
    setConflictError(false);
    setImportError(null);
    setImportAction("saving");
    try {
      const result = await saveImportResolution(proof.conflict.fieldId, value);
      setCv({ phase: "proof", proof: result.importProof });
      await advanceToIntent(true);
      setImportAction(null);
    } catch {
      setImportAction(null);
      setImportError("saving");
      requestAnimationFrame(() => importErrorRef.current?.focus());
    }
  };

  const retryCv = () => fileInputRef.current?.click();

  const choose = async (choice: Source) => {
    if (pendingChoice) return;
    setVisibleChoice(choice);
    setPendingChoice(choice);
    setChoiceError(null);
    // #201: `saved` splits the two failures this try covers. Once the save has succeeded the choice
    // is durable on the server, so a failed follow-on advance must not roll the toggle back to the
    // pre-click `confirmedChoice` (a stale closure value) — that rollback showed the person the
    // opposite of what the server stored, and was the CI flake's visible symptom.
    let saved = false;
    try {
      const result = await saveSourceEntry({
        checkpoint: "source_selected",
        choice: choice === "questions" ? "questions" : "cv",
      });
      saved = true;
      // #270: the server's echo is still what the toggle follows — only the file/paste split, which
      // the server has no word for, stays local. Everything the server CAN say, it says.
      const confirmed: Source | null =
        choice === "paste" && result.sourceEntry.choice === "cv" ? "paste" : result.sourceEntry.choice;
      setConfirmedChoice(confirmed);
      setVisibleChoice(confirmed);
      setPendingChoice(null);
      if (choice === "cv") fileInputRef.current?.click();
      else if (choice === "paste") openPaste();
      else await advanceToIntent(true);
    } catch {
      if (!saved) setVisibleChoice(confirmedChoice);
      setPendingChoice(null);
      setChoiceError({ choice, saved });
      requestAnimationFrame(() => choiceErrorRef.current?.focus());
    }
  };

  const busy = loading || readyBusy || pendingChoice !== null;

  return (
    <main
      className="frontdoor"
      data-testid="front-door"
      data-view={view}
      aria-busy={busy}
      data-cv={cv.phase}
    >
      {view === "invitation" ? (
        <div className="invite">
          <div className="stack">
            <p className="h">
              <span className="ln l1">
                <span className="gh">{L1}</span>
                <span className="tx" ref={l1Ref}>{loading || loadError ? L1 : ""}</span>
                {caretLine === "l1" && <span className="caret" />}
              </span>
              <span className="ln l2 g">
                <span className="gh">{L2}</span>
                <span className="tx" ref={l2Ref}>{loading || loadError ? L2 : ""}</span>
                {caretLine === "l2" && <span className="caret" />}
              </span>
            </p>
            {loading ? (
              <p className={loadSlow ? "restore restore-slow" : "sr-only"} aria-live="polite">
                {loadSlow ? "Restoring your progress is taking longer…" : "Restoring your progress…"}
              </p>
            ) : loadError ? (
              <div className="async-error" role="alert">
                We couldn’t restore your progress. <button onClick={() => void restore()}>Try again</button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={`ready${revealed ? " in" : ""}`}
                  disabled={!revealed || readyBusy}
                  onClick={() => void openSources()}
                >
                  {readyBusy ? "Opening…" : "Ready?"}
                </button>
                {readyError && (
                  <div className="async-error" role="alert" tabIndex={-1} ref={readyErrorRef}>
                    We couldn’t open this right now.{" "}
                    <button type="button" onClick={() => void openSources()}>Try again</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : view === "source" ? (
        <section className="source-screen">
          <p className="wordmark">JobCrush</p>
          {cv.phase === "idle" ? (
            <>
              <h1 id="source-heading" tabIndex={-1} ref={sourceHeadingRef}>
                Can something you already have help?
              </h1>
              <p className="source-intro">A CV can skip questions you’ve already answered.</p>
              <div className="source-actions" role="group" aria-labelledby="source-heading" data-testid="source-actions">
            <SourceButton source="cv" title="Use my CV" subtitle="Upload PDF, Word, or text" selected={visibleChoice === "cv"} disabled={pendingChoice !== null} onClick={() => void choose("cv")} />
            <SourceButton source="paste" title="Paste my CV text" subtitle="No file needed" selected={visibleChoice === "paste"} disabled={pendingChoice !== null} onClick={() => void choose("paste")} buttonRef={pasteTileRef} />
            <button type="button" className="source-action" data-source="linkedin" disabled aria-label="Use LinkedIn — Coming soon">
              <span className="source-tile">in</span>
              <span><strong>Use LinkedIn</strong><small>Profile import</small></span>
              <span className="trailing">Coming soon</span>
            </button>
            <SourceButton source="questions" title="Start questions instead" subtitle="Begin without a document" selected={visibleChoice === "questions"} disabled={pendingChoice !== null} onClick={() => void choose("questions")} />
              </div>
              <p className="temporary">
                No account needed. Your answers are temporary and expire after 7 days.
              </p>
              <div className="checkpoint" data-testid="source-checkpoint-status">
            {pendingChoice && <p role="status" aria-live="polite">Saving your choice…</p>}
            {choiceError && (
              <div role="alert" tabIndex={-1} ref={choiceErrorRef}>
                {choiceError.saved
                  ? "Your choice is saved, but we couldn’t continue."
                  : "We couldn’t save that choice."}{" "}
                <button type="button" onClick={() => void choose(choiceError.choice)}>Try again</button>
              </div>
            )}
              </div>
            </>
          ) : cv.phase === "paste" ? (
            <PastePanel
              text={cv.text}
              error={cv.error}
              textareaRef={pasteRef}
              onText={(text) => setCv({ phase: "paste", text, error: null })}
              onSubmit={() => void submitPaste()}
              onBack={() => {
                setCv({ phase: "idle" });
                requestAnimationFrame(() => pasteTileRef.current?.focus());
              }}
            />
          ) : (
            <ImportPanel
              cv={cv}
              headingRef={importHeadingRef}
              conflictInputRef={conflictInputRef}
              importErrorRef={importErrorRef}
              conflictValue={conflictValue}
              conflictError={conflictError}
              action={importAction}
              importError={importError}
              onConflictValue={(value) => {
                setConflictValue(value);
                setConflictError(false);
              }}
              onSave={(proof) => void saveConflict(proof)}
              onContinue={() => void continueToQuestions()}
              onRetry={retryCv}
              onPaste={openPaste}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onFile(file);
            }}
          />
        </section>
      ) : (
        <IntentPanel
          state={intent}
          fresh={intentFresh}
          loadError={intentLoadError}
          onRetryLoad={() => void openIntent(intentFresh)}
          onAccepted={setIntent}
        />
      )}
    </main>
  );
}

function IntentPanel({
  state,
  fresh,
  loadError,
  onRetryLoad,
  onAccepted,
}: {
  state: IntentState | null;
  fresh: boolean;
  loadError: boolean;
  onRetryLoad: () => void;
  onAccepted: (state: IntentState) => void;
}) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLInputElement>(null);
  const [targetRole, setTargetRole] = useState("");
  // #214: the search area is now up to 3 target-location CHIPS (the languages type-ahead pattern).
  // Each chip keeps the words as typed plus the display label the server vocabulary resolved them
  // to (the city when a city was typed, else the market). Save sends the texts; the server is still
  // the gate (it re-resolves and refuses uncovered entries).
  const [areaChips, setAreaChips] = useState<Array<{ text: string; label: string }>>([]);
  const [areaQuery, setAreaQuery] = useState("");
  const [refusedArea, setRefusedArea] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ targetRole?: string; searchArea?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [areaOnlyConfirm, setAreaOnlyConfirm] = useState(false);
  // `fresh` is a page-navigation flag ("did we land on this screen live, not via a cold restore") —
  // it is NOT "did a submit just happen." A visit can restore straight into this exact form
  // (fresh=false, e.g. the source-entry choice was already durable) and still submit live within
  // that same session, and AC1's spot-focus must fire then too. `justSubmittedRef` is that separate,
  // decoupled signal: submit() sets it right before handing the new state to the parent; the effect
  // below reads-and-clears it on the very next run, so it can never leak into an unrelated later
  // state change (e.g. one caused by something other than this panel's own submit).
  const justSubmittedRef = useRef(false);
  // #257: once intent is known the front door hands off to the discovery questions (owner decision
  // 2026-08-20: front door → discovery → deck). Same shape as discovery's own deck handoff
  // (discovery/page.tsx's deckNavigatedRef): the confirmation stays up as a brief sub-second
  // bridge, the ref latches so a re-render can never push twice, and the timer clears on unmount.
  const discoveryNavigatedRef = useRef(false);
  useEffect(() => {
    if (state?.checkpoint !== "intent_known") return;
    const t = setTimeout(() => {
      if (!discoveryNavigatedRef.current) {
        discoveryNavigatedRef.current = true;
        router.push("/discovery");
      }
    }, INTENT_HANDOFF_MS);
    return () => clearTimeout(t);
  }, [state, router]);

  // One effect, one focus decision per `state` change. The area branch is checked first and always
  // returns: a live uncovered resubmission both is `justSubmitted` and would otherwise also satisfy
  // `fresh`, and checking the heading branch afterwards would silently steal focus back to it.
  useEffect(() => {
    if (!state) return;
    setTargetRole(state.intent.targetRole ?? "");
    setAreaChips(state.intent.searchAreas.map((entry) => ({ text: entry.text, label: entry.label })));
    setAreaQuery("");
    // #214: the server is the gate — a refusal it reports on a live submit re-shows the coverage
    // line and puts focus back on the area input.
    const serverRefused = state.refused[0]?.text ?? null;
    setRefusedArea(serverRefused);
    const justSubmitted = justSubmittedRef.current;
    justSubmittedRef.current = false;
    if (justSubmitted && serverRefused) {
      areaRef.current?.focus();
      return;
    }
    if (fresh) headingRef.current?.focus();
  }, [fresh, state]);

  const vocabulary = state?.areaVocabulary ?? [];
  const atCap = areaChips.length >= 3;

  // #214: the shared matcher over the server-sent vocabulary (lib/areaMatch.ts) — the server still
  // re-resolves on save. Here an unmatched entry is always refused: the vocabulary arrives with
  // `state`, so it is present whenever this form renders.
  const resolveAreaText = (text: string) => matchAreaText(text, vocabulary);

  const addArea = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || atCap) return false;
    const match = resolveAreaText(trimmed);
    if (!match) {
      setRefusedArea(trimmed);
      return false;
    }
    if (!areaChips.some((chip) => chip.label === match.label)) {
      setAreaChips([...areaChips, { text: trimmed, label: match.label }]);
    }
    setAreaQuery("");
    setRefusedArea(null);
    setErrors((current) => ({ ...current, searchArea: undefined }));
    return true;
  };

  const removeArea = (label: string) => {
    setAreaChips(areaChips.filter((chip) => chip.label !== label));
    setRefusedArea(null);
  };

  const suggestions = atCap
    ? []
    : areaSuggestions(areaQuery, vocabulary, areaChips.map((chip) => chip.label));

  if (loadError) {
    return (
      <section className="source-screen intent-screen">
        <p className="wordmark">JobCrush</p>
        <div className="async-error" role="alert" tabIndex={-1} ref={errorRef}>
          We couldn’t restore what you want next.{" "}
          <button type="button" onClick={onRetryLoad}>Try again</button>
        </div>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="source-screen intent-screen" aria-busy="true">
        <p className="wordmark">JobCrush</p>
        <p className="intent-live" aria-live="polite">Restoring what you want next…</p>
      </section>
    );
  }

  if (state.checkpoint === "intent_known") {
    // #214: confirms the canonical chip labels (city when a city was typed, else market), never the
    // raw typed text — live submit and cold reload alike, straight off the server's own resolution.
    // Oxford-less join, the existing joinCoverage convention.
    const areaLabels = state.intent.searchAreas.map((entry) => entry.label);
    const confirmation = areaOnlyConfirm
      ? `We’ll search ${joinCoverage(areaLabels)}.`
      : lookForSentence(state.intent.targetRole ?? "", areaLabels);
    return (
      <section className="source-screen intent-screen">
        <p className="wordmark">JobCrush</p>
        <h1 tabIndex={-1} ref={headingRef}>Got it.</h1>
        <p className="source-intro intent-confirmation">{confirmation}</p>
        <p className="intent-live" aria-live={fresh ? "polite" : "off"}>
          {fresh ? "Saved." : ""}
        </p>
      </section>
    );
  }

  const needsRole = state.missing.includes("targetRole");
  const needsArea = state.missing.includes("searchArea");
  const heading = needsRole && needsArea
    ? "What kind of job are you going for, and where?"
    : needsRole
      ? "What kind of job are you going for?"
      : "Where should JobCrush look?";
  const intro = needsRole && needsArea
    ? "Tell us what you want next. Your work history and where you live don’t decide this for you."
    : needsRole
      ? "Use the words you would use for the work you want next."
      : "Tell us the area you want to search — it can be different from where you live.";

  const submit = async () => {
    const role = targetRole.trim();
    // #214: text still sitting in the area input is treated as one last chip-add — the way the
    // languages widget treats Enter — so "typed but never pressed Add" is never silently dropped.
    let chips = areaChips;
    if (needsArea && areaQuery.trim()) {
      const match = resolveAreaText(areaQuery);
      if (!match) {
        setRefusedArea(areaQuery.trim());
        areaRef.current?.focus();
        return;
      }
      if (!atCap && !chips.some((chip) => chip.label === match.label)) {
        chips = [...chips, { text: areaQuery.trim(), label: match.label }];
        setAreaChips(chips);
        setAreaQuery("");
      }
    }
    const nextErrors = {
      ...(needsRole && !role ? { targetRole: "Tell us the target role you want next." } : {}),
      ...(needsArea && chips.length === 0
        ? { searchArea: "Tell us where you want JobCrush to look." }
        : {}),
    };
    setErrors(nextErrors);
    if (nextErrors.targetRole) {
      roleRef.current?.focus();
      return;
    }
    if (nextErrors.searchArea) {
      areaRef.current?.focus();
      return;
    }
    setSaveError(false);
    setSaving(true);
    try {
      const accepted = await saveIntent({
        ...(needsRole ? { targetRole: role } : {}),
        ...(needsArea ? { searchAreas: chips.map((chip) => chip.text) } : {}),
      });
      setSaving(false);
      // The server never advances the checkpoint without ≥1 covered market — this trusts its
      // checkpoint rather than re-deciding it here.
      setAreaOnlyConfirm(needsArea && !needsRole && accepted.intent.searchAreas.length > 0);
      justSubmittedRef.current = true;
      onAccepted(accepted);
    } catch {
      setSaving(false);
      setSaveError(true);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  };

  return (
    <section className="source-screen intent-screen">
      <p className="wordmark">JobCrush</p>
      <form
        aria-busy={saving}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 tabIndex={-1} ref={headingRef}>{heading}</h1>
        <p className="source-intro">{intro}</p>
        {needsRole && !needsArea && state.intent.searchAreas.length > 0 && (
          <p className="intent-summary">
            Searching in {joinCoverage(state.intent.searchAreas.map((entry) => entry.label))}
          </p>
        )}
        {needsArea && !needsRole && state.intent.targetRole && (
          <p className="intent-summary">Looking for {state.intent.targetRole}</p>
        )}
        <div className="intent-fields">
          {needsRole && (
            <div className="intent-field">
              <label htmlFor="target-role">Target role</label>
              <input
                id="target-role"
                ref={roleRef}
                value={targetRole}
                disabled={saving}
                placeholder="e.g. Technical project manager"
                autoComplete="organization-title"
                aria-invalid={Boolean(errors.targetRole)}
                aria-describedby={`target-role-helper${errors.targetRole ? " target-role-error" : ""}`}
                onChange={(event) => setTargetRole(event.target.value)}
              />
              <p id="target-role-helper" className="intent-helper">
                {needsArea
                  ? "Use the words you would use for the work."
                  : "Free text is fine — you don’t have to choose a standard title."}
              </p>
              {errors.targetRole && <p id="target-role-error" className="intent-validation" role="alert">{errors.targetRole}</p>}
            </div>
          )}
          {needsArea && (
            <div className="intent-field intent-areas" data-testid="area-chips">
              <label htmlFor="search-area">Search area</label>
              {areaChips.length > 0 && (
                <ul className="chips" aria-label="Places you've chosen">
                  {areaChips.map((chip) => (
                    <li key={chip.label}>
                      <span className="lbl">{chip.label}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${chip.label}`}
                        disabled={saving}
                        onClick={() => removeArea(chip.label)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                id="search-area"
                ref={areaRef}
                value={areaQuery}
                // #214: the input disables at the 3-chip cap; the helper line below reads it out.
                disabled={saving || atCap}
                placeholder={atCap ? "" : "e.g. Hong Kong"}
                aria-invalid={Boolean(errors.searchArea)}
                aria-describedby={[
                  "search-area-helper",
                  errors.searchArea ? "search-area-error" : null,
                  refusedArea ? "search-area-coverage" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onChange={(event) => {
                  setAreaQuery(event.target.value);
                  setRefusedArea(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addArea(areaQuery);
                }}
              />
              <p id="search-area-helper" className="intent-helper">
                {atCap
                  ? "Three places is the limit — remove one to add another."
                  : "Type a city or country — up to three places."}
              </p>
              {suggestions.length > 0 && (
                <div className="sugg" role="status" aria-live="polite">
                  {suggestions.map((v) => (
                    <button key={v.label} type="button" disabled={saving} onClick={() => addArea(v.label)}>
                      {v.label === v.market ? v.label : `${v.label} — ${v.market}`}
                    </button>
                  ))}
                </div>
              )}
              {errors.searchArea && <p id="search-area-error" className="intent-validation" role="alert">{errors.searchArea}</p>}
              {refusedArea && (
                <p id="search-area-coverage" className="intent-coverage" role="status">
                  {`JobCrush is in early access — we currently cover ${joinCoverage(state.coverage)}.`}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="import-actions">
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </div>
        <div className="intent-status">
          <p className="intent-live" aria-live="polite">
            {saving ? "Saving what you want next…" : ""}
          </p>
          {saveError && (
            <div className="async-error" role="alert" tabIndex={-1} ref={errorRef}>
              We couldn’t save that. Your answers are still here.{" "}
              <button type="button" onClick={() => void submit()}>Try again</button>
            </div>
          )}
        </div>
      </form>
    </section>
  );
}

function ImportPanel({
  cv,
  headingRef,
  conflictInputRef,
  importErrorRef,
  conflictValue,
  conflictError,
  action,
  importError,
  onConflictValue,
  onSave,
  onContinue,
  onRetry,
  onPaste,
}: {
  cv: Exclude<CvState, { phase: "idle" } | { phase: "paste" }>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  conflictInputRef: React.RefObject<HTMLInputElement | null>;
  importErrorRef: React.RefObject<HTMLDivElement | null>;
  conflictValue: string;
  conflictError: boolean;
  action: "saving" | "continuing" | null;
  importError: "saving" | "continuing" | null;
  onConflictValue: (value: string) => void;
  onSave: (proof: ImportProof) => void;
  onContinue: () => void;
  onRetry: () => void;
  onPaste: () => void;
}) {
  if (cv.phase === "reading") {
    return (
      <div className="import-status" role="status" aria-live="polite" aria-busy="true">
        <h1>Reading your CV…</h1>
        <p>{cv.slow ? "This is taking longer than usual. Your CV progress is safe." : "Finding useful facts so you don’t repeat yourself."}</p>
      </div>
    );
  }

  const proof = cv.phase === "proof" ? cv.proof : null;
  const failed = cv.phase === "error" || proof?.outcome === "failed";
  const noUsefulFacts = proof?.outcome === "no_useful_facts";
  const partial = proof?.outcome === "partial";
  const conflict = proof
    && proof.outcome !== "failed"
    && proof.outcome !== "no_useful_facts"
    ? proof.conflict
    : null;
  const heading = failed
    ? "We couldn’t read your CV"
    : noUsefulFacts
      ? "We couldn’t find useful facts"
    : partial
      ? "We read part of your CV"
      : proof && proof.skippedQuestionCount === 0
        ? "Your CV gave us useful facts"
        : "Your CV saved you some questions";
  const body = cv.phase === "error"
    ? cv.message
    : failed
    // #270: the commonest reason we can't read a file is a scan with no selectable text — their CV
    // is fine, the file is just a picture. Retrying the same file cannot help; pasting can.
    ? "Your session is still here. If your CV is a scan, paste the text instead — or try the file again, or continue without it."
    : noUsefulFacts
      ? "Try another CV, or continue with questions."
    : partial
      ? "The facts below are saved. We’ll ask only for missing information that matters."
      : proof && proof.skippedQuestionCount === 0
        ? "We’ll use them in the next step."
        : "We found information we can use in the next step.";

  return (
    <>
      <div className="import-status">
        <h1 tabIndex={-1} ref={headingRef}>{heading}</h1>
        <p role={failed && !(cv.phase === "proof" && cv.restored) ? "alert" : undefined}>{body}</p>
      </div>
      {proof && proof.outcome !== "failed" && proof.outcome !== "no_useful_facts" && (
        <div className="import-proof">
          <dl className="proof-metrics">
            <div><dd>{proof.usefulFactCount}</dd><dt>{proof.usefulFactCount === 1 ? "useful fact found" : "useful facts found"}</dt></div>
            <div><dd>{proof.skippedQuestionCount}</dd><dt>{proof.skippedQuestionCount === 1 ? "question skipped" : "questions skipped"}</dt></div>
          </dl>
          <ul className="proof-facts">
            {proof.representativeFacts.map((fact) => (
              <li key={fact.id}><span>From your CV</span>{fact.text}</li>
            ))}
          </ul>
          {conflict && (
            <div className="conflict">
              <label htmlFor="import-conflict">{conflict.label}</label>
              <input
                id="import-conflict"
                ref={conflictInputRef}
                value={conflictValue}
                onChange={(event) => onConflictValue(event.target.value)}
                aria-describedby="conflict-helper"
                aria-invalid={conflictError}
              />
              <p id="conflict-helper">Your answer will be used if you import this CV again.</p>
              {conflictError && <p role="alert">Enter your answer, or choose Answer later.</p>}
            </div>
          )}
        </div>
      )}
      <div className="import-actions">
        {failed || noUsefulFacts ? (
          <>
            {failed && (
              <button type="button" className="primary" onClick={onPaste}>
                Paste the text instead
              </button>
            )}
            <button type="button" className={failed ? undefined : "primary"} onClick={onRetry}>
              {noUsefulFacts ? "Try another CV" : "Try again"}
            </button>
            <button type="button" onClick={onContinue} disabled={action === "continuing"}>
              {action === "continuing" ? "Continuing…" : "Continue with questions"}
            </button>
          </>
        ) : conflict ? (
          <>
            <button type="button" className="primary" onClick={() => onSave(proof!)} disabled={action === "saving"}>
              {action === "saving" ? "Saving…" : "Save and continue"}
            </button>
            <button type="button" onClick={onContinue} disabled={action === "continuing"}>
              {action === "continuing" ? "Continuing…" : "Answer later"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary" onClick={onContinue} disabled={action === "continuing"}>
              {action === "continuing" ? "Continuing…" : "Ask me what’s missing"}
            </button>
            {partial && <button type="button" onClick={onRetry}>Try the CV again</button>}
          </>
        )}
      </div>
      {importError && (
        <div className="async-error" role="alert" tabIndex={-1} ref={importErrorRef}>
          {importError === "saving"
            ? "We couldn’t save your answer."
            : "We couldn’t continue right now."}{" "}
          <button
            type="button"
            onClick={importError === "saving" && proof ? () => onSave(proof) : onContinue}
          >
            Try again
          </button>
        </div>
      )}
    </>
  );
}

// #270: the paste view. Same screen, same session, same read — the person never leaves the front
// door, and what they typed survives every refusal this panel can show.
function PastePanel({
  text,
  error,
  textareaRef,
  onText,
  onSubmit,
  onBack,
}: {
  text: string;
  error: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <form
      data-testid="paste-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="import-status">
        <h1>Paste your CV text</h1>
        <p>Copy it from wherever it lives — a document, an email — and paste it here.</p>
      </div>
      <div className="paste-field">
        <label htmlFor="paste-cv">Your CV text</label>
        <textarea
          id="paste-cv"
          ref={textareaRef}
          rows={14}
          value={text}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "paste-error" : undefined}
          placeholder={"Jane Doe\nProject Manager\n\nExperience\n…"}
          onChange={(event) => onText(event.target.value)}
        />
        {error && <p id="paste-error" role="alert">{error}</p>}
      </div>
      <div className="import-actions">
        <button type="submit" className="primary">Use this text</button>
        <button type="button" onClick={onBack}>Go back</button>
      </div>
    </form>
  );
}

function SourceButton({
  source,
  title,
  subtitle,
  selected,
  disabled,
  onClick,
  buttonRef,
}: {
  source: Source;
  title: string;
  subtitle: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="source-action"
      data-source={source}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="source-tile">{source === "cv" ? "CV" : source === "paste" ? "TXT" : "Q"}</span>
      <span><strong>{title}</strong><small>{subtitle}</small></span>
      <span className="trailing">{selected ? "Selected" : ""}</span>
    </button>
  );
}
