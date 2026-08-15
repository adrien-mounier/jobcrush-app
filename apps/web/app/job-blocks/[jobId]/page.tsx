"use client";

// #161 AC7 — the confirm-swipe deck for structured job records (#157 Design A, decided with the
// owner in the room). Primary source: apps/web/prototypes/confirm-swipe.prototype.html.
//
// One dated block = one card. Right = "that's right" (confirms all five machine decisions on the
// block at once). Left = "skip for now" (returns to the end of the deck locally — never persisted,
// never counts as a decision). Tap the card = correct it; the horizontal axis is confirm-only.
// The card STATES the kind and what it means ("we've put this down as your education — so it
// doesn't add to your years of experience"); it never asks "does this count as work?" — counting is
// derived from the kind (countsTowardExperience, computed server-side).
//
// Register is deliberately LIGHT — the app's existing non-HUD token palette (packages/ui/tokens.css,
// job-blocks.css) — unlike the shipped sentence deck's dark `.jobdeck`. Drag mechanics (8px
// activation, axis lock, 90px commit, 110px stamp ramp, jd-out-left/right 340ms, jd-dealin) and the
// flying-chip reward beat are reused at deck.css/factbadge.css's shipped values.
//
// Reachable pre-wall (job-blocks.ts's own comment: "same gate as contact.ts") — this screen sits
// between /preview (the watermarked draft) and /deck/[jobId] (the sentence-level claim deck, which
// still requires sign-in unchanged). Session-scoped: the API returns this session's job blocks
// regardless of which upload produced them, so `jobId` in the URL is only used to route onward.
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import "../../job-blocks.css";
import {
  confirmJobBlock,
  correctJobBlock,
  ensureSession,
  getJobBlocks,
  resolveJobBlockMatch,
  unconfirmJobBlock,
  type JobBlockCorrection,
  type JobBlockKind,
  type JobBlockView,
  type JobBlocksReadStatus,
  type MinedDate,
  type MinedEndValue,
} from "../../../lib/api";

const MONTHS = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const NOW = new Date();
const YEARS = Array.from({ length: NOW.getFullYear() - 1959 }, (_, i) => 1960 + i);
const SWIPE_MS = 340;
const CHIP_FLY_MS = 700;

const KIND_META: Record<JobBlockKind, { label: string; blurb: string; said: string }> = {
  job: { label: "A job", blurb: "Paid employment.", said: "a job" },
  education: { label: "Education", blurb: "A degree, a diploma or a course.", said: "your education" },
  project: { label: "A project", blurb: "Something you built or ran outside a job.", said: "a project" },
  client: {
    label: "A client you worked for",
    blurb: "Named under an employer — not a job of its own.",
    said: "a client you worked for",
  },
  volunteering: { label: "Volunteering", blurb: "Unpaid work.", said: "volunteering" },
};

function fmtDate(d: MinedDate): string {
  return d.precision === "year" ? String(d.year) : `${MONTHS[d.month ?? 1]} ${d.year}`;
}
function fmtEnd(end: MinedEndValue): string {
  if (end.state === "ongoing") return "still there";
  if (end.state === "unknown") return "end unknown";
  return fmtDate(end.date);
}
function fmtRange(start: MinedDate, end: MinedEndValue): string {
  return `${fmtDate(start)} – ${fmtEnd(end)}`;
}
function monthIndex(d: MinedDate): number {
  return d.year * 12 + (d.precision === "year" ? 1 : (d.month ?? 1));
}
// Derives counts-toward-experience from the KIND directly (kind === "job"), never from the
// server's `countsTowardExperience` flag — that flag reflects the block as it was AT LOAD TIME and
// a draft's kind edit never updates it, which used to make a kind correction's consequence preview
// and reward lie (education→job said "no change" while the note beside it said otherwise).
function monthsOf(block: JobBlockView): number {
  if (block.kind !== "job") return 0;
  if (block.end.value.state === "unknown") return 0;
  const s = monthIndex(block.start.value);
  const e =
    block.end.value.state === "ongoing"
      ? NOW.getFullYear() * 12 + (NOW.getMonth() + 1)
      : monthIndex(block.end.value.date);
  return Math.max(0, e - s);
}
function yearsStr(months: number): string {
  if (months === 0) return "none yet";
  const y = months / 12;
  return `${y.toFixed(1).replace(/\.0$/, "")} year${y >= 2 ? "s" : ""}`;
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
function rewardLabel(block: JobBlockView): string {
  const name = block.employer.value || block.title.value || KIND_META[block.kind].label;
  return name.length > 26 ? `${name.slice(0, 25)}…` : name;
}
function emptyCopy(read: JobBlocksReadStatus): { h: string; p: string } {
  if (read.status === "failed")
    return {
      h: "Let's add your work history",
      p: "We couldn't read it automatically from your CV — no problem, you can add it yourself further along.",
    };
  if (read.status === "not_run")
    return { h: "Nothing to check yet", p: "We haven't read a CV for this session yet." };
  return {
    h: "Nothing dated to check",
    p: "We didn't find any dated jobs, education or projects in your CV — you can add them yourself further along.",
  };
}

interface LocalSnapshot {
  blocks: JobBlockView[];
  queue: string[];
  confirmedIds: string[];
  skippedIds: string[];
  correctionsCount: number;
}

interface UndoAction {
  label: string;
  // The server-side reverse of whatever action created this undo entry — awaited before the local
  // snapshot is restored, so a reload never resurrects the "undone" decision. `null` only for
  // resolve-match, which has no reverse endpoint (see onResolveMatch) — undo is not offered for it.
  revert: (() => Promise<void>) | null;
  local: LocalSnapshot;
}

// ---- #231: the sixth fact is never a question ----
// #221 ended this deck with a "what kind of work were these?" panel for every job the machine could
// not place. It is gone (ADR-0014 amendment 1): a job can be several families and nobody is asked,
// so there is nothing here to ask about — an unplaced job is simply unplaced, and the labeler tries
// again on the next run. The family stays a CORRECTABLE fact (the correct endpoint is untouched);
// it is just never surfaced as a question on this screen. The job card itself said nothing about
// families before and says nothing now.

// `family` is deliberately not revertable here: nothing on this screen sets it, and a job that was
// never placed has no earlier value to revert to — an undo offered for it would have to lie.
function revertValue(key: Exclude<JobBlockCorrection["key"], "family">, original: JobBlockView): JobBlockCorrection {
  if (key === "employer") return { key, value: original.employer.value };
  if (key === "title") return { key, value: original.title.value };
  if (key === "start") return { key, value: original.start.value };
  if (key === "end") return { key, value: original.end.value };
  return { key, value: original.kindDecision.value };
}

export default function JobBlocksScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [blocks, setBlocks] = useState<JobBlockView[] | null>(null);
  const [readStatus, setReadStatus] = useState<JobBlocksReadStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [queue, setQueue] = useState<string[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [correctionsCount, setCorrectionsCount] = useState(0);

  const [back, setBack] = useState(false);
  const [draft, setDraft] = useState<JobBlockView | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; dx: number; live: boolean } | null>(null);
  // QA blocker fix: releasePointer's setDragging(false) lands before the browser dispatches the
  // click event, so `!dragging` in onClick is already true again after a completed swipe and the
  // correction panel opened for the card just swiped away. A ref survives that ordering — set on
  // release of any live drag, checked-and-cleared by onClick. (deck/page.tsx has no card-level
  // onClick, so there is no shipped pattern to mirror; this is the minimal ref guard.)
  const dragJustEndedRef = useRef(false);

  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [bump, setBump] = useState<{ checked: boolean; exp: boolean }>({ checked: false, exp: false });
  const [chip, setChip] = useState<{ label: string; from: DOMRect } | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const checkedRef = useRef<HTMLDivElement>(null);
  const chipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The block's values as they were the moment the back panel opened — stable across a save
  // retry (which may reconcile `blocks` from the server mid-flight) so undo always reverts to the
  // true starting values, and so a retry never re-diffs against a value it already sent.
  const originalRef = useRef<JobBlockView | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    return () => {
      if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureSession();
      const res = await getJobBlocks();
      setBlocks(res.blocks);
      setReadStatus(res.summary.read);
      setConfirmedIds(new Set(res.blocks.filter((b) => b.confirmed).map((b) => b.id)));
      setQueue(res.blocks.filter((b) => !b.confirmed).map((b) => b.id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "could not read your work history");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = useMemo(() => blocks?.find((b) => b.id === queue[0]) ?? null, [blocks, queue]);

  useEffect(() => {
    if (current && !back) cardRef.current?.focus();
  }, [current?.id, back]);

  const confirmedMonths = useMemo(
    () => (blocks ?? []).filter((b) => confirmedIds.has(b.id)).reduce((n, b) => n + monthsOf(b), 0),
    [blocks, confirmedIds],
  );

  // The pre-action state, captured before any local mutation — what undo restores to once (and if)
  // its server-side revert succeeds.
  const localSnapshot = useCallback(
    (): LocalSnapshot => ({
      blocks: clone(blocks ?? []),
      queue: [...queue],
      confirmedIds: [...confirmedIds],
      skippedIds: [...skippedIds],
      correctionsCount,
    }),
    [blocks, queue, confirmedIds, skippedIds, correctionsCount],
  );

  const fireReward = useCallback(
    (label: string, expGrew: boolean) => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect || reducedMotion) {
        setBump({ checked: true, exp: expGrew });
        setTimeout(() => setBump({ checked: false, exp: false }), 500);
        return;
      }
      setChip({ label, from: rect });
      if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
      chipTimerRef.current = setTimeout(() => {
        setChip(null);
        setBump({ checked: true, exp: expGrew });
        setTimeout(() => setBump({ checked: false, exp: false }), 500);
      }, CHIP_FLY_MS);
    },
    [reducedMotion],
  );

  const advance = useCallback(
    (dir: "left" | "right" | null, after: () => void) => {
      if (dir && !reducedMotion) {
        setLeaving(dir);
        setTimeout(() => {
          setLeaving(null);
          after();
        }, SWIPE_MS);
      } else {
        after();
      }
    },
    [reducedMotion],
  );

  // Right = "that's right". Confirms every decision on the block at once (#157 Design A §1). Waits
  // for the server before advancing the deck — a failed confirm must never be shown as decided.
  const onConfirm = useCallback(async () => {
    if (!current || busy) return;
    const block = current;
    const local = localSnapshot();
    setActionError(null);
    setBusy(true);
    try {
      await confirmJobBlock(block.id);
      setUndo({ label: "Confirmed", revert: () => unconfirmJobBlock(block.id).then(() => {}), local });
      advance("right", () => {
        setConfirmedIds((s) => new Set(s).add(block.id));
        setSkippedIds((s) => {
          const n = new Set(s);
          n.delete(block.id);
          return n;
        });
        setQueue((q) => q.filter((id) => id !== block.id));
        setLiveMessage(`Confirmed. ${queue.length - 1} left to check.`);
        fireReward(rewardLabel(block), monthsOf(block) > 0);
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "couldn't save that — try again");
    } finally {
      setBusy(false);
    }
  }, [current, busy, localSnapshot, advance, fireReward, queue.length]);

  // Left = "skip for now". Local-only: no server call at all (there is nothing to persist — a skip
  // is never a decision, #157 Design A §3 / ADR-0011 clause 4), so nothing here needs a server-side
  // revert either.
  const onSkip = useCallback(() => {
    if (!current || busy) return;
    const block = current;
    const local = localSnapshot();
    setUndo({ label: "Skipped — it'll come back", revert: null, local });
    advance("left", () => {
      setSkippedIds((s) => new Set(s).add(block.id));
      setQueue((q) => [...q.slice(1), q[0]]);
      setLiveMessage("Skipped for now — it'll come back at the end.");
    });
  }, [current, busy, localSnapshot, advance]);

  const openBack = useCallback(() => {
    if (!current) return;
    originalRef.current = clone(current);
    setDraft(clone(current));
    setBack(true);
    setTimeout(() => document.querySelector<HTMLElement>(".jb-back input, .jb-back select")?.focus(), 30);
  }, [current]);

  const cancelBack = useCallback(() => {
    setBack(false);
    setDraft(null);
    originalRef.current = null;
  }, []);

  // Diffs against the values captured when the back panel opened (never against `current`, which a
  // failed-retry reconcile below may have already partly updated) — so a retry never re-diffs
  // against a value it already sent, and undo always has the true starting values to revert to.
  const saveBack = useCallback(async () => {
    const original = originalRef.current;
    if (!original || !draft || busy) return;
    const changed: Array<Exclude<JobBlockCorrection, { key: "family" }>> = [];
    if (draft.employer.value !== original.employer.value) changed.push({ key: "employer", value: draft.employer.value });
    if (draft.title.value !== original.title.value) changed.push({ key: "title", value: draft.title.value });
    if (JSON.stringify(draft.start.value) !== JSON.stringify(original.start.value))
      changed.push({ key: "start", value: draft.start.value });
    if (JSON.stringify(draft.end.value) !== JSON.stringify(original.end.value))
      changed.push({ key: "end", value: draft.end.value });
    if (draft.kindDecision.value !== original.kindDecision.value)
      changed.push({ key: "kind", value: draft.kindDecision.value });

    const block = draft;
    const local = localSnapshot();
    setActionError(null);
    setBusy(true);
    try {
      // Only after EVERY correction plus the confirm itself succeed does the UI show this as
      // decided — a mid-sequence failure used to leave half the corrections saved server-side
      // while the card still read "all saved" (an undetectable, uncorrectable lie to the person).
      for (const c of changed) await correctJobBlock(block.id, c);
      await confirmJobBlock(block.id);
      setUndo({
        label: "Saved your correction",
        revert: async () => {
          for (const c of changed) await correctJobBlock(block.id, revertValue(c.key, original));
          await unconfirmJobBlock(block.id);
        },
        local,
      });
      setBack(false);
      const before = (blocks ?? []).reduce((n, b) => n + monthsOf(b), 0);
      const after = (blocks ?? []).reduce((n, b) => n + monthsOf(b.id === block.id ? block : b), 0);
      advance(null, () => {
        setBlocks((bs) => (bs ?? []).map((b) => (b.id === block.id ? block : b)));
        setConfirmedIds((s) => new Set(s).add(block.id));
        setSkippedIds((s) => {
          const n = new Set(s);
          n.delete(block.id);
          return n;
        });
        setQueue((q) => q.filter((id) => id !== block.id));
        if (changed.length) setCorrectionsCount((n) => n + 1);
        setLiveMessage("Saved your correction.");
        fireReward(rewardLabel(block), after > before); // only bump when it actually added time
        setDraft(null);
        originalRef.current = null;
      });
    } catch (e) {
      // Some of `changed` may have already landed before the failure — reconcile local state from
      // the server's own truth (rather than guess which calls succeeded) and leave the back panel
      // open with the draft intact: pressing Save again is the retry, and any correction that
      // already landed is now a no-op diff against the reconciled `blocks`... except this diff is
      // against `original` (captured at open time), which is deliberate — resending an
      // already-applied correction is a harmless idempotent PUT, never data loss.
      setActionError(
        e instanceof Error ? `${e.message} — some of it may not have gone through. Try again.` : "couldn't save that — try again",
      );
      try {
        const res = await getJobBlocks();
        setBlocks(res.blocks);
        setConfirmedIds(new Set(res.blocks.filter((b) => b.confirmed).map((b) => b.id)));
      } catch {
        // Reconcile itself failed — keep whatever local state we had; the retry attempt will
        // surface any further problem.
      }
    } finally {
      setBusy(false);
    }
  }, [draft, busy, blocks, localSnapshot, advance, fireReward]);

  // #157 Design A §8 — an ambiguous re-upload match surfaces as a question on the card, not a swipe.
  // resolve-match has no reverse endpoint, so — unlike confirm/correct — undo is never offered for
  // this action; any prior undo entry is cleared instead of replaced with one that would lie.
  const onResolveMatch = useCallback(
    (same: boolean) => {
      if (!current || busy) return;
      const block = current;
      const candidateId = block.candidateBlockIds[0];
      setActionError(null);
      setBusy(true);
      resolveJobBlockMatch(block.id, same && candidateId ? { resolution: "same", matchedBlockId: candidateId } : { resolution: "different" })
        .then(() => {
          setUndo(null);
          if (same) {
            setConfirmedIds((s) => new Set(s).add(block.id));
            setQueue((q) => q.filter((id) => id !== block.id));
            fireReward(rewardLabel(block), false);
          } else {
            setBlocks((bs) => (bs ?? []).map((b) => (b.id === block.id ? { ...b, matchState: "new" as const } : b)));
          }
        })
        .catch((e) => setActionError(e instanceof Error ? e.message : "couldn't save that — try again"))
        .finally(() => setBusy(false));
    },
    [current, busy, fireReward],
  );

  const onUndo = useCallback(async () => {
    if (!undo || busy) return;
    setActionError(null);
    setBusy(true);
    try {
      if (undo.revert) await undo.revert();
      setBlocks(undo.local.blocks);
      setQueue(undo.local.queue);
      setConfirmedIds(new Set(undo.local.confirmedIds));
      setSkippedIds(new Set(undo.local.skippedIds));
      setCorrectionsCount(undo.local.correctionsCount);
      setUndo(null);
      setBack(false);
      setDraft(null);
      originalRef.current = null;
      setLeaving(null);
      setLiveMessage("Undone.");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "couldn't undo that — try again");
    } finally {
      setBusy(false);
    }
  }, [undo, busy]);

  // ---- drag (deck.css's shipped mechanics: 8px activation, axis lock, 90px commit) ----
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (back || busy || (e.target as HTMLElement).closest("button")) return;
    dragRef.current = { x0: e.clientX, y0: e.clientY, dx: 0, live: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.live) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        dragRef.current = null;
        return;
      }
      drag.live = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    drag.dx = dx;
    if (!reducedMotion) setDragX(dx);
  };
  const releasePointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    setDragX(0);
    if (!drag.live) return; // never crossed activation → a tap, and a tap corrects (not a drag)
    dragJustEndedRef.current = true; // suppress the click this release is about to dispatch
    if (drag.dx > 90) onConfirm();
    else if (drag.dx < -90) onSkip();
  };

  // The card's tap-to-correct. Checks-and-clears the drag guard first: a completed swipe's pointer
  // release still dispatches a click, and by then `dragging` state has already been reset.
  const onCardClick = () => {
    if (dragJustEndedRef.current) {
      dragJustEndedRef.current = false;
      return;
    }
    if (!back) openBack();
  };

  if (loadError && !blocks)
    return (
      <main className="jobblocks">
        <h1>This screen isn&apos;t available</h1>
        <p className="lede">{loadError}</p>
        <button className="btn" onClick={load}>
          Try again
        </button>
      </main>
    );

  if (!blocks || !readStatus) return <main className="jobblocks jb-deckarea"><p className="jb-kicker">Reading your work history…</p></main>;

  const total = blocks.length;
  const checked = confirmedIds.size;
  const skippedPending = [...skippedIds].filter((id) => !confirmedIds.has(id)).length;
  const done = queue.length === 0;

  if (total === 0) {
    const copy = emptyCopy(readStatus);
    return (
      <main className="jobblocks">
        <h1>{copy.h}</h1>
        <p className="lede">{copy.p}</p>
        <button className="btn" onClick={() => router.push(`/deck/${jobId}`)}>
          Continue
        </button>
      </main>
    );
  }

  return (
    <main className="jobblocks">
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      <h1>Check your work history</h1>
      <p className="lede">
        Right if we got it right · left to come back to it later · tap the card to put it right. Everything
        here stays on your CV — the kind only decides what adds to your years of experience.
      </p>

      <div className="jb-layout">
        <div className="jb-deckarea">
          {done ? (
            <div className="jb-done">
              <h2>That&apos;s your history straight.</h2>
              <p className="jb-kicker">
                {yearsStr(confirmedMonths)} confirmed
                {correctionsCount ? `, and you put ${correctionsCount} thing${correctionsCount === 1 ? "" : "s"} right` : ""}
                . Everything here is now a fact about you — you won&apos;t be asked again unless you come back to
                fix it.
              </p>
              <button className="btn" onClick={() => router.push(`/deck/${jobId}`)}>
                Continue
              </button>
            </div>
          ) : (
            current && (
              <>
                <p className="jb-kicker">
                  {checked} of {total} checked{skippedPending ? ` · ${skippedPending} to come back to` : ""}
                </p>
                <div className="jb-cardstack">
                  {queue.length > 2 && <div className="jb-peek two" aria-hidden="true" />}
                  {queue.length > 1 && <div className="jb-peek" aria-hidden="true" />}
                  <div
                    ref={cardRef}
                    tabIndex={-1}
                    className={[
                      "jb-card",
                      back ? "back" : "",
                      dragging ? "dragging" : "",
                      leaving ? `out-${leaving}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={!dragging || reducedMotion ? undefined : { transform: `translateX(${dragX}px) rotate(${dragX * 0.045}deg)` }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={releasePointer}
                    onPointerCancel={releasePointer}
                    onClick={onCardClick}
                  >
                    {back && draft ? (
                      <BackPanel
                        draft={draft}
                        setDraft={setDraft}
                        original={current}
                        allBlocks={blocks}
                        busy={busy}
                        onSave={saveBack}
                        onCancel={cancelBack}
                      />
                    ) : (
                      <FrontCard
                        block={current}
                        allBlocks={blocks}
                        dragX={dragX}
                        reducedMotion={reducedMotion}
                        onResolveMatch={onResolveMatch}
                        busy={busy}
                      />
                    )}
                  </div>
                </div>
                {!back && current.matchState !== "ambiguous" && (
                  <div className="jb-swipehint">
                    {/* Keyboard/screen-reader path to correcting — tapping the card does the same
                        thing, but the card itself is a drag surface, not a focusable control. */}
                    <button className="jb-cbtn fix" onClick={openBack} disabled={busy}>
                      Put it right
                    </button>
                    <button className="jb-cbtn neutral" onClick={onSkip} disabled={busy}>
                      Skip for now
                    </button>
                    <button className="jb-cbtn yes" onClick={onConfirm} disabled={busy}>
                      That&apos;s right
                    </button>
                  </div>
                )}
                {actionError && (
                  <p className="error" role="alert" style={{ marginTop: 12 }}>
                    {actionError}
                  </p>
                )}
              </>
            )
          )}
          {undo && (
            <div className="jb-undo">
              <span>{undo.label}</span>
              <button onClick={onUndo}>Undo</button>
            </div>
          )}
        </div>

        <aside className="jb-prog">
          <h2>Your progress</h2>
          <div className="jb-stat">
            <div ref={checkedRef} className={`v${bump.checked ? " bump" : ""}`}>
              {checked} of {total}
            </div>
            <div className="l">checked{skippedPending ? ` · ${skippedPending} to come back to` : ""}</div>
          </div>
          <div className="jb-stat">
            <div className={`v${confirmedMonths ? " growing" : ""}${bump.exp ? " bump" : ""}`}>{yearsStr(confirmedMonths)}</div>
            <div className="l">experience confirmed</div>
          </div>
          <div className="jb-stat">
            <div className="v">{correctionsCount}</div>
            <div className="l">{correctionsCount === 1 ? "thing you put right" : "things you put right"}</div>
          </div>
        </aside>
      </div>

      {chip && (
        <div
          className="jb-chip"
          aria-hidden="true"
          style={{ left: chip.from.left + chip.from.width / 2, top: chip.from.top + chip.from.height / 2 }}
          ref={(el) => {
            if (!el || !checkedRef.current) return;
            requestAnimationFrame(() => {
              const b = checkedRef.current!.getBoundingClientRect();
              el.style.transform = `translate(${b.left + b.width / 2 - (chip.from.left + chip.from.width / 2)}px, ${
                b.top + b.height / 2 - (chip.from.top + chip.from.height / 2)
              }px) scale(.6)`;
              el.style.opacity = "0";
            });
          }}
        >
          + {chip.label}
        </div>
      )}
    </main>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

// ---- the front: states what we understood, tells her what it means. Never asks "is this work?" ----
function FrontCard({
  block,
  allBlocks,
  dragX,
  reducedMotion,
  onResolveMatch,
  busy,
}: {
  block: JobBlockView;
  allBlocks: JobBlockView[];
  dragX: number;
  reducedMotion: boolean;
  onResolveMatch: (same: boolean) => void;
  busy: boolean;
}) {
  const stampOpacity = !reducedMotion ? Math.min(1, Math.abs(dragX) / 110) : 0;

  if (block.matchState === "ambiguous") {
    const candidateBlock = allBlocks.find((b) => block.candidateBlockIds.includes(b.id));
    return (
      <>
        <span className="jb-kindtag" data-ask="true">
          We weren&apos;t sure about this one
        </span>
        <p className="jb-readback">
          Your CV also lists <b>{block.title.value || KIND_META[block.kind].label}</b> at{" "}
          <b>{block.employer.value}</b>, {fmtRange(block.start.value, block.end.value)}.
          {candidateBlock && (
            <>
              {" "}
              Is that the same job as <b>{candidateBlock.title.value}</b> at <b>{candidateBlock.employer.value}</b>?
            </>
          )}
        </p>
        <div className="jb-swipehint" style={{ marginTop: 16 }}>
          <button className="jb-cbtn fix" onClick={() => onResolveMatch(false)} disabled={busy}>
            No, a different job
          </button>
          <button className="jb-cbtn yes" onClick={() => onResolveMatch(true)} disabled={busy}>
            Yes, the same job
          </button>
        </div>
        <p className="jb-quote">From your CV: &ldquo;{block.employer.origin.kind === "read" ? block.employer.origin.source_quote : block.employer.value}&rdquo;</p>
      </>
    );
  }

  const quote = block.employer.origin.kind === "read" ? block.employer.origin.source_quote : block.title.origin.kind === "read" ? block.title.origin.source_quote : null;

  let tag = "From your work history";
  let ask = false;
  let body: React.ReactNode;

  if (block.kind === "education") {
    tag = "From your education";
    body = (
      <>
        You studied <b>{block.title.value}</b> at <b>{block.employer.value}</b>,{" "}
        {fmtRange(block.start.value, block.end.value)}.
        <br />
        <br />
        We&apos;ve put this down as <b>your education</b> — so it doesn&apos;t add to your years of experience.
      </>
    );
  } else if (block.kind === "volunteering") {
    tag = "From your work history";
    body = (
      <>
        You volunteered as <b>{block.title.value}</b> at <b>{block.employer.value}</b>,{" "}
        {fmtRange(block.start.value, block.end.value)}.
        <br />
        <br />
        We&apos;ve put this down as <b>volunteering</b> — so it doesn&apos;t add to your years of experience.
      </>
    );
  } else if (block.kind === "project") {
    tag = "From your projects";
    body = (
      <>
        You worked on <b>{block.title.value}</b>
        {block.employer.value ? (
          <>
            {" "}
            at <b>{block.employer.value}</b>
          </>
        ) : null}
        , {fmtRange(block.start.value, block.end.value)}.
        <br />
        <br />
        We&apos;ve put this down as <b>a project</b> — so it doesn&apos;t add to your years of experience.
      </>
    );
  } else if (block.kind === "client") {
    tag = "We weren't sure about this one";
    ask = true;
    body = (
      <>
        Your CV lists <b>{block.employer.value}</b>, {fmtRange(block.start.value, block.end.value)}, underneath
        another employer.
        <br />
        <br />
        We&apos;ve put this down as <b>a client you worked for</b> rather than a job of its own — so it doesn&apos;t
        add to your years of experience. Have we got that right?
      </>
    );
  } else if (block.end.value.state === "unknown") {
    tag = "We weren't sure about this one";
    ask = true;
    body = (
      <>
        You&apos;ve been <b>{block.title.value}</b> at <b>{block.employer.value}</b> since{" "}
        <b>{fmtDate(block.start.value)}</b>.
        <br />
        <br />
        We couldn&apos;t tell when it ended — so right now it adds <b>nothing</b> to your experience.
      </>
    );
  } else {
    body = (
      <>
        You were <b>{block.title.value}</b> at <b>{block.employer.value}</b>, from{" "}
        <b>{fmtDate(block.start.value)}</b> to <b>{fmtEnd(block.end.value)}</b>.
        <br />
        <br />
        We&apos;ve put this down as <b>a job</b> — it adds to your years of experience.
      </>
    );
  }

  return (
    <>
      <span className="jb-stamp yes" style={{ opacity: dragX > 0 ? stampOpacity : 0 }}>
        That&apos;s right
      </span>
      <span className="jb-stamp fix" style={{ opacity: dragX < 0 ? stampOpacity : 0 }}>
        Skip for now
      </span>
      <span className="jb-kindtag" data-ask={ask ? "true" : "false"}>
        {tag}
      </span>
      <p className="jb-readback">{body}</p>
      {quote && <p className="jb-quote">From your CV: &ldquo;{quote}&rdquo;</p>}
    </>
  );
}

// ---- the back: one frame, correction controls (#157 Design A "the frame generalises, the editing
// controls do not") ----
function BackPanel({
  draft,
  setDraft,
  original,
  allBlocks,
  busy,
  onSave,
  onCancel,
}: {
  draft: JobBlockView;
  setDraft: (d: JobBlockView) => void;
  original: JobBlockView;
  allBlocks: JobBlockView[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const cur = allBlocks.reduce((n, b) => n + monthsOf(b), 0);
  const next = allBlocks.reduce((n, b) => n + monthsOf(b.id === draft.id ? draft : b), 0);
  const dm = next - cur;

  const setEnd = (state: MinedEndValue["state"]) => {
    if (state === "ended") {
      const date = draft.end.value.state === "ended" ? draft.end.value.date : { year: NOW.getFullYear(), month: NOW.getMonth() + 1, precision: "month" as const };
      setDraft({ ...draft, end: { ...draft.end, value: { state: "ended", date } } });
    } else {
      setDraft({ ...draft, end: { ...draft.end, value: { state } } });
    }
  };

  return (
    <div className="jb-back">
      <h3>Put it right</h3>
      <div className="jb-fgrp">
        <label htmlFor="jb-employer">{draft.kind === "education" ? "Institution" : "Employer"}</label>
        <input
          id="jb-employer"
          type="text"
          value={draft.employer.value}
          onChange={(e) => setDraft({ ...draft, employer: { ...draft.employer, value: e.target.value } })}
        />
      </div>
      <div className="jb-fgrp">
        <label htmlFor="jb-title">{draft.kind === "education" ? "What you studied" : "Job title"}</label>
        <input
          id="jb-title"
          type="text"
          value={draft.title.value}
          onChange={(e) => setDraft({ ...draft, title: { ...draft.title, value: e.target.value } })}
        />
      </div>
      <div className="jb-fgrp">
        <label>Started</label>
        <div className="jb-fieldrow">
          <div>
            <select
              aria-label="Start month"
              value={draft.start.value.precision === "month" ? String(draft.start.value.month) : ""}
              onChange={(e) => {
                const v = e.target.value;
                setDraft({
                  ...draft,
                  start: {
                    ...draft.start,
                    value: v
                      ? { year: draft.start.value.year, month: Number(v), precision: "month" }
                      : { year: draft.start.value.year, month: null, precision: "year" },
                  },
                });
              }}
            >
              <option value="">— no month —</option>
              {MONTHS.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              aria-label="Start year"
              value={draft.start.value.year}
              onChange={(e) =>
                setDraft({ ...draft, start: { ...draft.start, value: { ...draft.start.value, year: Number(e.target.value) } } })
              }
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="jb-fgrp">
        <label>Ended</label>
        <div className="jb-choice">
          <button type="button" aria-pressed={draft.end.value.state === "ended"} onClick={() => setEnd("ended")}>
            <strong>On a date</strong>
          </button>
          <button type="button" aria-pressed={draft.end.value.state === "ongoing"} onClick={() => setEnd("ongoing")}>
            <strong>I&apos;m still there</strong>
          </button>
          <button type="button" aria-pressed={draft.end.value.state === "unknown"} onClick={() => setEnd("unknown")}>
            <strong>I&apos;m not sure</strong>
            <span>We&apos;ll leave it open rather than guess — but it means this adds nothing to your total.</span>
          </button>
        </div>
        {draft.end.value.state === "ended" && (
          <div className="jb-fieldrow" style={{ marginTop: 8 }}>
            <div>
              <select
                aria-label="End month"
                value={draft.end.value.date.precision === "month" ? String(draft.end.value.date.month) : ""}
                onChange={(e) => {
                  if (draft.end.value.state !== "ended") return;
                  const v = e.target.value;
                  const date = v
                    ? { year: draft.end.value.date.year, month: Number(v), precision: "month" as const }
                    : { year: draft.end.value.date.year, month: null, precision: "year" as const };
                  setDraft({ ...draft, end: { ...draft.end, value: { state: "ended", date } } });
                }}
              >
                <option value="">— no month —</option>
                {MONTHS.slice(1).map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <select
                aria-label="End year"
                value={draft.end.value.date.year}
                onChange={(e) => {
                  if (draft.end.value.state !== "ended") return;
                  setDraft({
                    ...draft,
                    end: { ...draft.end, value: { state: "ended", date: { ...draft.end.value.date, year: Number(e.target.value) } } },
                  });
                }}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      <div className="jb-fgrp">
        <label>What is this?</label>
        <div className="jb-choice">
          {(Object.keys(KIND_META) as JobBlockKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={draft.kind === k}
              onClick={() => setDraft({ ...draft, kind: k, kindDecision: { ...draft.kindDecision, value: k } })}
            >
              <strong>{KIND_META[k].label}</strong>
              <span>{KIND_META[k].blurb}</span>
            </button>
          ))}
        </div>
        <p className="jb-note">
          Everything here stays on your CV. The kind only decides what adds to your years of experience —{" "}
          {draft.kind === "job" ? "and this one does" : "and this one doesn't"}.
        </p>
      </div>
      <div className={`jb-consequence${dm === 0 ? " none" : ""}`}>
        {dm === 0
          ? "This doesn't change your confirmed experience."
          : `This ${dm > 0 ? "adds" : "removes"} about ${yearsStr(Math.abs(dm))} of confirmed experience.`}
      </div>
      <div className="jb-backacts">
        <button className="btn" onClick={onSave} disabled={busy}>
          Save and continue
        </button>
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
