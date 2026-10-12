"use client";

// #377 — check mode (ADR-0018 clause 3): after an upload the profile opens here, a guided walk
// with one screen per section, a thin progress line and one footer button that confirms the
// screen. This file is the walk's engine only — screen order, Back/Next, the footer and what
// holds it, the three motion cues, the done screen. What each screen shows is screens.tsx; an
// item and the removed tray are Item.tsx.
//
// The review (ADR-0016) keeps running in the background exactly as before; the walk reads its
// paper (GET /review) and re-reads it while the run goes, so fixes and drafts fill in as they
// land. Finish is POST /review/complete — the one server-side gate the jobs wait on — and it
// stands for every screen at once: no screen is confirmed on the server on its own (the
// orchestrator's decision, #377). A removed item is the kept line state underneath (⊖ → kept,
// Put back → ticked); the server's print gate already refuses it everywhere.
// "Saved" is shown by motion, never by words: the finished segment fills on Next (sweep), the
// removed count glows on a removal (bump), the footer button pulses once when it turns gold
// (arm). Under reduced motion none of the three classes is ever set.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "./check.css";
import { completeReview, ensureSession, getReview, saveAbout, setLineState, setLineText, type ReviewLine, type ReviewState } from "../../../lib/api";
import { useReducedMotion } from "../../jobcard";
import { blockersOf, leadFor, ScreenBody, screensOf, type Screen } from "./screens";

const C_BACK = "‹ Back";
const C_FINISH = "Finish my profile";
const nextLabel = (title: string) => `Next: ${title}  →`;
const blockedLabel = (blockers: string[]) => `Answer ${blockers.join(" and ")} to continue`;
const C_DONE = "Your profile is ready";
const C_DONE_SUB = "Each application will pick what fits that job.";
const C_IN = "in your profile";
const C_ADDED = "added";
const C_REMOVED = "removed";
const C_JOBS = "Show me the job ads";
// Load states and the save failure keep the review page's own words.
const C_LOADING = "Loading your CV…";
const C_LOAD_FAILED = "Couldn't load your CV.";
const C_RETRY = "Try again";
const C_EMPTY = "Nothing was read from a CV yet.";
const C_SAVE_FAILED = "Couldn't save that — try again.";
const C_CHECKING = "Checking your CV…";
const minutesCopy = (n: number) => `About ${n} ${n === 1 ? "minute" : "minutes"} left.`;
/** How often the walk re-reads the paper while the run is going. */
const POLL_MS = 3000;

interface Fx {
  /** The screen whose segment fills: the one just finished. */
  sweep?: string;
  /** The screen whose removed count glows. */
  bump?: string;
  arm?: boolean;
}

const allLines = (state: ReviewState): ReviewLine[] =>
  state.sections.flatMap((s) => ("jobs" in s ? s.jobs.flatMap((j) => j.lines) : s.lines));

export default function CheckPage() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [state, setState] = useState<ReviewState | null>(null);
  const [failed, setFailed] = useState(false);
  const [stepKey, setStepKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fx, setFx] = useState<Fx>({});
  const [pollTick, setPollTick] = useState(0);
  /** #371: About you's words while the person edits them; null when not editing. */
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The screen the footer button was last held on — it pulses once when released there. */
  const heldOn = useRef<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      await ensureSession();
      setState(await getReview());
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // While the run is going, re-read on a recursive timeout chain (never setInterval — the deck's
  // own rule): marks fill in as they land, and Finish unlocks when the run does.
  const running = state?.progress !== null && state?.progress !== undefined;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(async () => {
      try {
        setState(await getReview());
      } catch {
        // the paper stays; the next tick re-reads
      } finally {
        setPollTick((n) => n + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [running, pollTick]);

  const screens = state ? screensOf(state) : [];
  const k = Math.max(0, screens.findIndex((s) => s.key === stepKey));
  const screen: Screen | undefined = screens[k];
  const last = k === screens.length - 1;
  const blockers = screen ? blockersOf(screen) : [];
  const canGo = blockers.length === 0 && !(last && running);

  // The arm cue: the button turns gold on the screen it was held on.
  useEffect(() => {
    const key = screen?.key ?? null;
    if (canGo && key !== null && heldOn.current === key && !reduced) setFx((f) => ({ ...f, arm: true }));
    heldOn.current = canGo ? null : key;
  }, [canGo, screen?.key, reduced]);

  // Each screen is a new place: focus lands on its heading (focus keyed to committed state).
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepKey, done, state === null]);

  /** A write, then a fresh read of the paper. A failed write is reported; a failed re-read is not
   *  a save failure (the profile's own rule) — the next tick or tap re-reads. */
  const write = async (action: () => Promise<unknown>, then?: () => void): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(C_SAVE_FAILED);
      setBusy(false);
      return false;
    }
    try {
      setState(await getReview());
    } catch {
      // keep the paper as it is
    }
    then?.();
    setBusy(false);
    return true;
  };
  // #379: the words saved; on a failure the editor stays open with what was typed.
  const edit = (id: string, text: string) => write(() => setLineText(id, text));
  const remove = (id: string) =>
    write(
      () => setLineState(id, "kept"),
      () => {
        if (!reduced && screen) setFx((f) => ({ ...f, bump: screen.key }));
      },
    );
  const putBack = (id: string) => write(() => setLineState(id, "ticked"));
  const go = (dir: 1 | -1) => {
    const to = screens[k + dir];
    if (!to || !screen) return;
    // Next fills the finished segment; Back ends any fill still playing (that step is ahead again).
    setFx((f) => ({ ...f, sweep: dir === 1 && !reduced ? screen.key : undefined }));
    setStepKey(to.key);
    window.scrollTo(0, 0);
  };
  const finish = () =>
    write(
      () => completeReview(),
      () => {
        setDone(true);
        window.scrollTo(0, 0);
      },
    );
  /** The footer button. On About you it saves first (#371): the person's words, or the text as it
   *  stands — keeping it unchanged makes it theirs too. Emptied words keep the text (the prototype's
   *  rule). A failed save stays on the screen with the words. */
  const confirm = async () => {
    if (screen?.kind === "about") {
      if (!(await write(() => saveAbout(aboutDraft?.trim() || screen.about.text)))) return;
      setAboutDraft(null);
    }
    if (last) void finish();
    else go(1);
  };

  if (failed && !state) {
    return (
      <main className="check">
        <div className="loadstate" role="alert">
          <p>{C_LOAD_FAILED}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            {C_RETRY}
          </button>
        </div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="check">
        <div className="loadstate" aria-live="polite">
          <p>{C_LOADING}</p>
        </div>
      </main>
    );
  }
  if (done) {
    const lines = allLines(state);
    const inCount = lines.filter((l) => l.state === "ticked").length;
    const added = lines.filter((l) => l.state === "ticked" && l.draft !== null).length;
    const removed = lines.filter((l) => l.state === "kept").length;
    return (
      <main className="check">
        <div className="donepanel">
          <h1 tabIndex={-1} ref={headingRef}>
            {C_DONE}
          </h1>
          <p className="sub">{C_DONE_SUB}</p>
          <div className="tally">
            <div>
              <b>{inCount}</b>
              <span>{C_IN}</span>
            </div>
            <div>
              <b>{added}</b>
              <span>{C_ADDED}</span>
            </div>
            <div>
              <b>{removed}</b>
              <span>{C_REMOVED}</span>
            </div>
          </div>
          <button type="button" className="btn primary" onClick={() => router.push("/deck")}>
            {C_JOBS}
          </button>
        </div>
      </main>
    );
  }
  if (!screen) {
    return (
      <main className="check">
        <div className="loadstate">
          <p>{C_EMPTY}</p>
        </div>
      </main>
    );
  }

  const segmentClass = (s: Screen, i: number) => (fx.sweep === s.key ? "sweep" : i < k ? "done" : i === k ? "cur" : "");
  const label = blockers.length > 0 ? blockedLabel(blockers) : last ? C_FINISH : nextLabel(screens[k + 1]!.title);
  return (
    <main className="check">
      <div className="guide">
        <div className="prog" aria-hidden="true">
          {screens.map((s, i) => (
            <i key={s.key} className={segmentClass(s, i)} onAnimationEnd={() => setFx((f) => (f.sweep === s.key ? { ...f, sweep: undefined } : f))} />
          ))}
        </div>
        <h1 className="big" tabIndex={-1} ref={headingRef}>
          {screen.title}
        </h1>
        {screen.sub && <p className="bigsub">{screen.sub}</p>}
        <p className="lead">{leadFor(screen)}</p>
        <ScreenBody
          screen={screen}
          list={{
            busy,
            bump: fx.bump === screen.key,
            onRemove: remove,
            onPutBack: putBack,
            onEdit: edit,
            onBumpEnd: () => setFx((f) => ({ ...f, bump: undefined })),
          }}
          aboutDraft={{ draft: aboutDraft, onDraft: setAboutDraft }}
        />
        {last && running && state.progress && (
          <p className="hint" aria-live="polite">
            {C_CHECKING} {minutesCopy(state.progress.minutesLeft)}
          </p>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="foot">
        <div className="in">
          {k > 0 && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => go(-1)}>
              {C_BACK}
            </button>
          )}
          <button
            type="button"
            className={`btn primary${fx.arm ? " arm" : ""}`}
            disabled={busy || !canGo}
            onAnimationEnd={() => setFx((f) => ({ ...f, arm: undefined }))}
            onClick={() => void confirm()}
          >
            {label}
          </button>
        </div>
      </div>
    </main>
  );
}
