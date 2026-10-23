"use client";

// #23 Tailor (screen 3), reshaped by #415 (ADR-0020 clauses 1, 2, 6). Reached from /deck's "I want
// this one" -> tailorHandoff bridge. Two screens, decided by the server's queue:
//   - a profile question is open (work rights, a language): the SAME card anatomy as /deck
//     (jobcard.tsx's CardBody) over the question dock — answered once ever, then never again;
//   - nothing is open: the draft is the page (TailorDraft), with a side rail beside it. The rail
//     holds the after-line of the answer that led here, the "Also asked, not on your CV" list (no
//     button until the CV chat ships, #350) and the exits; #417 drops its stretch suggestion cards
//     into it (see the marked slot). "Where you fit" is a sheet: side on a computer, pull-up on a
//     phone, every requirement in the job's own order.
// Every value — matchPct, the requirements list and their verdicts, the after-line — is
// server-composed. This screen never re-derives any of it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "../deck.css";
import "../tailor.css";
import { FactBadge } from "../factbadge";
import { CardBody, MatchBreakdown, ScoreRing, useReducedMotion } from "../jobcard";
import { PasteDoor } from "../pastedoor";
import { TailorDraft } from "./draft";
import { StretchCards, nextPending, pendingOf, type StretchEdit, type StretchEditNote, type StretchRailView } from "./stretch";
import {
  answerStretch,
  editStretchWording,
  answerTailorProfile,
  dropTailor,
  ensureSession,
  getTailor,
  type TailorQuestion,
  type TailorRequirement,
  type TailorState,
} from "../../lib/api";

// #307: "gone" is the state after a permanent answer withdrew the very job being tailored — the
// server cleared the target and handed back the line saying what changed, plus (#309) the
// withdrawal's named reason, so the honest consequence carries its rule and the way back.
type Screen = "loading" | "error" | "flow" | "saved" | "gone";

// #117c (addendum §12.5): was "Opening this job…", written for a cache read. ~7 of 15 cards now
// judge on demand here (§11), a genuinely cold call of several seconds — "Opening" promises an
// instant action a multi-second wait would then contradict. Matches U4 (deck/page.tsx, §11.4) word
// for word so the deck -> handoff -> tailor-loading sequence reads as one continuous statement.
const T1 = "Scoring this job against your facts…";
const T2 = "Couldn't open this job.";
const T3 = "Try again";
const T4 = "Answer and this card moves";
const T6 = "your CV for this job";
const T7 = "Couldn't save that — try again.";
const T9 = "Drop this job";
const T10 = "Everything you told me stays on your profile.";
const T11 = "Drop it";
const T12 = "Keep it";
const T16 = "Save it and come back later";
const T19 = "Saved";
const T21 = "Back to the deck";
const T22 = "Saved to your profile"; // #307: the gone screen's heading — the answer is kept; the job is not
const DROP_FAILED = "Couldn't drop this job — try again.";
// #415: the draft screen's own voice (the approved prototype's words).
const T24 = "your CV is written only from what is true about you";
const T25 = "Answer this and your CV is written, from what is true about you.";
const T26 = "Where you fit";
const T27 = "Also asked, not on your CV";
const T28 = "Your report gives you a sentence to say about this.";
const T29 = "Close";
const STATE_LABEL: Record<TailorRequirement["state"], string> = {
  met: "met",
  stretched: "met by a stretch", // #418 (ADR-0020 clause 4): never passed off as a plain match
  gap: "not on your CV",
  untested: "not tested",
};
const MARK: Record<TailorRequirement["state"], string> = { met: "✓", stretched: "◆", gap: "–", untested: "–" };
// #418: the score's own announcement — the only place the new number is said (no "+N%" anywhere).
const T30 = (pct: number) => `Match now ${pct}%`;

const SCORE_TWEEN_MS = 680;
const SCORE_BUMP_MS = 470;
// #418 (the approved prototype's beat): a gold mote flies to the number, then it rolls up and glows.
const MOTE_MS = 720;
const GLOW_MS = 1100;

// #309: the score may fall, and the fall is shown with its cause. When the new server number sits
// below the last server number, the answer's own server-composed line is prefixed with the size of
// the drop — narration from two server-given values, like the tween; never a re-derived score.
function withFall(prevPct: number, nextPct: number, cause: string): string {
  return nextPct < prevPct ? `Down ${prevPct - nextPct}% — ${cause}` : cause;
}

// #397: a job with no title (or no after-line yet) leaves no empty slot behind — never
// "“” is waiting" or "79% match. ." in the announcer.
function savedLine(title: string, matchPct: number): string {
  const what = title ? `“${title}” is` : "This job is";
  return `${what} waiting for you at ${matchPct}%. Pick it up whenever you want.`;
}

function sentences(...parts: Array<string | undefined | null>): string {
  return parts.filter((p) => p).map((p) => `${p}.`).join(" ");
}

export default function TailorPage() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [screen, setScreen] = useState<Screen>("loading");
  const [tailor, setTailor] = useState<TailorState | null>(null);
  const [displayPct, setDisplayPct] = useState(0);
  const [scoreBumped, setScoreBumped] = useState(false);
  const [scoreLit, setScoreLit] = useState(false); // #418: the brief gold glow
  // #307: the after-line of a permanent answer — the one line saying what the answer did. Shown
  // under the next question, or beside the draft when that answer was the last thing asked.
  const [ledgerView, setLedgerView] = useState<{ key: string; text: string; fell?: boolean } | null>(null);
  const [answering, setAnswering] = useState<{ requirementId: string; answer: string } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  // #307: the after-line of a permanent answer that took the tailored job itself off the deck.
  const [goneNote, setGoneNote] = useState<string | null>(null);
  // #309 AC3: why THIS job went — the withdrawal's named reason, above the after-line.
  const [goneReason, setGoneReason] = useState<string | null>(null);
  const [dropConfirming, setDropConfirming] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [returnDropFocus, setReturnDropFocus] = useState(false);
  // #415: the "Where you fit" sheet — open/closed, and whether focus must go back to its trigger.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [returnSheetFocus, setReturnSheetFocus] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  // #17 the profile badge: same seam as discovery — the parent owns the data, FactBadge owns motion.
  // No chip flies on this screen any more (#415): a profile answer never moves the count.
  const [badgeCount, setBadgeCount] = useState(0);
  // #417: the stretch suggestions beside the draft (read with the draft), the one open, and the
  // "look again" counter that remounts the draft so a failed step runs once more.
  const [stretch, setStretch] = useState<StretchRailView>(undefined);
  const [openStretch, setOpenStretch] = useState<string | null>(null);
  const [stretchAnswering, setStretchAnswering] = useState(false);
  const [lookAgain, setLookAgain] = useState(0);
  const autoOpenedRef = useRef(false);
  const focusStretchRef = useRef(false);
  const stretchHeadingRef = useRef<HTMLHeadingElement>(null);
  // #420: "Edit wording" — the line being edited (in place: the draft's frame on a computer, the
  // card on a phone), the latest text typed (a ref: the editable line owns its own DOM text), the
  // note after an edit, and the frame's revision (an ended edit loads a fresh document).
  const [stretchEdit, setStretchEdit] = useState<StretchEdit>(null);
  const [editNote, setEditNote] = useState<StretchEditNote>(null);
  const [frameRev, setFrameRev] = useState(0);
  const editTextRef = useRef<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const focusEditRef = useRef(false);

  const rootRef = useRef<HTMLDivElement>(null);
  // One heading per screen: the card's h2 on the question screen, the job's h1 beside the draft.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const savedHeadingRef = useRef<HTMLHeadingElement>(null);
  const goneHeadingRef = useRef<HTMLHeadingElement>(null); // #307

  const firstControlRef = useRef<HTMLElement | null>(null);
  const setFirstControl = (el: HTMLElement | null) => {
    firstControlRef.current = el;
  };
  const dropTriggerRef = useRef<HTMLButtonElement>(null);
  const dropItRef = useRef<HTMLButtonElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);

  const enteredRef = useRef(false);
  const askKeyInitRef = useRef(false);
  const prevAskKeyRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureSession();
      const state = await getTailor();
      setTailor(state);
      setDisplayPct(state.card.matchPct);
      setBadgeCount((c) => Math.max(c, state.factCount)); // the monotone clamp, at every write
      setScreen("flow");
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
      // #30: a signed-out visitor hits this on direct load (no session yet to carry a tailor target).
      // /deck already walls the reveal for an unauthed visitor (its own onSeeThem gate) — same
      // destination as no_tailor_target, not a new one.
      //
      // #63: `not_found` joins them, because this screen can no longer recover from it. The advert
      // being tailored is resolved from the session's retrieval snapshot, and changing her evidence
      // or where she is looking correctly stales that snapshot — a decided fail-closed rule (#101,
      // pinned by postingRetrievalHttp.test.ts) that the fixture pool used to hide. Nothing on THIS
      // screen re-runs retrieval, so the old "Try again" button re-sent the same doomed request for
      // ever and left her with no way back to her jobs. The deck is where retrieval re-runs and
      // where her target comes back, so that is where she goes. Her session and her target are
      // untouched — this is a redirect, not a reset.
      if (code === "no_tailor_target" || code === "login_required" || code === "not_found") {
        router.replace("/deck"); // never leave /tailor in history — it would just redirect forward again
        return;
      }
      setScreen("error");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Unmount safety net (CODING_STANDARDS: effects clean up timers/rAF in teardown).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      document.querySelectorAll(".mote").forEach((m) => m.remove());
    };
  }, []);

  // Entry (§7.2): focus the screen's heading once, ever, on the first successful load. Announce
  // once — every later announce (a new question, the draft) is the askKey effect below.
  useEffect(() => {
    if (screen !== "flow" || !tailor || enteredRef.current) return;
    enteredRef.current = true;
    headingRef.current?.focus();
    setLiveMessage(sentences(tailor.card.title && `Tailoring ${tailor.card.title}`, `${tailor.card.matchPct}% match`));
  }, [screen, tailor]);

  // #415: the queue is the profile questions alone — empty means the draft is the page.
  const showDraft = !!tailor && tailor.questions.length === 0;
  const askKey = !tailor ? null : showDraft ? "draft" : (tailor.questions[0]?.requirementId ?? null);

  // §7.3/§7.9: after each answer, focus the next question's first option and announce once
  // (discovery's firstControlRef + askKey precedent); on reaching the draft, focus its heading and
  // announce the number with the answer's own after-line (a different string from the heading — no
  // true double).
  useEffect(() => {
    if (!askKey || !tailor) return;
    if (!askKeyInitRef.current) {
      askKeyInitRef.current = true;
      prevAskKeyRef.current = askKey;
      return; // the entry effect above owns focus for the very first paint
    }
    if (askKey === prevAskKeyRef.current) return;
    prevAskKeyRef.current = askKey;
    if (askKey === "draft") headingRef.current?.focus();
    else firstControlRef.current?.focus();
    setLiveMessage(sentences(`${tailor.card.matchPct}% match`, ledgerView?.text));
  }, [askKey, tailor, ledgerView]);

  // F3: the one transition that unmounts the whole flow — nothing else moves focus off it, so it
  // silently drops to <body> without this. Mirrors the entry/askKey effects above: focus the heading,
  // announce once. `tailor` never changes again once here, so (unlike entry) no latch is needed —
  // this only ever fires on the `screen` transition itself.
  useEffect(() => {
    if (!tailor) return;
    if (screen === "saved") {
      savedHeadingRef.current?.focus();
      setLiveMessage(savedLine(tailor.card.title, tailor.card.matchPct));
    }
  }, [screen, tailor]);

  // #307: same rule for the gone screen — its transition unmounts the whole flow, so focus the
  // heading and announce once. #309: the reason leads the announcement when the server named one.
  useEffect(() => {
    if (screen !== "gone" || !goneNote) return;
    goneHeadingRef.current?.focus();
    setLiveMessage(goneReason ? `${goneReason} ${goneNote}` : goneNote);
  }, [screen, goneNote, goneReason]);

  // #417: the first pending suggestion opens by itself when the draft (and its suggestions) land —
  // once; after that the person decides what is open. Focus stays on the page heading then.
  const onStretch = useCallback((next: StretchRailView) => {
    setStretch(next);
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setOpenStretch(nextPending(next, null));
  }, []);

  // #417: a user-initiated move (J/K, Previous/Later, the list, an answer) focuses the open card's
  // heading and announces it once; the frame follows through `open` (draft.tsx).
  const openSuggestion = useCallback((id: string | null) => {
    focusStretchRef.current = id !== null;
    setOpenStretch(id);
    setEditNote(null);
  }, []);
  useEffect(() => {
    if (!openStretch || !tailor || !focusStretchRef.current) return;
    focusStretchRef.current = false;
    stretchHeadingRef.current?.focus();
    if (stretch?.status === "ran") {
      const n = stretch.suggestions.findIndex((s) => s.id === openStretch) + 1;
      const s = stretch.suggestions[n - 1];
      const text = tailor.requirements.find((r) => r.id === s?.requirementId)?.text ?? "";
      setLiveMessage(`Suggestion ${n} of ${stretch.suggestions.length}: ${text}`);
    }
  }, [openStretch, stretch, tailor]);

  // #420: E (or "Edit wording") starts the edit; E, Esc or "Done editing" ends it. An ended edit
  // with a new line is sent — the server rewrites what to say for it and stores the two together;
  // an unchanged one sends nothing; an emptied one keeps the suggestion's wording and says so; a
  // failed save keeps the person's text in the line to try again. Focus returns to the control.
  function startStretchEdit(id: string) {
    editTextRef.current = null;
    setEditNote(null);
    setStretchEdit({ id, saving: false });
  }
  async function endStretchEdit() {
    const edit = stretchEdit;
    if (!edit || edit.saving) return;
    const current = stretch?.status === "ran" ? stretch.suggestions.find((s) => s.id === edit.id)?.claimText : undefined;
    const typed = editTextRef.current;
    const text = typed?.replace(/\s+/g, " ").trim();
    focusEditRef.current = true;
    if (typed === null || text === current) {
      setStretchEdit(null);
      setFrameRev((n) => n + 1);
      return;
    }
    if (!text) {
      setStretchEdit(null);
      setEditNote({ id: edit.id, kind: "kept" });
      setFrameRev((n) => n + 1);
      return;
    }
    setStretchEdit({ id: edit.id, saving: true });
    try {
      const { stretch: next } = await editStretchWording(edit.id, text);
      setStretch(next);
      setStretchEdit(null);
      setFrameRev((n) => n + 1);
    } catch {
      focusEditRef.current = false; // back into the line, with the text still in it
      setEditNote({ id: edit.id, kind: "failed" });
      setStretchEdit({ id: edit.id, saving: false });
    }
  }
  const toggleStretchEdit = (id: string) => void (stretchEdit?.id === id ? endStretchEdit() : startStretchEdit(id));
  useEffect(() => {
    if (stretchEdit !== null || !focusEditRef.current) return;
    focusEditRef.current = false;
    editButtonRef.current?.focus();
  }, [stretchEdit]);

  async function answerStretchNo(id: string) {
    if (stretchAnswering) return;
    setStretchAnswering(true);
    try {
      const { stretch: next } = await answerStretch(id, "no");
      setStretch(next);
      openSuggestion(nextPending(next, id));
    } catch {
      setAskError(T7);
    } finally {
      setStretchAnswering(false);
    }
  }

  // #418 (ADR-0020 clause 4): "Use for this job". The server swaps the line and re-composes the
  // card; this screen re-reads the state and moves the number with the reward beat — a gold mote
  // from the card to the ring (720ms), then the roll-up, the bump and a brief glow. No "+N%" is
  // ever written: the number is the statement. Reduced motion swaps the number at once.
  async function answerStretchUse(id: string) {
    if (stretchAnswering) return;
    setStretchAnswering(true);
    const from = stretchHeadingRef.current?.getBoundingClientRect();
    try {
      const { stretch: next } = await answerStretch(id, "use");
      setStretch(next);
      openSuggestion(nextPending(next, id));
      const state = await getTailor();
      setTailor(state);
      await moveScore(state.card.matchPct, from);
    } catch {
      setAskError(T7);
    } finally {
      setStretchAnswering(false);
    }
  }

  // #418: Undo from the "Ready to send" summary — the answer is withdrawn, the suggestion reopens
  // (pending again), and the number counts down quietly: no mote, no glow.
  async function undoStretch(id: string) {
    if (stretchAnswering) return;
    setStretchAnswering(true);
    try {
      const { stretch: next } = await answerStretch(id, "undo");
      setStretch(next);
      openSuggestion(id);
      const state = await getTailor();
      setTailor(state);
      setLiveMessage(T30(state.card.matchPct));
      tweenScore(displayPct, state.card.matchPct);
    } catch {
      setAskError(T7);
    } finally {
      setStretchAnswering(false);
    }
  }

  /** The reward beat, then the number. `from` is where the mote starts (the open card's heading). */
  async function moveScore(to: number, from: DOMRect | undefined) {
    setLiveMessage(T30(to));
    if (!reducedMotion && from) await flyMote(from);
    if (!reducedMotion) {
      setScoreLit(true);
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      glowTimerRef.current = setTimeout(() => setScoreLit(false), GLOW_MS);
    }
    tweenScore(displayPct, to);
  }

  /** A 7px gold dot, flown with the Web Animations API from `from` to the ring's number and
   *  removed when it lands (the prototype's flyMote). Resolves when it has landed. */
  function flyMote(from: DOMRect): Promise<void> {
    const to = scoreRef.current?.querySelector(".n")?.getBoundingClientRect();
    if (!to || typeof HTMLElement.prototype.animate !== "function") return Promise.resolve();
    const mote = document.createElement("div");
    mote.className = "mote";
    mote.setAttribute("aria-hidden", "true");
    document.body.appendChild(mote);
    const x0 = from.left + Math.min(from.width, 40);
    const y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2;
    const y1 = to.top + to.height / 2;
    const anim = mote.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 0.2 },
        { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 80}px) scale(1.3)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${x1}px, ${y1}px) scale(0.6)`, opacity: 1 },
      ],
      { duration: MOTE_MS, easing: "cubic-bezier(.45,0,.2,1)" },
    );
    return anim.finished.then(
      () => mote.remove(),
      () => mote.remove(),
    );
  }

  // #417: J/K move between suggestions, N answers No, Esc closes the card — only on the draft
  // screen, never while a dialog is up or the focus is in a field (the prototype's wiring).
  // #418: U answers Use.
  const showDraftNow = !!tailor && tailor.questions.length === 0 && screen === "flow";
  useEffect(() => {
    if (!showDraftNow || sheetOpen || dropConfirming) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea, [contenteditable='true']") || e.metaKey || e.ctrlKey || e.altKey;
      const key = e.key.toLowerCase();
      // #420: while a line is edited, Esc ends the edit (it does not close the card), E ends it from
      // outside the line, and nothing else answers.
      if (stretchEdit) {
        if (key === "escape" || (key === "e" && !typing)) {
          e.preventDefault();
          void endStretchEdit();
        }
        return;
      }
      if (typing) return;
      if (key === "escape") {
        if (openStretch) openSuggestion(null);
        return;
      }
      if (pendingOf(stretch).length === 0) return;
      if (key === "j") openSuggestion(nextPending(stretch, openStretch, 1));
      else if (key === "k") openSuggestion(nextPending(stretch, openStretch, -1));
      else if (key === "n" && openStretch) void answerStretchNo(openStretch);
      else if (key === "u" && openStretch) void answerStretchUse(openStretch);
      else if (key === "e" && openStretch) {
        e.preventDefault(); // the key starts the edit; it is not typed into the line
        startStretchEdit(openStretch);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showDraftNow, sheetOpen, dropConfirming, stretch, openStretch, openSuggestion, stretchAnswering, stretchEdit]);

  // useCallback (not a plain function) so it can be named, honestly, in the Escape effect's deps
  // below (discovery's cancelCorrection precedent, discovery/page.tsx:338-345) — this repo has no
  // eslint to catch a silently-stale closure if it's ever left out.
  const closeDropConfirm = useCallback(() => {
    setDropConfirming(false);
    setDropError(null);
    setReturnDropFocus(true);
  }, []);

  useEffect(() => {
    if (!dropConfirming) return;
    dropItRef.current?.focus();
  }, [dropConfirming]);

  useEffect(() => {
    if (!returnDropFocus) return;
    dropTriggerRef.current?.focus();
    setReturnDropFocus(false);
  }, [returnDropFocus]);

  useEffect(() => {
    if (!dropConfirming) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeDropConfirm();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dropConfirming, closeDropConfirm]);

  // #415: the sheet is a dialog — focus moves in (Close), Escape closes, focus returns to the
  // trigger. Same shape as the drop confirm above.
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setReturnSheetFocus(true);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    sheetCloseRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeSheet();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen, closeSheet]);

  useEffect(() => {
    if (!returnSheetFocus) return;
    sheetTriggerRef.current?.focus();
    setReturnSheetFocus(false);
  }, [returnSheetFocus]);

  // Tweens the ring + number from `from` to `to` (proto's rAF easing, job-card.prototype.html:387-402);
  // reduced motion (or a no-op change) snaps straight to the final value. #309: the score may FALL —
  // the old defensive Math.max(from, to) floor is gone with the server's own; an honest correction
  // tweens the number down, and the after-line beside it names the answer that did it.
  function tweenScore(from: number, to: number) {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setScoreBumped(true);
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = setTimeout(() => setScoreBumped(false), SCORE_BUMP_MS);
    if (reducedMotion || from === to) {
      setDisplayPct(to);
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / SCORE_TWEEN_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplayPct(Math.round(from + (to - from) * eased));
      rafRef.current = k < 1 ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  // #307: a profile-level answer is permanent, so it takes its own door (answerTailorProfile) and
  // its own after-line — the server's `changed` sentence lands in the after-line slot, or, when the
  // answer took this very job off the deck, on the gone screen (state === null; the target is
  // already cleared server-side). No flying fact chip: a profile fact never moves the badge count.
  async function answerProfileQuestion(requirementId: string, answer: string) {
    if (answering || !tailor) return;
    setAnswering({ requirementId, answer });
    setAskError(null);
    const prevPct = tailor.card.matchPct; // #309: the fall's size is server-number to server-number
    try {
      const { changed, state, withdrawal } = await answerTailorProfile(requirementId, answer);
      if (!state) {
        // #309 AC3: the withdrawal names its reason — he just answered, so the job's disappearance
        // must read as a rule, not a bug. The reason leads; the after-line keeps the count + undo.
        setGoneReason(withdrawal ?? null);
        setGoneNote(changed);
        setScreen("gone");
        return;
      }
      setLedgerView({
        key: `profile:${requirementId}`,
        text: withFall(prevPct, state.card.matchPct, changed),
        fell: state.card.matchPct < prevPct,
      });
      setBadgeCount((c) => Math.max(c, state.factCount));
      setTailor(state);
      tweenScore(displayPct, state.card.matchPct);
    } catch {
      setAskError(T7);
    } finally {
      setAnswering(null);
    }
  }

  function openDropConfirm() {
    setDropConfirming(true);
    setDropError(null);
  }

  async function onDropIt() {
    setDropBusy(true);
    setDropError(null);
    try {
      await dropTailor();
      router.push("/deck");
    } catch {
      setDropError(DROP_FAILED);
      setDropBusy(false);
    }
  }

  // #415: every question in the queue is a profile question (tailorProfile.ts) — permanent, told
  // before and after, with a skip that stores nothing.
  function renderQuestion(item: TailorQuestion) {
    const isAnswering = answering?.requirementId === item.requirementId;
    return (
      <>
        <p className="q" id="tailor-ask-q">
          {item.question}
        </p>
        {/* #308, the language ladder's own lines: why THIS advert asks, then the remember line,
            then the cost — all BEFORE the rungs (#125 decision 4), never after. Static ids are
            safe here: exactly one question renders at a time (questions[0]). */}
        {item.why && (
          <p className="notice" id="tailor-ask-why">
            {item.why}
          </p>
        )}
        {item.remember && (
          <p className="notice" id="tailor-ask-remember">
            {item.remember}
          </p>
        )}
        {item.consequence && (
          <p className="cost" id="tailor-ask-cost">
            {item.consequence}
          </p>
        )}
        <div
          className="opts"
          role="group"
          aria-labelledby="tailor-ask-q"
          // The retired deck ladder announced its reason and cost with the question (its e2e
          // pinned this); the queue keeps that — a screen-reader user jumping to the buttons
          // must still hear which tap has a cost.
          aria-describedby={
            [
              item.why && "tailor-ask-why",
              item.remember && "tailor-ask-remember",
              item.consequence && "tailor-ask-cost",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {item.options.map((opt, i) => {
            const cls = !isAnswering ? "opt" : opt === answering?.answer ? "opt picked" : "opt dim";
            return (
              <button
                key={opt}
                ref={i === 0 ? setFirstControl : undefined}
                type="button"
                className={cls}
                disabled={isAnswering}
                onClick={() => answerProfileQuestion(item.requirementId, opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {/* #308: the skip — posted like an answer, but the server stores nothing and the question
            returns on the next job that raises it. Visibly not one of the answers. */}
        {item.skip && (
          <button
            type="button"
            className="skip"
            disabled={isAnswering}
            onClick={() => answerProfileQuestion(item.requirementId, item.skip!)}
          >
            {item.skip}
          </button>
        )}
        {/* #398: an answer can take seconds to land — say so, or the person presses again. */}
        {isAnswering && (
          <p className="notice" role="status">
            Saving your answer…
          </p>
        )}
        {askError && (
          <p className="err" role="alert">
            {askError}
          </p>
        )}
      </>
    );
  }

  function renderExits(showSave: boolean) {
    if (dropConfirming) {
      return (
        <div className="exits confirming" role="group" aria-labelledby="tailor-dropnote">
          <p id="tailor-dropnote" className="notice">
            {T10}
          </p>
          <div className="pair">
            <button type="button" onClick={closeDropConfirm} disabled={dropBusy}>
              {T12}
            </button>
            <button type="button" ref={dropItRef} onClick={onDropIt} disabled={dropBusy}>
              {T11}
            </button>
          </div>
          {dropError && (
            <p className="err" role="alert">
              {dropError}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="exits">
        {showSave && (
          <button type="button" className="btn-ghost" onClick={() => setScreen("saved")}>
            {T16}
          </button>
        )}
        <span className="spacer" />
        <button type="button" ref={dropTriggerRef} onClick={openDropConfirm}>
          {T9}
        </button>
      </div>
    );
  }

  // #415: the after-line slot — the one line a permanent answer leaves behind, under the next
  // question or beside the draft. Keyed so a new line re-runs its rise.
  const afterLine = (
    <p
      key={ledgerView?.key ?? "empty"}
      className={["ledger", "quiet", ledgerView ? "show" : ""].filter(Boolean).join(" ")}
    >
      {ledgerView?.text ?? ""}
    </p>
  );

  function renderDraftScreen(state: TailorState) {
    // Met is met: a requirement met by a stretch counts, labelled as such in the sheet.
    const metCount = state.requirements.filter((r) => r.state === "met" || r.state === "stretched").length;
    const gaps = state.requirements.filter((r) => r.state === "gap");
    const meta = [state.card.company, state.card.place].filter(Boolean).join(" · ");
    return (
      <>
        <header className="dbar">
          <div className="title">
            <h1 tabIndex={-1} ref={headingRef}>
              {state.card.title}
            </h1>
            <p className="co">{[meta, T24].filter(Boolean).join(" · ")}</p>
          </div>
          <div ref={scoreRef} className="scoreslot">
            <ScoreRing pct={displayPct} bumped={scoreBumped} lit={scoreLit} estimated={state.card.scored === "estimated"} />
          </div>
          <button type="button" className="link" ref={sheetTriggerRef} onClick={() => setSheetOpen(true)}>
            {T26} · {metCount} of {state.requirements.length}
          </button>
        </header>
        <div className="dgrid">
          <div className="paper-col">
            {/* #411 (owner, 2026-10-23): the Match breakdown is the first block under the header —
                before the draft, following the live number like the ring above it. The deck card
                and the job's own screen keep it at the card's foot (CardBody). */}
            <MatchBreakdown card={state.card} pct={displayPct} />
            <TailorDraft
              key={lookAgain}
              open={openStretch}
              onStretch={onStretch}
              editing={stretchEdit !== null && !stretchEdit.saving && stretchEdit.id === openStretch}
              onEditText={(text) => (editTextRef.current = text)}
              onEditEnd={() => void endStretchEdit()}
              rev={frameRev}
            />
          </div>
          <aside className="rail">
            {/* #309 AC4: a job he brought that his own answers would have withdrawn (were it a
                found job) stays — and says why in one line. Server-composed, reload-stable. */}
            {state.stayed && <p className="notice stayed">{state.stayed}</p>}
            {ledgerView && afterLine}
            {/* #417 — the stretch suggestions, above the gap list: one card at a time (the open
                one), with the requirement, why, the line in, the line out and what to say; "No"
                here, Use / It's true / Edit wording in #418-#420. The rail is the column on a
                computer and the block under the draft on a phone, so one component serves both. */}
            <StretchCards
              view={stretch}
              requirements={state.requirements}
              openId={openStretch}
              onOpen={openSuggestion}
              onAnswer={(id, answer) => void (answer === "use" ? answerStretchUse(id) : answerStretchNo(id))}
              onUndo={(id) => void undoStretch(id)}
              onSkipRest={() => openSuggestion(null)}
              onLookAgain={() => setLookAgain((n) => n + 1)}
              headingRef={stretchHeadingRef}
              answering={stretchAnswering || stretchEdit !== null}
              edit={stretchEdit}
              editNote={editNote}
              onEdit={toggleStretchEdit}
              onEditText={(text) => (editTextRef.current = text)}
              editButtonRef={editButtonRef}
            />
            {askError && !state.questions.length && (
              <p className="err" role="alert">
                {askError}
              </p>
            )}
            {gaps.length > 0 && (
              <section className="gaps" aria-labelledby="tailor-gaps-h">
                <h2 id="tailor-gaps-h" className="h">
                  {T27}
                </h2>
                {/* ADR-0020 clause 6: a list with no button until the CV chat's door ships (#350). */}
                <ul className="gaplist">
                  {gaps.map((r) => (
                    <li key={r.id}>{r.text}</li>
                  ))}
                </ul>
                <p className="small">{T28}</p>
              </section>
            )}
            {renderExits(true)}
          </aside>
        </div>
        {sheetOpen && (
          <>
            <div className="scrim" onClick={closeSheet} />
            <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="tailor-fit-h">
              <header>
                <h2 id="tailor-fit-h">
                  {T26} · {metCount} of {state.requirements.length} met
                </h2>
                <button type="button" className="link" ref={sheetCloseRef} onClick={closeSheet}>
                  {T29}
                </button>
              </header>
              {/* The job's own order, never re-sorted — the list the server composed, verbatim. */}
              <ul className="marks">
                {state.requirements.map((r) => (
                  <li key={r.id} data-state={r.state}>
                    <span className="m" aria-hidden="true">
                      {MARK[r.state]}
                    </span>
                    <span className="t">{r.text}</span>
                    <span className="s">{STATE_LABEL[r.state]}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </>
    );
  }

  function renderQuestionScreen(state: TailorState) {
    return (
      <>
        <div className="live-wrap">
          <div className="live-card">
            <CardBody card={state.card} headingRef={headingRef} pct={displayPct} bumped={scoreBumped} />
          </div>
          <div className="t-cv-col">
            <div className="divider">{T6}</div>
            <p className="cv-wait">{T25}</p>
          </div>
        </div>

        <div className="ask">
          {state.stayed && <p className="notice stayed">{state.stayed}</p>}
          <p className="why">{T4}</p>
          {state.questions[0] && renderQuestion(state.questions[0])}
          {afterLine}
          {renderExits(false)}
        </div>
      </>
    );
  }

  return (
    <div className="jobdeck tailor" ref={rootRef}>
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {screen === "loading" && <div className="loadstate">{T1}</div>}

      {screen === "error" && (
        <div className="loadstate">
          <p role="alert">{T2}</p>
          <button type="button" onClick={load}>
            {T3}
          </button>
        </div>
      )}

      {screen === "saved" && tailor && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={savedHeadingRef}>
            {T19}
          </h1>
          <p>{savedLine(tailor.card.title, tailor.card.matchPct)}</p>
          <button type="button" onClick={() => router.push("/deck")}>
            {T21}
          </button>
        </div>
      )}

      {/* #307: a permanent answer took this job off the deck. #309 AC3: the withdrawal's named
          reason leads; the server's after-line below it keeps the honest count and the undo. */}
      {screen === "gone" && goneNote && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={goneHeadingRef}>
            {T22}
          </h1>
          {goneReason && <p className="gone-reason">{goneReason}</p>}
          <p>{goneNote}</p>
          <button type="button" onClick={() => router.push("/deck")}>
            {T21}
          </button>
        </div>
      )}

      {screen === "flow" && tailor && (
        <>
          <div className="topbar">
            <span className="wordmark">JobCrush</span>
            <span className="spacer" />
            <FactBadge count={badgeCount} fly={null} rootRef={rootRef} />
            {/* #303: the door's slot is the topbar's far right on every screen, badge or no badge. */}
            <PasteDoor />
          </div>
          {showDraft ? renderDraftScreen(tailor) : renderQuestionScreen(tailor)}
        </>
      )}
    </div>
  );
}
