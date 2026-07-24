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
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

export default function DiscoveryScreen() {
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

  const loadDiscovery = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureSession();
      setDiscovery(await getDiscovery());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "couldn't load your progress");
    }
  }, []);

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
  // first control as it renders — no per-answer lockout (design §6 a11y).
  const askKey = !discovery ? null : discovery.role === null ? "q1" : (discovery.questions[0]?.itemId ?? null);
  useEffect(() => {
    if (askKey) firstControlRef.current?.focus();
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
      setLiveMessage(`${t.lineText} ${countdownCopy(t.fullNextState.essentialRemaining)}`);
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

  // Shared by Q1 submit and every floor answer. Structural bits (the next question, the new
  // line's now-empty container) apply immediately; the rail fill/countdown wait for that line to
  // finish typing (see the file banner comment for why).
  function applyAnswerResult(next: DiscoveryState) {
    finalizeInFlight();
    setFreeAnswer("");
    const prevIds = new Set((discovery?.cvLines ?? []).map((l) => l.itemId));
    const newLine = next.cvLines.find((l) => !prevIds.has(l.itemId)) ?? null;

    if (!newLine) {
      // Profile-only answer (design §4d/§8.1): no line to type, nothing to gate on.
      setDiscovery(next);
      setNotice(C13);
      setLiveMessage(`${C13} ${countdownCopy(next.essentialRemaining)}`);
      return;
    }

    setNotice(null);
    setDiscovery((s) => {
      const prev = s ?? next;
      return { ...next, railFill: prev.railFill, essentialRemaining: prev.essentialRemaining };
    });
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
    try {
      applyAnswerResult(await answerDiscovery(item.itemId, answer));
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
    if (!item) return null; // the gate/reveal beyond the last essential item is #18, out of scope
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
          {notice && <p className="notice">{notice}</p>}
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
        {notice && <p className="notice">{notice}</p>}
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

          <Rail railFill={discovery.railFill} activeSection={discovery.questions[0]?.cvSection ?? null} />

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
