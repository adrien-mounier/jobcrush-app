"use client";

// #16 discovery (screen 1a): Q1 (free-text role) -> the promise -> a tap-first floor loop, the
// answer -> reward core loop. Reuses the front door's typewriter/keepInView mechanics (page.tsx,
// first-question.prototype.html) against the pinned DiscoveryState contract.
//
// composeCvLine runs server-side now (ticket #16's reconciliation note, overriding design spec
// §4d/§7's client-local composition): every line typed here is the exact DiscoveryCvLine.text the
// API returned for that answer — never computed in this file. That puts a network round trip in
// front of the animation, so the per-answer sequencing (design §4d/§5) is staged across two
// moments instead of one: the next question + the new (empty) line's container land the instant
// the response arrives (no per-answer lockout); the rail fill/countdown/bullet/announcement wait
// for that line to finish typing, so "filling a bar and filling a section" still reads as one
// event even though the data was already known a beat earlier.
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import "../discovery.css";
import {
  answerDiscovery,
  ensureSession,
  getDiscovery,
  lookupFamily,
  startDiscovery,
  type CvSection,
  type DiscoveryCvLine,
  type DiscoveryPromise,
  type DiscoveryQuestion,
  type DiscoveryState,
} from "../../lib/api";

const CV_TYPE_SPEED = 26; // ms/char, design spec §2 (CV body — distinct from the door's 36ms headline)
const TYPE_SETTLE = 300; // ms — scroll first, then type (design §5)
const FAMILY_DEBOUNCE = 250; // ms, design spec §4a
const FAMILY_LOADING_DELAY = 400; // ms before the lookup shows its own loading affordance (§4b)
const NOTICE_MS = 3000; // how long the "saved to your profile" notice (C13) stays up

const SECTIONS: { key: CvSection; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "experience", label: "Experience" },
  { key: "skills", label: "Skills" },
  { key: "education", label: "Education" },
];

// Copy — verbatim from discovery-1a-design-spec.md §3.
const C2 = "What kind of job are you going for?";
const C3 =
  "I search the whole family, not just your words — say project manager and I'll also read IT project manager, programme manager, delivery manager.";
const C4 = "e.g. IT project manager in Paris, mostly ERP, I use Jira and MS Project";
const C5 = "That's me";
const C6 = "same kind of job";
const C7 = "Finding jobs like yours…";
const C10 = "Keep going and I'll score them against you.";
const C13 = "Saved to your profile — it'll be used when a job asks for it.";
const C14 = "Answer the question below and this page starts writing itself.";
// #18 discovery (screen 1b): in-flow correction + the deck-transition placeholder + the bare-"no"
// notice — verbatim from discovery-1b-design-spec.md's copy table.
const C15 = "Noted — one less thing to ask.";
const C16 = "Fix that?";
const C17 = "Change your answer.";
const C18 = "Leave it as is";
const C19 = "That's all I need to ask.";
const C20 = "Now I'll line these jobs up against everything you told me.";
const C21 = "Changing your answer.";

// The promise's number renders in its own emphasized `.n` slot (matching
// first-question.prototype.html, which the design spec builds against); this returns the rest of
// C8/C9 so the two pieces read as one sentence in DOM order (and to a screen reader).
function promiseTail(p: DiscoveryPromise): string {
  return p.city ? `${p.family} jobs are open in ${p.city} right now.` : `${p.family} jobs are open right now.`;
}
// C11's fallback (count failed, family known). The spec's copy row only spells out the with-city
// phrasing; mirroring C8/C9's own city-conditional split here so a visitor with no city never
// sees a broken "jobs open in  right now." — never showing broken text is the more binding rule
// (spec: "never fake" a count).
function promiseFamilyOnly(p: DiscoveryPromise): string {
  return p.city ? `There are ${p.family} jobs open in ${p.city} right now.` : `There are ${p.family} jobs open right now.`;
}
function countdownCopy(n: number): string {
  return n === 1 ? "1 answer until your next jobs" : `${n} answers until your next jobs`;
}
// Mirrors the server's isNoAnswer (design-1b-spec.md §3) so a bare "no" gets the noted-and-closed
// C15 branch instead of the generic "saved to your profile" C13 one.
function isNoAnswer(answer: string): boolean {
  return /^no[.!]?$/i.test(answer.trim());
}
function highlightMatch(title: string, query: string): ReactNode {
  const idx = query ? title.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) return title;
  return (
    <>
      {title.slice(0, idx)}
      <em>{title.slice(idx, idx + query.length)}</em>
      {title.slice(idx + query.length)}
    </>
  );
}

// Scrolls `.band-cv` just enough to keep `el` inside its padded viewport — ported from
// first-question.prototype.html's keepInView (design spec §5 cites it by name).
function keepInView(band: HTMLElement | null, el: HTMLElement | null, reduced: boolean) {
  if (!band || !el) return;
  const b = band.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const pad = 34;
  let d = 0;
  if (e.bottom > b.bottom - pad) d = e.bottom - (b.bottom - pad);
  else if (e.top < b.top + pad) d = e.top - (b.top + pad);
  if (d) band.scrollBy({ top: d, behavior: reduced ? "auto" : "smooth" });
}

// Writes `text` into `el` a character at a time, re-anchoring the scroll as the line wraps.
// Timers collect in `bag` so a finalize can cut it short. Scroll first, settle ~300ms, then type
// at 26ms/char (design §5); reduced motion sets the full text instantly and still scrolls.
function typeCvLine(
  band: HTMLElement | null,
  el: HTMLElement | null,
  text: string,
  bag: ReturnType<typeof setTimeout>[],
  reduced: boolean,
  done: () => void,
) {
  if (!el) {
    done();
    return;
  }
  keepInView(band, el, reduced);
  if (reduced) {
    el.textContent = text;
    done();
    return;
  }
  bag.push(
    setTimeout(() => {
      let i = 0;
      const tick = () => {
        i += 1;
        el.textContent = text.slice(0, i);
        keepInView(band, el, reduced);
        if (i < text.length) bag.push(setTimeout(tick, CV_TYPE_SPEED));
        else done();
      };
      tick();
    }, TYPE_SETTLE),
  );
}

type TypingInfo = {
  itemId: string;
  lineText: string;
  fullNextState: DiscoveryState;
  bag: ReturnType<typeof setTimeout>[];
  focusAfter?: string; // a correction's itemId — refocus its .cv-line button once typing completes
};

// The 4-bar section rail (design §4g) — pure/stateless, so it's the one piece worth its own
// component; everything else below shares too much live state/refs to be worth splitting.
function Rail({
  railFill,
  activeSection,
}: {
  railFill: Record<CvSection, number>;
  activeSection: CvSection | null;
}) {
  return (
    <div className="rail" aria-hidden="true">
      {SECTIONS.map((s) => {
        const fill = railFill[s.key] ?? 0;
        const done = fill >= 1;
        return (
          <div key={s.key} className={`blk${s.key === activeSection ? " active" : ""}${done ? " done" : ""}`}>
            <div className="bar">
              <i style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }} />
            </div>
            <div className="nm">
              {s.label}
              {done && <span className="tick"> ✓</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiscoveryScreen() {
  // AC6: a CV read via the front-door shortcut lands here as /discovery?job=<jobId> — the server
  // composes a reader-only first question from it when present; unchanged otherwise.
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const router = useRouter();

  const [discovery, setDiscovery] = useState<DiscoveryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [roleText, setRoleText] = useState("");
  const [q1Busy, setQ1Busy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [promiseLoading, setPromiseLoading] = useState(false);

  const [typingId, setTypingId] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ itemId: string; answer: string } | null>(null);
  const [freeAnswer, setFreeAnswer] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  // #18 in-flow correction (design-1b-spec §1) + the bare-"no" undo (§3).
  const [correcting, setCorrecting] = useState<{ itemId: string } | null>(null);
  const [lastNo, setLastNo] = useState<{ itemId: string } | null>(null);
  // #24: an itemId to focus once its `.cv-line` button lands in the DOM as the real, enabled
  // control — set by a correction's resolution (commit or cancel) instead of calling .focus()
  // immediately, which can race a still-typing (aria-hidden) or still-disabled (picked) button.
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  // #24: same deferral, for the bare-"no" cancel branch — "Fix that?" unmounts while `correcting`
  // is active (renderAsk shows the re-ask instead), so it isn't in the DOM yet when cancel fires.
  const [focusFixNotice, setFocusFixNotice] = useState(false);

  const bandRef = useRef<HTMLDivElement>(null);
  const typingSpanRef = useRef<HTMLSpanElement>(null);
  const typingRef = useRef<TypingInfo | null>(null);
  const familyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const familyLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const familyReqId = useRef(0);
  const firstControlRef = useRef<HTMLElement | null>(null);
  const setFirstControl = (el: HTMLElement | null) => {
    firstControlRef.current = el;
  };
  const handoffRef = useRef<HTMLParagraphElement>(null);
  // #25: latches the deck-handoff navigation so a re-run of the askKey effect (e.g. a router
  // identity change) can never fire router.push twice for the same handoff.
  const deckNavigatedRef = useRef(false);
  const fixNoticeButtonRef = useRef<HTMLButtonElement>(null);
  // #24: the previous askKey the focus effect below actually acted on — lets it tell "just left a
  // correction, back to the same next question" (skip the auto-focus, the resolution site already
  // placed focus) apart from "genuinely entered a new question" (focus its first control).
  const prevAskKeyRef = useRef<string | null>(null);
  // The only source of an answered item's question/options (once answered, it's gone from
  // `questions`) — a memory of what's been asked this load, not derived state (design-1b-spec §1:
  // "not recomputable from current props"). Populated fresh every render, below.
  const seenQuestionsRef = useRef<Map<string, { question: string; options: string[] }>>(new Map());
  if (discovery) {
    for (const q of discovery.questions) {
      seenQuestionsRef.current.set(q.itemId, { question: q.question, options: q.options });
    }
  }

  const loadDiscovery = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureSession();
      setDiscovery(await getDiscovery(jobId ?? undefined));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "couldn't load your progress");
    }
  }, [jobId]);

  useEffect(() => {
    loadDiscovery();
  }, [loadDiscovery]);

  // Unmount safety net: every timer this screen schedules (family debounce/loading, the notice
  // fade, the in-flight typewriter) is reachable from these refs (CODING_STANDARDS: effects clean
  // up timers in teardown).
  useEffect(() => {
    return () => {
      if (familyDebounceRef.current) clearTimeout(familyDebounceRef.current);
      if (familyLoadingTimerRef.current) clearTimeout(familyLoadingTimerRef.current);
      typingRef.current?.bag.forEach(clearTimeout);
    };
  }, []);

  // C13 is transient (design §4d).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // Focus follows the current ask target: the Q1 textarea on load, then each new question's
  // first control as it renders — no per-answer lockout (design §6 a11y). #18 folds in an
  // in-flow correction's re-ask (design-1b-spec §1 a11y: "moves focus to the re-ask's first
  // option on entry"); #25 folds in the deck handoff, which navigates instead of focusing here —
  // see the "deck" branch below.
  const askKey = !discovery
    ? null
    : discovery.stage === "deck"
      ? "deck"
      : correcting
        ? `fix:${correcting.itemId}`
        : discovery.role === null
          ? "q1"
          : (discovery.questions[0]?.itemId ?? null);
  useEffect(() => {
    if (!askKey) return;
    // #24: leaving a correction (askKey was `fix:X`, now isn't) re-lands on whatever question was
    // already live — never a new one — so the corrected line's own focus (set at the resolution
    // site, below) must stick instead of this effect re-grabbing the ask dock.
    const leavingCorrection = !!prevAskKeyRef.current?.startsWith("fix:") && !askKey.startsWith("fix:");
    prevAskKeyRef.current = askKey;
    if (askKey === "deck") {
      // #25: the gate hands off to the /deck reveal — the handoff copy stays up as a brief
      // sub-second bridge (design's pinned approach), then this navigates. No focus/announce here:
      // /deck's own entry effect focuses its heading and gives the one polite announce, so
      // announcing on this side too would double it (AC2).
      const t = setTimeout(() => {
        if (!deckNavigatedRef.current) {
          deckNavigatedRef.current = true;
          router.push("/deck");
        }
      }, 800);
      return () => clearTimeout(t);
    } else if (!leavingCorrection) {
      firstControlRef.current?.focus();
    }
  }, [askKey, router]);

  // #24: focuses a corrected `.cv-line` button once it has actually re-rendered as the real,
  // enabled control (not the aria-hidden typing placeholder, not disabled mid-request) — decoupled
  // from the askKey effect above so a correction's commit/cancel never races the "next question"
  // auto-focus.
  useEffect(() => {
    if (!focusLineId) return;
    focusCvLineButton(focusLineId);
    setFocusLineId(null);
  }, [focusLineId]);

  useEffect(() => {
    if (!focusFixNotice) return;
    fixNoticeButtonRef.current?.focus();
    setFocusFixNotice(false);
  }, [focusFixNotice]);

  // #18: cancelling a correction (Esc, "Leave it as is", or re-picking the same answer) is free —
  // no server call, the real line stays intact. Shared by the Esc listener below and the dock's own
  // cancel button.
  const cancelCorrection = useCallback(() => {
    if (!correcting) return;
    const { itemId } = correcting;
    setCorrecting(null);
    setAskError(null);
    if (lastNo?.itemId === itemId) setFocusFixNotice(true);
    else setFocusLineId(itemId);
  }, [correcting, lastNo]);

  useEffect(() => {
    if (!correcting) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelCorrection();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [correcting, cancelCorrection]);

  // Fires the scroll+type sequence once the new (empty) line's span has actually mounted (it and
  // `typingId` land in the same render, from applyAnswerResult below).
  useEffect(() => {
    if (!typingId) return;
    const t = typingRef.current;
    if (!t || t.itemId !== typingId) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    typeCvLine(bandRef.current, typingSpanRef.current, t.lineText, t.bag, reduced, () => {
      typingRef.current = null;
      setTypingId(null);
      setDiscovery(t.fullNextState);
      setLiveMessage(`${t.lineText} ${countdownCopy(t.fullNextState.essentialRemaining)}`);
      if (t.focusAfter) setFocusLineId(t.focusAfter);
    });
    return () => {
      t.bag.forEach(clearTimeout);
    };
  }, [typingId]);

  // Cuts short whatever line is mid-type, committing its already-known text + numbers instantly
  // (design §4d step 3 / §5 "never silently rewritten" — a cut-short line still lands with its
  // full, correct text, just without the letter-by-letter).
  function finalizeInFlight() {
    const t = typingRef.current;
    if (!t) return;
    t.bag.forEach(clearTimeout);
    typingRef.current = null;
    setTypingId(null);
    setDiscovery(t.fullNextState);
    setLiveMessage(`${t.lineText} ${countdownCopy(t.fullNextState.essentialRemaining)}`);
  }

  // Shared by Q1 submit, every floor answer, and a correction that turns a "no" into a positive
  // (design-1b-spec's boundary note: that's a brand-new line, so this diff-by-new-id already
  // finds it — unchanged). Structural bits (the next question, the new line's now-empty
  // container) apply immediately; the rail fill/countdown wait for that line to finish typing
  // (see the file banner comment for why). `isCorrection` (only true from commitCorrection's
  // no-to-positive branch) asks the typing-completion callback to return focus to this new line
  // (#24 AC1) instead of leaving it to the normal next-question auto-focus.
  function applyAnswerResult(
    next: DiscoveryState,
    answeredItemId?: string,
    rawAnswer?: string,
    isCorrection?: boolean,
  ) {
    finalizeInFlight();
    setFreeAnswer("");
    const prevIds = new Set((discovery?.cvLines ?? []).map((l) => l.itemId));
    const newLine = next.cvLines.find((l) => !prevIds.has(l.itemId)) ?? null;

    if (!newLine) {
      // No line to type, nothing to gate on — either a profile-only answer (design §4d/§8.1,
      // C13) or a bare "no" (design-1b-spec §3: noted-and-closed, never a failure — C15).
      setDiscovery(next);
      if (answeredItemId && rawAnswer && isNoAnswer(rawAnswer)) {
        setNotice(null);
        setLastNo({ itemId: answeredItemId });
        setLiveMessage(`${C15} ${countdownCopy(next.essentialRemaining)}`);
      } else {
        setNotice(C13);
        setLiveMessage(`${C13} ${countdownCopy(next.essentialRemaining)}`);
      }
      return;
    }

    setNotice(null);
    setDiscovery((s) => {
      const prev = s ?? next;
      return { ...next, railFill: prev.railFill, essentialRemaining: prev.essentialRemaining };
    });
    typingRef.current = {
      itemId: newLine.itemId,
      lineText: newLine.text,
      fullNextState: next,
      bag: [],
      focusAfter: isCorrection ? newLine.itemId : undefined,
    };
    setTypingId(newLine.itemId);
  }

  // The 1A/1B correction commit path for a same-id edit that applyAnswerResult's new-id diff can't
  // see (design-1b-spec §1A: "applyAnswerResult's new-line diff would miss it"). Re-types the line
  // in place when its text actually changed; a same-option re-pick (or a positive corrected away
  // to a "no", which isn't a flow this slice's spec designs a notice for) just syncs state quietly.
  function applyCorrectionResult(itemId: string, next: DiscoveryState) {
    finalizeInFlight();
    setFreeAnswer("");
    const updatedLine = next.cvLines.find((l) => l.itemId === itemId);
    const prevText = discovery?.cvLines.find((l) => l.itemId === itemId)?.text;

    if (updatedLine && updatedLine.text !== prevText) {
      setDiscovery((s) => {
        const prev = s ?? next;
        return { ...next, railFill: prev.railFill, essentialRemaining: prev.essentialRemaining };
      });
      typingRef.current = { itemId, lineText: updatedLine.text, fullNextState: next, bag: [], focusAfter: itemId };
      setTypingId(itemId);
    } else {
      setDiscovery(next);
      setFocusLineId(itemId);
    }
  }

  function focusCvLineButton(itemId: string) {
    bandRef.current?.querySelector<HTMLElement>(`[data-item="${itemId}"]`)?.focus();
  }

  // 1A entry (tap a written line) and 1B entry (tap "Fix that?" on a bare-no notice) both land
  // here — client-side-first, no server call, so the real line/notice stays intact until commit.
  function enterCorrection(itemId: string) {
    if (picked) return;
    setAskError(null);
    setFreeAnswer("");
    setCorrecting({ itemId });
    setLiveMessage(C21);
  }

  // The correction re-ask's commit (design-1b-spec §1): re-answering an item is idempotent
  // server-side now (upsert), so this reuses answerDiscovery — no separate correct/reopen route.
  async function commitCorrection(itemId: string, answer: string) {
    if (picked) return;
    setPicked({ itemId, answer });
    setAskError(null);
    try {
      const next = await answerDiscovery(itemId, answer);
      const hadLine = discovery?.cvLines.some((l) => l.itemId === itemId) ?? false;
      const hasLine = next.cvLines.some((l) => l.itemId === itemId);
      setCorrecting(null);
      if (lastNo?.itemId === itemId) setLastNo(null);
      if (!hadLine && hasLine) {
        // A no -> positive correction is a brand-new line — the normal floor-answer path, but
        // still a correction commit (#24 AC1: focus returns to it once typed).
        applyAnswerResult(next, itemId, answer, true);
      } else {
        applyCorrectionResult(itemId, next);
      }
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "could not save that — try again");
    } finally {
      setPicked(null);
    }
  }

  async function submitRole(raw: string) {
    const role = raw.trim();
    if (q1Busy || role.length < 2) return;
    setQ1Busy(true);
    setAskError(null);
    setPromiseLoading(true);
    try {
      applyAnswerResult(await startDiscovery(role));
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "could not save that — try again");
    } finally {
      setQ1Busy(false);
      setPromiseLoading(false);
    }
  }

  async function answerFloor(item: DiscoveryQuestion, answer: string) {
    if (picked) return;
    setPicked({ itemId: item.itemId, answer });
    setAskError(null);
    setNotice(null);
    setLastNo(null); // the undo reaches one question past a "no" (design-1b-spec §3), then clears
    try {
      applyAnswerResult(await answerDiscovery(item.itemId, answer), item.itemId, answer);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "could not save that — try again");
    } finally {
      setPicked(null);
    }
  }

  function onFamilyInput(v: string) {
    setRoleText(v);
    if (familyDebounceRef.current) clearTimeout(familyDebounceRef.current);
    if (familyLoadingTimerRef.current) clearTimeout(familyLoadingTimerRef.current);
    const q = v.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setFamilyLoading(false);
      return;
    }
    familyDebounceRef.current = setTimeout(() => runFamilyLookup(q), FAMILY_DEBOUNCE);
  }

  async function runFamilyLookup(q: string) {
    const myReq = ++familyReqId.current;
    familyLoadingTimerRef.current = setTimeout(() => {
      if (familyReqId.current === myReq) setFamilyLoading(true);
    }, FAMILY_LOADING_DELAY);
    try {
      const res = await lookupFamily(q);
      if (familyReqId.current !== myReq) return; // a newer keystroke's lookup already landed
      setSuggestions(res.suggestions);
    } catch {
      // A failed lookup is never worth an error banner over this box — design §4b already treats
      // "no match" as silence, not a failure state, so a network hiccup gets the same fallback.
      if (familyReqId.current !== myReq) return;
      setSuggestions([]);
    } finally {
      if (familyReqId.current === myReq) {
        if (familyLoadingTimerRef.current) clearTimeout(familyLoadingTimerRef.current);
        setFamilyLoading(false);
      }
    }
  }

  function renderPromise(d: DiscoveryState) {
    if (promiseLoading) {
      return (
        <div className="promise blind">
          <span className="n">···</span>
          <p>{C7}</p>
        </div>
      );
    }
    const p = d.promise;
    if (!p) return null; // family failed too — drop it silently (design §4c)
    if (p.count === null) {
      return (
        <div className="promise" role="status">
          <p>{promiseFamilyOnly(p)}</p>
        </div>
      );
    }
    return (
      <div className="promise" role="status">
        <span className="n">{p.count}</span>
        <p>
          {promiseTail(p)}
          <br />
          <span>{C10}</span>
        </p>
      </div>
    );
  }

  function renderCvLine(line: DiscoveryCvLine) {
    if (line.itemId === typingId) {
      return (
        <p key={line.itemId} className="cv-line" aria-hidden="true">
          <span ref={typingSpanRef} />
          <span className="caret" />
        </p>
      );
    }
    // Correctable iff asked this load (design-1b-spec §1): seenQuestions is the only source of an
    // answered item's question/options, and a resumed-from-reload line was never seen this load.
    if (!seenQuestionsRef.current.has(line.itemId)) {
      return (
        <p key={line.itemId} className="cv-line done">
          {line.text}
        </p>
      );
    }
    return (
      <button
        key={line.itemId}
        type="button"
        className={`cv-line done${correcting?.itemId === line.itemId ? " fixing" : ""}`}
        data-item={line.itemId}
        disabled={!!picked}
        aria-label={`Fix this line: ${line.text}`}
        onClick={() => enterCorrection(line.itemId)}
      >
        {line.text}
      </button>
    );
  }

  function renderRoleLine(d: DiscoveryState) {
    const role = d.cvLines.find((l) => l.itemId === "role");
    if (!role) return <p className="cv-role" />;
    if (role.itemId === typingId) {
      return (
        <p className="cv-role" aria-hidden="true">
          <span ref={typingSpanRef} />
          <span className="caret" />
        </p>
      );
    }
    return <p className="cv-role">{role.text}</p>;
  }

  // Ask-dock notice slot (design-1b-spec §3): the bare-"no" undo takes precedence over the
  // generic profile-saved notice — the two never truly coexist (answerFloor clears lastNo the
  // instant a new answer starts, before that answer's own outcome is known).
  function renderNotice() {
    if (lastNo) {
      return (
        <p className="notice">
          {C15}{" "}
          <button
            type="button"
            disabled={!!picked}
            onClick={() => enterCorrection(lastNo.itemId)}
            ref={fixNoticeButtonRef}
          >
            {C16}
          </button>
        </p>
      );
    }
    if (notice) return <p className="notice">{notice}</p>;
    return null;
  }

  // The correction re-ask (design-1b-spec §1): reuses .q/.sub/.opts/.opt or the free-text .field,
  // exactly like the normal ask below — just re-asking a seen question instead of the next one.
  function renderCorrectionAsk() {
    if (!correcting) return null;
    const seen = seenQuestionsRef.current.get(correcting.itemId);
    if (!seen) return null; // shouldn't happen — the button/notice only target a seen item
    const isAnswering = picked?.itemId === correcting.itemId;
    const isNoCorrection = lastNo?.itemId === correcting.itemId;

    if (seen.options.length === 0) {
      return (
        <>
          <label htmlFor="fix-free" className="q">
            {seen.question}
          </label>
          <p className="sub">{C17}</p>
          <div className="field">
            <input
              id="fix-free"
              ref={setFirstControl}
              type="text"
              value={freeAnswer}
              disabled={isAnswering}
              onChange={(e) => setFreeAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const a = freeAnswer.trim();
                  if (a) commitCorrection(correcting.itemId, a);
                }
              }}
            />
            <button
              type="button"
              className="go"
              disabled={isAnswering || freeAnswer.trim().length < 1}
              onClick={() => {
                const a = freeAnswer.trim();
                if (a) commitCorrection(correcting.itemId, a);
              }}
            >
              Continue
            </button>
          </div>
          <p className="notice">
            <button type="button" disabled={isAnswering} onClick={cancelCorrection}>
              {C18}
            </button>
          </p>
          {askError && (
            <p className="err" role="alert">
              {askError}
            </p>
          )}
        </>
      );
    }

    return (
      <>
        <p className="q" id="fix-q">
          {seen.question}
        </p>
        <p className="sub">{C17}</p>
        <div className="opts" role="group" aria-labelledby="fix-q">
          {seen.options.map((opt, i) => (
            <button
              key={opt}
              ref={i === 0 ? setFirstControl : undefined}
              type="button"
              className={isNoCorrection && isNoAnswer(opt) ? "opt picked" : "opt"}
              disabled={isAnswering}
              onClick={() => commitCorrection(correcting.itemId, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
        <p className="notice">
          <button type="button" disabled={isAnswering} onClick={cancelCorrection}>
            {C18}
          </button>
        </p>
        {askError && (
          <p className="err" role="alert">
            {askError}
          </p>
        )}
      </>
    );
  }

  function renderAsk(d: DiscoveryState) {
    // Precedence (design-1b-spec §1): deck > correcting > the normal next-question below.
    if (d.stage === "deck") {
      return (
        <div className="handoff">
          <p className="q" tabIndex={-1} ref={handoffRef}>
            {C19}
          </p>
          <p className="sub">{C20}</p>
        </div>
      );
    }
    if (correcting) return renderCorrectionAsk();

    if (d.role === null) {
      const query = roleText.trim();
      return (
        <>
          <label htmlFor="q1-role" className="q">
            {C2}
          </label>
          <p className="sub">{C3}</p>
          {(suggestions.length > 0 || familyLoading) && query.length >= 2 && (
            <div className="sugg live">
              <div className="fam">{C6}</div>
              {suggestions.slice(0, 5).map((title) => (
                <button key={title} type="button" disabled={q1Busy} onClick={() => submitRole(title)}>
                  {highlightMatch(title, query)}
                </button>
              ))}
              {familyLoading && <div className="loading">…</div>}
            </div>
          )}
          <div className="field">
            <textarea
              id="q1-role"
              ref={setFirstControl}
              rows={2}
              placeholder={C4}
              value={roleText}
              disabled={q1Busy}
              onChange={(e) => onFamilyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submitRole(roleText);
                }
              }}
            />
          </div>
          <button
            type="button"
            className="go wide"
            disabled={q1Busy || query.length < 2}
            onClick={() => submitRole(roleText)}
          >
            {C5}
          </button>
          {askError && (
            <p className="err" role="alert">
              {askError}
            </p>
          )}
        </>
      );
    }

    const item = d.questions[0];
    if (!item) return null; // defensive fallback — the deck gate above means this shouldn't be reached
    const isAnswering = picked?.itemId === item.itemId;

    if (item.options.length === 0) {
      // A free-text floor item (e.g. headline-focus) — the design spec doesn't pin exact copy for
      // this path (§4e only specifies the mechanic), so "Continue" is a judgment call.
      return (
        <>
          <label htmlFor="floor-free" className="q">
            {item.question}
          </label>
          <div className="field">
            <input
              id="floor-free"
              ref={setFirstControl}
              type="text"
              value={freeAnswer}
              disabled={isAnswering}
              onChange={(e) => setFreeAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const a = freeAnswer.trim();
                  if (a) answerFloor(item, a);
                }
              }}
            />
            <button
              type="button"
              className="go"
              disabled={isAnswering || freeAnswer.trim().length < 1}
              onClick={() => {
                const a = freeAnswer.trim();
                if (a) answerFloor(item, a);
              }}
            >
              Continue
            </button>
          </div>
          {renderNotice()}
          {askError && (
            <p className="err" role="alert">
              {askError}
            </p>
          )}
        </>
      );
    }

    return (
      <>
        <p className="q" id="ask-q">
          {item.question}
        </p>
        <div className="opts" role="group" aria-labelledby="ask-q">
          {item.options.map((opt, i) => {
            const cls = !isAnswering ? "opt" : opt === picked?.answer ? "opt picked" : "opt dim";
            return (
              <button
                key={opt}
                ref={i === 0 ? setFirstControl : undefined}
                type="button"
                className={cls}
                disabled={isAnswering}
                onClick={() => answerFloor(item, opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {renderNotice()}
        {askError && (
          <p className="err" role="alert">
            {askError}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="discovery">
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {!discovery && !loadError && <div className="loadstate">Loading your questions…</div>}
      {loadError && (
        <div className="loadstate">
          <p role="alert">{loadError}</p>
          <button type="button" onClick={loadDiscovery}>
            Try again
          </button>
        </div>
      )}

      {discovery && (
        <>
          <div className="topbar">
            <span className="wordmark">JobCrush</span>
          </div>

          {discovery.role !== null && discovery.essentialRemaining > 0 && (
            <p className="countdown">{countdownCopy(discovery.essentialRemaining)}</p>
          )}

          <Rail
            railFill={discovery.railFill}
            activeSection={discovery.stage === "deck" ? null : (discovery.questions[0]?.cvSection ?? null)}
          />

          {renderPromise(discovery)}

          <div className="divider">your CV</div>
          <div className="band-cv" ref={bandRef}>
            <div className="cv">
              {renderRoleLine(discovery)}
              {SECTIONS.map((s) => {
                const lines = discovery.cvLines.filter((l) => l.itemId !== "role" && l.section === s.key);
                return (
                  <section key={s.key} aria-labelledby={`cvsec-${s.key}`}>
                    <h2 id={`cvsec-${s.key}`} className="cv-sec">
                      {s.label}
                    </h2>
                    {lines.length === 0 ? <div className="cv-gap" /> : lines.map(renderCvLine)}
                  </section>
                );
              })}
              {discovery.cvLines.length === 0 && <p className="hint">{C14}</p>}
            </div>
          </div>

          <div className="ask">{renderAsk(discovery)}</div>
        </>
      )}
    </div>
  );
}

// AC6 (#18): reading `?job` needs useSearchParams, which requires a Suspense boundary above it or
// Next.js bails the whole route to client-only rendering with a build warning. The fallback mirrors
// DiscoveryScreen's own loading state so there's no visible flash between the two.
export default function DiscoveryPage() {
  return (
    <Suspense
      fallback={
        <div className="discovery">
          <div className="loadstate">Loading your questions…</div>
        </div>
      }
    >
      <DiscoveryScreen />
    </Suspense>
  );
}
