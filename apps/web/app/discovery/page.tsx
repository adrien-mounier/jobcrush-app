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
import { FactBadge, type FactChipFlight } from "../factbadge";
import {
  answerDiscovery,
  answerDiscoveryMulti,
  ensureSession,
  getDiscovery,
  lookupFamily,
  startDiscovery,
  type CvSection,
  type DiscoveryCvLine,
  type DiscoveryPromise,
  type DiscoveryQuestion,
  type DiscoveryState,
  type EligibilityAsk,
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
const C4 = "e.g. IT project manager, mostly ERP, I use Jira and MS Project";
const C5 = "That's me";
const C6 = "same kind of job";
const C7 = "Finding jobs like yours…";
const C10 = "Keep going and I'll score them against you.";
const C13 = "Saved to your profile — kept for when a job needs it.";
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
const C22 = "I scored the three closest — tell me more and I'll widen the net";
// #106: eligibility questions at the tail of the floor loop (design spec §2 "Shared") — the
// confirmation pair and the fix-button label for a declined answer. C16 ("Fix that?") is reused for
// a real answer's fix button, unchanged.
const C23 = "Locked in — I'll use that on every job, so I won't ask again.";
const C24 = "No problem — I'll ask again when a job needs it.";
const C26 = "Answer it now";

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
// #106: the countdown must read as one continuous meter across the floor questions and the
// eligibility block that follows (design spec §6). The server includes eligibility questions in
// `questions` from the start, ordered last (the ask dock only ever renders `questions[0]`, so they
// still surface after the floor) — essentialRemaining counts floor items only, so it and eligLeft
// each count down independently and monotonically. Summing them is what keeps the meter from
// climbing back up the moment the floor finishes (a fallback/max of the two would do exactly that,
// since eligLeft is already the true remaining count from the first render, not something that
// only appears once essentialRemaining hits 0).
function eligLeft(s: DiscoveryState): number {
  return s.questions.filter((q) => q.eligibility).length;
}
function remaining(s: DiscoveryState): number {
  return s.essentialRemaining + eligLeft(s);
}
function countdownCopy(n: number): string {
  return n === 1 ? "1 answer until your next jobs" : `${n} answers until your next jobs`;
}
// Mirrors the server's isNoAnswer (design-1b-spec.md §3) so a bare "no" gets the noted-and-closed
// C15 branch instead of the generic "saved to your profile" C13 one.
function isNoAnswer(answer: string): boolean {
  return /^no[.!]?$/i.test(answer.trim());
}
// #123: joins a ticked-language list in `options` order for L3/L4 (design spec §6's join rule) —
// sentence case, no quotes, no bold, and never an Oxford comma before "and".
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
// #123: L3/L4 — the multi-select confirm's own "locked in" line, replacing C23 for this question only.
//
// #165 rewrote both branches. They used to announce a removal ("jobs that demand anything else are
// out of your deck"), which was true then and is a lie now: listing languages no longer withdraws
// anything, because only a deliberate "I don't speak this one" on the ladder can. Saying it anyway
// would teach the person to fear a question that is now free, which is the exact anxiety this
// ticket removed. The second branch names what actually happens next instead.
function multiSelectLockedIn(ticked: string[]): string {
  return ticked.length === 0
    ? "Locked in — no languages listed. Nothing was removed from your deck."
    : `Locked in — ${joinList(ticked)}. When a job needs one, I'll ask how well you speak it.`;
}
// #106: the eligibility `.sub` clarifier — the wire contract carries `.q`/`options` fully worded
// server-side but no clarifier field (EligibilityAsk in lib/api.ts), so this is the one piece of
// eligibility copy the client still composes.
// #123 code review: language used to be the plain fallback here, but the server's languages
// question now always carries `multiSelect: true` (apps/api/src/eligibilityDiscovery.ts's
// buildQuestion) and renderAsk branches to renderMultiSelect — which renders `consequence`, not
// `.sub` — before this function is ever called for it. #162 removed the years-experience question
// entirely (worked out, never asked), so work-rights is the ONE dimension this function renders
// today; the fallback below is unreachable and intentionally holds no dimension-specific copy —
// it exists only so the function type-checks against EligibilityAsk's full dimension union.
function eligibilitySub(elig: EligibilityAsk): string {
  if (elig.dimension === "work-rights") return "Either answer is useful — it just changes which jobs I show you.";
  return ""; // unreachable — see comment above
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

// The progress rail: one overall bar that fills as you answer anything (so the active section
// never reads as "empty/broken" just because its own questions haven't been answered yet), plus
// the four section labels underneath — the active one in gold, completed ones with a tick.
function Rail({
  railFill,
  activeSection,
}: {
  railFill: Record<CvSection, number>;
  activeSection: CvSection | null;
}) {
  const overall = Math.round(
    (SECTIONS.reduce((sum, s) => sum + (railFill[s.key] ?? 0), 0) / SECTIONS.length) * 100,
  );
  return (
    <div className="rail" aria-hidden="true">
      <div className="rail-track">
        {/* Progress fill: a scaleX() fraction, not a width percentage — discovery.css transitions
            `transform` with transform-origin: left, at the same 620ms curve. */}
        <i style={{ transform: `scaleX(${overall / 100})` }} />
      </div>
      <div className="rail-steps">
        {SECTIONS.map((s) => {
          const done = (railFill[s.key] ?? 0) >= 1;
          return (
            <span
              key={s.key}
              className={`step${s.key === activeSection ? " active" : ""}${done ? " done" : ""}`}
            >
              {s.label}
              {done && " ✓"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DiscoveryScreen() {
  // AC6: a CV read via the front-door shortcut lands here as /discovery?job=<jobId> — the server
  // composes a reader-only first question from it when present; unchanged otherwise.
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const loopbackFromDeck = searchParams.get("loop") === "deck-exhausted";
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
  // #18 in-flow correction (design-1b-spec §1) + the bare-"no" undo (§3), generalised by #106 to
  // also cover an eligibility answer — both are "no CV line" outcomes that still need a persistent
  // notice and a way back in (design spec §5.3/§5.4).
  const [correcting, setCorrecting] = useState<{ itemId: string } | null>(null);
  // #106 code review: "eligibility or bare-no" is not stored as its own field — eligibilityFor(itemId)
  // (via seenQuestionsRef) is already the one source of truth for that, so a second `kind` tag here
  // would just be a cache of the same fact that could drift from it.
  // #123: `answers` is only ever populated for a multi-select confirm (never a decline, never a
  // single-select answer) — renderNotice reads it to build L3/L4's `{list}`, and a correction
  // re-entry reads it to pre-tick the previously confirmed languages (design spec §7 point 2).
  const [noticeSlot, setNoticeSlot] = useState<{ itemId: string; answer: string; answers?: string[] } | null>(
    null,
  );
  // #24: an itemId to focus once its `.cv-line` button lands in the DOM as the real, enabled
  // control — set by a correction's resolution (commit or cancel) instead of calling .focus()
  // immediately, which can race a still-typing (aria-hidden) or still-disabled (picked) button.
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  // #24: same deferral, for the bare-"no" cancel branch — "Fix that?" unmounts while `correcting`
  // is active (renderAsk shows the re-ask instead), so it isn't in the DOM yet when cancel fires.
  const [focusFixNotice, setFocusFixNotice] = useState(false);
  // #17 the profile badge: the parent owns the data (the loaded/answered count, monotonically
  // clamped) and the click origin; FactBadge owns all the motion.
  const [badgeCount, setBadgeCount] = useState(0);
  const [fly, setFly] = useState<FactChipFlight | null>(null);
  // The answered control's rect, captured on the root's capture-phase click/keydown — every answer
  // handler is triggered BY one of those two, so this is always fresh by the time an answer lands.
  // Avoids threading a DOMRect through five functions and eleven call sites for a value already
  // available the same way this screen already stashes other transient per-answer state (typingRef,
  // seenQuestionsRef): a ref, not a parameter.
  const flyFromRef = useRef<DOMRect | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
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
  const seenQuestionsRef = useRef<
    Map<
      string,
      {
        question: string;
        options: string[];
        eligibility?: EligibilityAsk;
        multiSelect?: true;
        typeAhead?: true;
        consequence?: string;
      }
    >
  >(new Map());
  if (discovery) {
    for (const q of discovery.questions) {
      seenQuestionsRef.current.set(q.itemId, {
        question: q.question,
        options: q.options,
        eligibility: q.eligibility,
        multiSelect: q.multiSelect,
        typeAhead: q.typeAhead,
        consequence: q.consequence,
      });
    }
  }
  // #123: the ticked-language set for the one multi-select question — lives outside noticeSlot so
  // a failed save keeps every tick exactly as the visitor left it (design spec §10 "in flight").
  const [langSelected, setLangSelected] = useState<Set<string>>(new Set());
  const [langQuery, setLangQuery] = useState(""); // #165: the languages type-ahead's own input

  const loadDiscovery = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureSession();
      const s = await getDiscovery(jobId ?? undefined);
      setDiscovery(s);
      setBadgeCount((c) => Math.max(c, s.factCount)); // the monotone clamp, at every write
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
    : discovery.stage === "deck" && !loopbackFromDeck
      ? "deck"
      : correcting
        ? `fix:${correcting.itemId}`
        : discovery.role === null
          ? "q1"
          : (discovery.questions[0]?.itemId ?? (loopbackFromDeck ? "loopback" : null));
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
    if (noticeSlot?.itemId === itemId) setFocusFixNotice(true);
    else setFocusLineId(itemId);
  }, [correcting, noticeSlot]);

  useEffect(() => {
    if (!correcting) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelCorrection();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [correcting, cancelCorrection]);

  // #123: entering the language question's correction pre-ticks whatever was last confirmed
  // (design spec §7 point 2) — a prior decline pre-ticks nothing, since noticeSlot.answers is only
  // ever set by a multi-select confirm. Never pre-tick anything on the very first ask.
  useEffect(() => {
    if (!correcting) return;
    const seen = seenQuestionsRef.current.get(correcting.itemId);
    if (!seen?.multiSelect) return;
    const prior = noticeSlot?.itemId === correcting.itemId ? noticeSlot.answers : undefined;
    setLangSelected(new Set(prior ?? []));
  }, [correcting, noticeSlot]);

  function toggleLang(name: string) {
    setLangSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // #165: the languages question is a type-ahead now, so a word the person types is KEPT even when
  // the suggestion list has never heard of it (a French speaker in Asia has somewhere to say so).
  // Adding is case-insensitively idempotent but stores THEIR spelling — the server keys the fact on
  // the words they used, so "french" must not silently become a second entry beside "French".
  function addLang(raw: string) {
    const word = raw.trim();
    if (!word) return;
    setLangSelected((s) => {
      if ([...s].some((n) => n.toLowerCase() === word.toLowerCase())) return s;
      return new Set([...s, word]);
    });
    setLangQuery("");
  }

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
      setLiveMessage(`${t.lineText} ${countdownCopy(remaining(t.fullNextState))}`);
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
    setLiveMessage(`${t.lineText} ${countdownCopy(remaining(t.fullNextState))}`);
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
    rawAnswer: string,
    answeredItemId?: string,
    isCorrection?: boolean,
    // #123: only ever populated for a multi-select confirm — carried into noticeSlot so a
    // correction re-entry can pre-tick it, and read here to render L3/L4 instead of C23.
    answersList?: string[],
  ) {
    finalizeInFlight();
    setFreeAnswer("");
    // #17: unconditional — factCount grows on a bare "no" too (no new CV line, but the pile still
    // grows), and FactBadge's own guard (fly only if it actually exceeds what's shown) makes a
    // correction's zero-delta a silent no-op, so this needs no branching here. `flyFromRef` was set
    // by the root's capture-phase click/keydown that triggered this very call.
    setBadgeCount((c) => Math.max(c, next.factCount));
    if (flyFromRef.current) setFly({ rect: flyFromRef.current, label: rawAnswer });
    const prevIds = new Set((discovery?.cvLines ?? []).map((l) => l.itemId));
    const newLine = next.cvLines.find((l) => !prevIds.has(l.itemId)) ?? null;

    if (!newLine) {
      // No line to type, nothing to gate on — either a profile-only answer (design §4d/§8.1,
      // C13), a bare "no" (design-1b-spec §3: noted-and-closed, never a failure — C15), or #106's
      // eligibility answer (checked first: it never produces a line either, and must never fall
      // into the bare-"no" branch just because a future decline label happened to read like one).
      setDiscovery(next);
      const seen = answeredItemId ? seenQuestionsRef.current.get(answeredItemId) : undefined;
      const elig = seen?.eligibility;
      if (answeredItemId && elig) {
        const declined = rawAnswer === elig.declineOption;
        const line = seen?.multiSelect && !declined ? multiSelectLockedIn(answersList ?? []) : declined ? C24 : C23;
        setNotice(null);
        setNoticeSlot({ itemId: answeredItemId, answer: rawAnswer, ...(answersList ? { answers: answersList } : {}) });
        setLiveMessage(`${line} ${countdownCopy(remaining(next))}`);
      } else if (answeredItemId && rawAnswer && isNoAnswer(rawAnswer)) {
        setNotice(null);
        setNoticeSlot({ itemId: answeredItemId, answer: rawAnswer });
        setLiveMessage(`${C15} ${countdownCopy(remaining(next))}`);
      } else {
        setNotice(C13);
        setLiveMessage(`${C13} ${countdownCopy(remaining(next))}`);
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
  function applyCorrectionResult(
    itemId: string,
    next: DiscoveryState,
    rawAnswer: string,
    // #123: same purpose as applyAnswerResult's — only populated for a multi-select re-confirm.
    answersList?: string[],
  ) {
    finalizeInFlight();
    setFreeAnswer("");
    // #17: same unconditional attempt as applyAnswerResult — a correction is normally a zero-delta
    // no-op (FactBadge's own guard), built as specified rather than special-cased away.
    setBadgeCount((c) => Math.max(c, next.factCount));
    if (flyFromRef.current) setFly({ rect: flyFromRef.current, label: rawAnswer });
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
      // #106: an eligibility correction never gets a line to focus — re-set the notice slot with
      // the new answer and return focus to its fix button (design spec §5.4 point 3), the same
      // mechanism the bare-"no" notice already uses.
      const elig = eligibilityFor(itemId);
      if (elig) {
        const declined = rawAnswer === elig.declineOption;
        const multi = seenQuestionsRef.current.get(itemId)?.multiSelect;
        const line = multi && !declined ? multiSelectLockedIn(answersList ?? []) : declined ? C24 : C23;
        setNoticeSlot({ itemId, answer: rawAnswer, ...(answersList ? { answers: answersList } : {}) });
        setLiveMessage(`${line} ${countdownCopy(remaining(next))}`);
        setFocusFixNotice(true);
      } else {
        setFocusLineId(itemId);
      }
    }
  }

  function focusCvLineButton(itemId: string) {
    bandRef.current?.querySelector<HTMLElement>(`[data-item="${itemId}"]`)?.focus();
  }

  // #106: the only source of an answered eligibility item's dimension/declineOption once it has
  // left `questions` — mirrors focusCvLineButton's itemId-keyed lookup just above.
  function eligibilityFor(itemId: string): EligibilityAsk | undefined {
    return seenQuestionsRef.current.get(itemId)?.eligibility;
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
      // #106: an eligibility slot is replaced, not dropped, by applyCorrectionResult below — only
      // clear it here for a bare-"no" item (design spec §5.4 point 4).
      if (noticeSlot && noticeSlot.itemId === itemId && !eligibilityFor(itemId)) setNoticeSlot(null);
      if (!hadLine && hasLine) {
        // A no -> positive correction is a brand-new line — the normal floor-answer path, but
        // still a correction commit (#24 AC1: focus returns to it once typed).
        applyAnswerResult(next, answer, itemId, true);
      } else {
        applyCorrectionResult(itemId, next, answer);
      }
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "could not save that — try again");
    } finally {
      setPicked(null);
    }
  }

  // #123: the correction re-ask's commit for the multi-select question — mirrors commitCorrection,
  // but this item never produces a CV line (it's an eligibility answer), so it always lands in
  // applyCorrectionResult, never the no-to-positive branch commitCorrection has to distinguish.
  async function commitMultiCorrection(itemId: string, answers: string[]) {
    if (picked) return;
    const label = answers.length > 0 ? joinList(answers) : "I can't work in any of these";
    setPicked({ itemId, answer: label });
    setAskError(null);
    try {
      const next = await answerDiscoveryMulti(itemId, answers);
      setCorrecting(null);
      applyCorrectionResult(itemId, next, label, answers);
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
      applyAnswerResult(await startDiscovery(role), role);
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
    setNoticeSlot(null); // the undo reaches one question past a "no"/decline (design-1b-spec §3, #106), then clears
    try {
      applyAnswerResult(await answerDiscovery(item.itemId, answer), answer, item.itemId);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "could not save that — try again");
    } finally {
      setPicked(null);
    }
  }

  // #123: the language question's multi-select confirm — `answers` can legally be `[]` (the
  // "I can't work in any of these" tap). The fly/notice label is the ticked list itself so it can
  // never collide with the decline string, which travels its own path (answerFloor, unchanged).
  async function answerMultiSelect(item: DiscoveryQuestion, answers: string[]) {
    if (picked) return;
    const label = answers.length > 0 ? joinList(answers) : "I can't work in any of these";
    setPicked({ itemId: item.itemId, answer: label });
    setAskError(null);
    setNotice(null);
    setNoticeSlot(null);
    try {
      applyAnswerResult(await answerDiscoveryMulti(item.itemId, answers), label, item.itemId, false, answers);
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

  // Ask-dock notice slot (design-1b-spec §3, generalised by #106): the bare-"no"/eligibility undo
  // takes precedence over the generic profile-saved notice — the two never truly coexist
  // (answerFloor clears noticeSlot the instant a new answer starts, before that answer's own
  // outcome is known).
  function renderNotice() {
    if (noticeSlot) {
      // #106: the same slot now backs both the bare-"no" notice (C15/C16, unchanged) and an
      // eligibility answer's pair — C23/C16 for a real answer, C24/C26 for a decline (design
      // spec §4/§5.3).
      const elig = eligibilityFor(noticeSlot.itemId);
      const multi = seenQuestionsRef.current.get(noticeSlot.itemId)?.multiSelect;
      const declined = !!elig && noticeSlot.answer === elig.declineOption;
      // #123: L3/L4 replace C23 for the multi-select question only (design spec §6) — C23 never
      // states a removal, and this is the one answer that removes jobs.
      const line = !elig ? C15 : declined ? C24 : multi ? multiSelectLockedIn(noticeSlot.answers ?? []) : C23;
      const fixLabel = !elig ? C16 : declined ? C26 : C16;
      return (
        <p className="notice">
          {line}{" "}
          <button
            type="button"
            disabled={!!picked}
            onClick={() => enterCorrection(noticeSlot.itemId)}
            ref={fixNoticeButtonRef}
          >
            {fixLabel}
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
    // #106: generalised from the old isNoCorrection/isNoAnswer regex match to a direct comparison
    // against the slot's stored answer (design spec §5.4 point 2) — works for any eligibility
    // answer, not just a "no"-shaped one, and pre-marks it as `.opt.picked` on entry.
    const slotAnswer = noticeSlot && noticeSlot.itemId === correcting.itemId ? noticeSlot.answer : null;

    // #123: the language question's correction re-ask — same fieldset, pre-ticked by the effect
    // above (design spec §7). Checked before the free-text/options branches below since it has its
    // own shape entirely.
    if (seen.multiSelect && seen.eligibility) {
      const elig = seen.eligibility;
      return renderMultiSelect(
        {
          itemId: correcting.itemId,
          question: seen.question,
          options: seen.options,
          eligibility: seen.eligibility,
          consequence: seen.consequence,
        },
        {
          isAnswering,
          isCorrection: true,
          onConfirm: (answers) => commitMultiCorrection(correcting.itemId, answers),
          onDecline: () => commitCorrection(correcting.itemId, elig.declineOption),
        },
      );
    }

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
          {seen.options.map((opt, i) => {
            const quiet = seen.eligibility && opt === seen.eligibility.declineOption ? " quiet" : "";
            const cls = opt === slotAnswer ? `opt${quiet} picked` : `opt${quiet}`;
            return (
              <button
                key={opt}
                ref={i === 0 ? setFirstControl : undefined}
                type="button"
                className={cls}
                disabled={isAnswering}
                onClick={() => commitCorrection(correcting.itemId, opt)}
              >
                {opt}
              </button>
            );
          })}
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

  // #51: a permanent free-text box alongside the option buttons — the visitor can always answer in
  // their own words, not just pick. Submits via the same answerFloor path the options use (the
  // server already accepts any string for an item); applyAnswerResult clears freeAnswer on every
  // answer, so the box never carries stale text into the next question. Ctrl/Cmd+Enter submits, to
  // match Q1's own textarea convention and let a multi-line answer breathe.
  function renderFreeText(item: DiscoveryQuestion, isAnswering: boolean) {
    return (
      <div className="freetext">
        <p className="ft-label">Or type your own answer — we'll read it</p>
        <div className="field">
          <textarea
            placeholder="Anything else worth knowing?"
            value={freeAnswer}
            disabled={isAnswering}
            onChange={(e) => setFreeAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
            Send
          </button>
        </div>
      </div>
    );
  }

  // #123: the language question's checkbox-group UI (design spec §1/§3/§4/§5) — shared by the
  // normal ask and its correction re-ask via the onConfirm/onDecline callbacks, so this never needs
  // to know which one it's in beyond the copy/notice differences `isCorrection` controls.
  function renderMultiSelect(
    q: {
      itemId: string;
      question: string;
      options: string[];
      eligibility?: EligibilityAsk;
      consequence?: string;
      typeAhead?: true;
    },
    opts: {
      isAnswering: boolean;
      isCorrection: boolean;
      onConfirm: (answers: string[]) => void;
      onDecline: () => void;
    },
  ) {
    // options: N language names, then the decline string last (contract-pinned order). #165: those N
    // are COMPLETIONS now, not the legal answers — `orderedTicked` reads the person's own set (which
    // may hold a word no completion offered), never a filter over the list.
    const languages = q.options.slice(0, -1);
    const decline = q.options[q.options.length - 1] ?? "";
    const anyTicked = langSelected.size > 0;
    const orderedTicked = [...langSelected];
    const query = langQuery.trim();
    const matches = languages
      .filter((name) => !orderedTicked.some((n) => n.toLowerCase() === name.toLowerCase()))
      .filter((name) => query.length === 0 || name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5);
    const exactMatch = languages.some((name) => name.toLowerCase() === query.toLowerCase());
    // #165: with nothing listed there is nothing to store, so `answers: []` would leave the question
    // open and ask again forever. An empty confirm therefore takes the DECLINE path — which is what
    // it now means ("not now"), and the one path that genuinely closes the question. Both outcomes
    // are identical for the person either way: nothing stored, nothing removed from the deck.
    const confirmEmpty = !anyTicked;
    const confirmLabel = anyTicked ? "That's all of them" : "I'd rather not list any";
    return (
      <>
        <fieldset className="elig-group" aria-describedby="lang-why">
          <legend className="q">{q.question}</legend>
          {opts.isCorrection && <p className="sub">{C17}</p>}
          <p className="conseq" id="lang-why">
            {q.consequence}
          </p>
          {q.typeAhead ? (
            <div className="lang-typeahead">
              {orderedTicked.length > 0 && (
                <ul className="chips" aria-label="Languages you've listed">
                  {orderedTicked.map((name) => (
                    <li key={name}>
                      <span className="lbl">{name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        disabled={opts.isAnswering}
                        onClick={() => toggleLang(name)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="field">
                <input
                  id="lang-input"
                  ref={setFirstControl}
                  type="text"
                  value={langQuery}
                  placeholder="Type a language"
                  aria-describedby="lang-why"
                  disabled={opts.isAnswering}
                  onChange={(e) => setLangQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    addLang(langQuery);
                  }}
                />
                <button
                  type="button"
                  className="go"
                  disabled={opts.isAnswering || query.length === 0}
                  onClick={() => addLang(langQuery)}
                >
                  Add
                </button>
              </div>
              {(matches.length > 0 || (query.length > 0 && !exactMatch)) && (
                <div className="sugg" role="status" aria-live="polite">
                  {matches.map((name) => (
                    <button key={name} type="button" disabled={opts.isAnswering} onClick={() => addLang(name)}>
                      {name}
                    </button>
                  ))}
                  {/* #165: the unknown word is offered, never refused — it is kept as the person's own
                      fact and simply matches no advert until the list learns it. */}
                  {query.length > 0 && !exactMatch && (
                    <p className="note">Not on my list — I'll keep &ldquo;{query}&rdquo; as you wrote it.</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="opts">
              {languages.map((name, i) => {
                const checked = langSelected.has(name);
                return (
                  <label className="opt check" key={name}>
                    <input
                      type="checkbox"
                      name="elig-language"
                      ref={i === 0 ? setFirstControl : undefined}
                      checked={checked}
                      disabled={opts.isAnswering}
                      onChange={() => toggleLang(name)}
                    />
                    <span className="lbl">{name}</span>
                    <span className="state" aria-hidden="true">
                      {checked ? "YES" : anyTicked ? "NO" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        <div className="elig-actions">
          <button
            type="button"
            className="go wide"
            disabled={opts.isAnswering}
            onClick={() => (confirmEmpty ? opts.onDecline() : opts.onConfirm(orderedTicked))}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="opt quiet"
            disabled={opts.isAnswering}
            aria-label={`${decline} — nothing is removed from your deck`}
            onClick={opts.onDecline}
          >
            <span className="lbl">{decline}</span>
            <span className="state" aria-hidden="true">
              NOTHING REMOVED
            </span>
          </button>
        </div>
        {opts.isCorrection ? (
          <p className="notice">
            <button type="button" disabled={opts.isAnswering} onClick={cancelCorrection}>
              {C18}
            </button>
          </p>
        ) : (
          renderNotice()
        )}
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
    // The exhausted-deck loopback is the exception: it must return to answering, not this handoff.
    if (d.stage === "deck" && !loopbackFromDeck) {
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
    if (!item) {
      if (!loopbackFromDeck) return null; // defensive fallback — the deck gate above means this shouldn't be reached
      return (
        <>
          <p className="q">Tell me one more thing and I'll score more jobs.</p>
          <button type="button" className="go wide" ref={setFirstControl} onClick={loadDiscovery}>
            Answer more questions
          </button>
        </>
      );
    }
    const isAnswering = picked?.itemId === item.itemId;

    // #123: the language question — its own checkbox-group UI, branching on `multiSelect` alone
    // (the pinned contract's condition), never on dimension/itemId.
    if (item.multiSelect && item.eligibility) {
      const elig = item.eligibility;
      return renderMultiSelect(item, {
        isAnswering,
        isCorrection: false,
        onConfirm: (answers) => answerMultiSelect(item, answers),
        onDecline: () => answerFloor(item, elig.declineOption),
      });
    }

    if (item.options.length === 0) {
      // A free-text floor item (e.g. headline-focus) — the design spec doesn't pin exact copy for
      // this path (§4e only specifies the mechanic), so "Continue" is a judgment call.
      //
      // #162 QA NO-GO: a free-text question may carry a `consequence` too, and until this it was the
      // ONLY question shape that dropped it. The date-hole question ("When did you leave X?") put its
      // whole reason for existing in that field — an end date I don't have makes your experience read
      // shorter and drops you out of jobs — and the person saw a bare question and a Continue button.
      // Rendered here in the same `.conseq` shape the multi-select uses, and wired to the input by
      // aria-describedby so it reaches a screen reader too.
      return (
        <>
          <label htmlFor="floor-free" className="q">
            {item.question}
          </label>
          {item.consequence && (
            <p className="conseq" id="floor-free-why">
              {item.consequence}
            </p>
          )}
          <div className="field">
            <input
              id="floor-free"
              ref={setFirstControl}
              type="text"
              value={freeAnswer}
              disabled={isAnswering}
              aria-describedby={item.consequence ? "floor-free-why" : undefined}
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
        {/* #106: the clarifier this client composes for an eligibility ask — see eligibilitySub. */}
        {item.eligibility && <p className="sub">{eligibilitySub(item.eligibility)}</p>}
        <div className="opts" role="group" aria-labelledby="ask-q" data-elig={item.eligibility?.dimension}>
          {item.options.map((opt, i) => {
            const state = !isAnswering ? "" : opt === picked?.answer ? " picked" : " dim";
            // #106: the decline option reads as a real answer's full weight minus the emphasis —
            // never dimmed/hidden/last-styled beyond source order (design spec §4/§9).
            const quiet = item.eligibility && opt === item.eligibility.declineOption ? " quiet" : "";
            const cls = `opt${quiet}${state}`;
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
        {/* #106: tap-first by design — the numeric store rejects an uncomparable free-text string
            at the write, so this box would offer an action that fails (design spec §5.1). */}
        {!item.eligibility && renderFreeText(item, isAnswering)}
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
    <div
      className="discovery"
      ref={rootRef}
      // #17: captures the answered control's rect for the badge's flying chip, once per screen, on
      // the root — every answer handler below is triggered BY one of these two, so `flyFromRef` is
      // always fresh by the time an answer lands (M2: replaces threading a DOMRect through 5
      // functions and 11 call sites).
      onClickCapture={(e) => {
        flyFromRef.current = (
          (e.target as HTMLElement).closest("button,textarea,input") ?? (e.target as HTMLElement)
        ).getBoundingClientRect();
      }}
      onKeyDownCapture={(e) => {
        flyFromRef.current = (e.target as HTMLElement).getBoundingClientRect();
      }}
    >
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
            <FactBadge count={badgeCount} fly={fly} rootRef={rootRef} />
          </div>

          <div className="disc-layout">
            <div className="cv-column">
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
            </div>

            <div className="ask-column">
              <div className="disc-head">
                <div className="session-strip">
                  {discovery.role !== null && remaining(discovery) > 0 && (
                    <p className="countdown">{countdownCopy(remaining(discovery))}</p>
                  )}

                  <Rail
                    railFill={discovery.railFill}
                    activeSection={
                      discovery.stage === "deck" && !loopbackFromDeck
                        ? null
                        : discovery.questions[0]?.eligibility
                          ? null
                          : (discovery.questions[0]?.cvSection ?? null)
                    }
                  />
                </div>

                {renderPromise(discovery)}
              </div>

              <div className="ask">
                {loopbackFromDeck && <p className="notice">{C22}</p>}
                {renderAsk(discovery)}
              </div>
            </div>
          </div>
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
