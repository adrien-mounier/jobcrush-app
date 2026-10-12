"use client";

// #16 discovery (screen 1a): Q1 (free-text role) -> the promise -> the hand-off. Reuses the front
// door's typewriter/keepInView mechanics (page.tsx, first-question.prototype.html) against the
// pinned DiscoveryState contract.
//
// #339: discovery no longer asks people to describe their own work — the floor questions, the
// reader-only question, the "N answers until your next jobs" countdown and the section rail they fed
// are gone. #376 (ADR-0018 clause 8): work rights and languages moved into the profile's check mode,
// so the server asks nothing after question 1 — and #386 removed this screen's question UI (the
// eligibility asks, their corrections, the languages multi-select) that nothing could reach.
//
// The role line Q1 writes is the exact DiscoveryCvLine.text the API returned — never computed here.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import "../discovery.css";
import { FactBadge, type FactChipFlight } from "../factbadge";
import {
  ensureSession,
  getDiscovery,
  getIntent,
  lookupFamily,
  startDiscovery,
  type CvSection,
  type DiscoveryCvLine,
  type DiscoveryState,
} from "../../lib/api";
import { lookForSentence } from "../../lib/intentCopy";

const CV_TYPE_SPEED = 26; // ms/char, design spec §2 (CV body — distinct from the door's 36ms headline)
const TYPE_SETTLE = 300; // ms — scroll first, then type (design §5)
const FAMILY_DEBOUNCE = 250; // ms, design spec §4a
const FAMILY_LOADING_DELAY = 400; // ms before the lookup shows its own loading affordance (§4b)

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
const C14 = "Answer the question below and this page starts writing itself.";
// #386: the hand-off, after question 1. Nothing is asked here any more, so it no longer says "That's
// all I need to ask." to someone asked one question: it says what comes next — check mode for a
// brought CV (the jobs open when it is finished), the jobs themselves otherwise.
const C19 = "Your search is set.";
const C20 = "Now I'll line these jobs up against everything you told me.";
const C20_CHECK = "Next, check how I read your CV. Your jobs open when you finish.";
// #376: the hand-off waits for the person, so this screen is where they read the confirmation and
// the count before moving on.
const C_CONTINUE = "Continue";

// C8/C9's tail — the count renders beside it in its own emphasized `.n` slot (matching
// first-question.prototype.html, which the design spec builds against), so the two pieces read as
// one sentence in DOM order and to a screen reader.
//
// #246: the sentence names NO job family. It used to say "10 IT project delivery jobs are open right
// now", which was our internal label rather than her word (#228 decision 7), and for a visitor the
// product cannot name yet it was worse than a leak: the count came from the family her CV proves
// while her deck searches the words she typed, so the deck could not keep the promise. Owner
// decision 2026-08-19, the same rule #214 applied to the PLACE — if the promise cannot say it
// honestly to everyone, it does not say it. What is left is a number and a plain claim about it.
// C11's old count-failed fallback went with it: the server now sends no promise at all when it
// could not count, and design §4c already says to drop the line silently rather than print one.
//
// "new" is the owner's word, kept after he was asked to reconsider it (2026-08-20). The reservation
// put to him: these adverts are verified LIVE within the provider's freshness window, which is not
// the same as newly posted, so "new" claims a little more than the pipeline knows. He prefers it,
// and it is his call. If a freshness signal ever reaches the posting record, this is the line that
// should start earning the word rather than assuming it.
const C8 = "new jobs are open right now.";
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
};

function DiscoveryScreen() {
  const router = useRouter();

  const [discovery, setDiscovery] = useState<DiscoveryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // #257: the front door now hands off here as soon as intent is known, so its confirmation
  // sentence keeps a persistent home on this screen (owner decision 2026-08-20) — built by the
  // one shared sentence source (lib/intentCopy.ts), never a second copy of the template.
  const [intentLine, setIntentLine] = useState<string | null>(null);

  const [roleText, setRoleText] = useState("");
  const [q1Busy, setQ1Busy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [promiseLoading, setPromiseLoading] = useState(false);

  const [typingId, setTypingId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  // #17 the profile badge: the parent owns the data (the loaded/answered count, monotonically
  // clamped) and the click origin; FactBadge owns all the motion.
  const [badgeCount, setBadgeCount] = useState(0);
  const [fly, setFly] = useState<FactChipFlight | null>(null);
  // The answered control's rect, captured on the root's capture-phase click/keydown — the answer
  // handler is triggered BY one of those two, so this is always fresh by the time an answer lands.
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

  const loadDiscovery = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureSession();
      const s = await getDiscovery();
      setDiscovery(s);
      setBadgeCount((c) => Math.max(c, s.factCount)); // the monotone clamp, at every write
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "couldn't load your progress");
    }
  }, []);

  useEffect(() => {
    loadDiscovery();
  }, [loadDiscovery]);

  // #257: context only — a failure here must never block the questions, so it stays silent
  // (the line simply doesn't render) rather than joining loadDiscovery's error path.
  useEffect(() => {
    let cancelled = false;
    getIntent()
      .then((s) => {
        if (cancelled || s.checkpoint !== "intent_known" || !s.intent.targetRole) return;
        const areas = s.intent.searchAreas.map((a) => a.label);
        if (areas.length === 0) return;
        setIntentLine(lookForSentence(s.intent.targetRole, areas));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Focus follows the ask: the Q1 textarea on load. #25/#376: the hand-off moves on only when the
  // person presses Continue, and does not focus or announce itself — the next screen's own entry
  // effect focuses its heading and gives the one polite announce (AC2).
  const askKey = !discovery ? null : discovery.role === null ? "q1" : "handoff";
  const reviewPending = discovery?.reviewPending === true;
  useEffect(() => {
    if (askKey === "q1") firstControlRef.current?.focus();
  }, [askKey]);


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
      setLiveMessage(t.lineText);
    });
    return () => {
      t.bag.forEach(clearTimeout);
    };
  }, [typingId]);

  // Cuts short whatever line is mid-type, committing its already-known text instantly (design §4d
  // step 3 / §5 "never silently rewritten" — a cut-short line still lands with its full, correct
  // text, just without the letter-by-letter).
  function finalizeInFlight() {
    const t = typingRef.current;
    if (!t) return;
    t.bag.forEach(clearTimeout);
    typingRef.current = null;
    setTypingId(null);
    setDiscovery(t.fullNextState);
    setLiveMessage(t.lineText);
  }

  // Q1's answer writes the role line, typed in before the state settles.
  function applyAnswerResult(next: DiscoveryState, rawAnswer: string) {
    finalizeInFlight();
    // #17: unconditional — FactBadge's own guard (fly only if it actually exceeds what's shown) makes
    // a zero-delta a silent no-op. `flyFromRef` was set by the root's capture-phase click/keydown.
    setBadgeCount((c) => Math.max(c, next.factCount));
    if (flyFromRef.current) setFly({ rect: flyFromRef.current, label: rawAnswer });
    const prevIds = new Set((discovery?.cvLines ?? []).map((l) => l.itemId));
    const newLine = next.cvLines.find((l) => !prevIds.has(l.itemId)) ?? null;
    if (!newLine) {
      setDiscovery(next);
      return;
    }
    setDiscovery((s) => s ?? next);
    typingRef.current = { itemId: newLine.itemId, lineText: newLine.text, fullNextState: next, bag: [] };
    setTypingId(newLine.itemId);
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
    // #246: no promise means her search found nothing to count, or could not run — drop the line
    // silently (design §4c) rather than make a claim with no number behind it.
    if (!p) return null;
    return (
      <div className="promise" role="status">
        <span className="n">{p.count}</span>
        <p>
          {C8}
          <br />
          <span>{C10}</span>
        </p>
      </div>
    );
  }

  // #339: past the role line, a line here is one a session answered before discovery stopped asking
  // the floor — shown as written, never re-asked or corrected here.
  function renderCvLine(line: DiscoveryCvLine) {
    return (
      <p key={line.itemId} className="cv-line done">
        {line.text}
      </p>
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

  function renderAsk(d: DiscoveryState) {
    // Question 1 answered: the hand-off. A brought CV is checked before any job is shown (#338,
    // ADR-0016 clause 6) — the server says which with `reviewPending`; the deck refuses an unchecked
    // session anyway. #377: the check is the profile's check mode (ADR-0018).
    if (d.role !== null) {
      return (
        <div className="handoff">
          <p className="q" tabIndex={-1} ref={handoffRef}>
            {C19}
          </p>
          <p className="sub">{reviewPending ? C20_CHECK : C20}</p>
          <button type="button" className="go" onClick={() => router.push(reviewPending ? "/profile/check" : "/deck")}>
            {C_CONTINUE}
          </button>
        </div>
      );
    }

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
          {intentLine && <p className="intent-context">{intentLine}</p>}

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
                {renderPromise(discovery)}
              </div>

              <div className="ask">
                {renderAsk(discovery)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DiscoveryPage() {
  return <DiscoveryScreen />;
}
