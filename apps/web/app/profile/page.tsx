"use client";

// #20 the profile screen (Sorted + Constellation) — under the colour law: gold = on the rendered CV
// right now, grey = saved in reserve. One derivation, rendered by both views, never re-derived here
// (design-20-profile-screen.md §3). No "what you lack" list exists anywhere on this screen: the
// payload carries no negative facts, and the UI must not invent one from an empty domain.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "../deck.css";
import "../profile.css";
import { FactBadge } from "../factbadge";
import { useReducedMotion } from "../jobcard";
import {
  ensureSession,
  getProfile,
  saveContact,
  saveTargetTitles,
  type ProfileContact,
  type ProfileDomain,
  type ProfileFact,
  type ProfileSearch,
  type ProfileState,
} from "../../lib/api";

type Screen = "loading" | "error" | "empty" | "ready";
type View = "sorted" | "constellation";

const P1 = "Gathering everything you've told me…";
const P2 = "Couldn't open your profile.";
const P3 = "Try again";
const P4 = "‹ Back";
const P5 = "your profile";
const P9 = "Nothing here yet.";
const P10 = "Answer a question and the first thing you tell me lands here.";
const P11 = "Answer a question";
const P13 = "Sorted";
const P14 = "Constellation";
const P15 = "How to view your profile";
const P12 = "Everything you tell me from here lands on this screen and stays.";
const P18 = "on your CV";
const P19 = "saved for later";
const P20 = "Every point is something you told me. Tap one.";
const P21 = "On your CV right now";
const P22 = "Saved to your profile";
const P23 = "Kept for when a job needs it. ";
const P24 = "You told me this.";
const P25 = "Read from your CV.";
const P26 = "Close";
const P29 = "Every fact, as a list";

// #183 the rail's Job family panel. R7/R8/R10 are the exact Q1 strings from discovery/page.tsx's C2/
// C5 — re-declared locally (not imported) so the door reads as returning to a familiar question.
const R1 = "Your search";
const R2 = "Job family";
const R3 = "The job you're looking for.";
const R4 = "Also searching";
const R5 = "Not the job you meant?";
const R6 = "What job are you looking for?";
const R7 = "What kind of job are you going for?";
const R8 = "That's me";
const R9 = "You haven't told me yet.";
const R10 = "Finding jobs like yours…";
const R11 = "Your answer stays until you replace it.";
const R12 = "Couldn't save that just now. Try again.";

// #190 "contact info is a fact" — the About you section's phone/email rows. Same one-mechanism
// door pattern as the Job family rail (R11/R12 above are reused verbatim: the "stays until you
// replace it" note and the save-failure line are generic, not job-specific). CX_EMAIL_LABEL says
// "on your CV" explicitly (AC7): this is the CV's contact email, never the account/login email.
const CX_HEADING = "About you";
const CX_ABSENT = "Not on your CV";
const CX_SAVING = "Saving…";
const CX_PHONE_LABEL = "Phone";
const CX_EMAIL_LABEL = "Email on your CV";
const CX_PHONE_QUESTION = "What's the best phone number for your CV?";
const CX_EMAIL_QUESTION = "What email should your CV show?";
const CX_PHONE_DOOR = "Not your number?";
const CX_EMAIL_DOOR = "Not the right email?";

// #192 the phone pull-up sheet (design-192.md §6). PS2/PS3 are aria-hidden (touch-specific wording);
// the grabber's accessible name comes from PS1 + the sr-only count instead (§7).
const PS1 = "Your facts";
const PS2 = "Pull up to open";
const PS3 = "Pull down to close";
const PS4 = "Your facts opened.";
const PS5 = "Your facts closed.";

const ICON_SORTED = (
  <svg className="ic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
    <path d="M2 3.5h10M2 7h7M2 10.5h4" />
  </svg>
);
const ICON_SKY = (
  <svg className="ic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
    <circle cx="3.4" cy="4" r="1.5" />
    <circle cx="10.6" cy="3.2" r="1.2" />
    <circle cx="7" cy="9.8" r="1.6" />
    <path d="M4.6 4.9 5.9 8.5M9.6 4.2 8 8.5" strokeLinecap="round" />
  </svg>
);
const ICON_BRIEFCASE = (
  <svg className="pic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
    <rect x="1.8" y="4.4" width="10.4" height="7.2" rx="1.6" />
    <path d="M5 4.4V3.3a1.1 1.1 0 0 1 1.1-1.1h1.8A1.1 1.1 0 0 1 9 3.3v1.1M1.8 7.4h10.4" />
  </svg>
);

// #183 hero line 2 (design-183-desktop-profile-shape-a.md §2) — the "kept for when a job needs
// them" framing, never the dead "waiting for a job that asks" one. `rest` is total − gold; it is
// never itself numbered in copy, only gold is.
function Pwait({ gold, rest }: { gold: number; rest: number }) {
  if (rest > 0) {
    if (gold === 0) {
      return <p className="pwait">None make your CV right now — they&apos;re all kept for when a job needs them.</p>;
    }
    return (
      <p className="pwait">
        <b className="g">{gold}</b> {gold === 1 ? "makes" : "make"} your CV right now — your strongest selection. The rest
        are kept for when a job needs them.
      </p>
    );
  }
  if (gold === 1) {
    return <p className="pwait">It makes your CV right now.</p>;
  }
  return (
    <p className="pwait">
      All <b className="g">{gold}</b> make your CV right now — your strongest selection.
    </p>
  );
}

// §1: the payload has no explicit strength score, so the local proxy is longest text.
// Ties → lowest index (store order); colour is only the visual law, never the ranking law.
function pickLead(facts: ProfileFact[]): { lead: ProfileFact; rest: ProfileFact[] } {
  let lead = facts[0];
  for (const f of facts) if (f.text.length > lead.text.length) lead = f;
  return { lead, rest: facts.filter((f) => f.id !== lead.id) };
}

function chipText(text: string): string {
  return text.replace(/\.$/, "");
}

function sourceLine(source: ProfileFact["source"]): string {
  return source === "told" ? P24 : P25;
}

// The shared detail block (§4) — the same three lines whether painted into the Sorted dialog or the
// Constellation sheet.
function DetailBody({ fact }: { fact: ProfileFact }) {
  const on = fact.colour === "gold";
  return (
    <>
      <p className={`cl ${on ? "on" : "wait"}`}>
        <i aria-hidden="true" />
        {on ? P21 : P22}
      </p>
      <p className="txt">{fact.text}</p>
      <p className="src">
        {!on && P23}
        <b>{sourceLine(fact.source)}</b>
      </p>
    </>
  );
}

// #183 §3.3 — an open-jobs sentence, singular-aware, worded differently depending on whether
// siblings are shown alongside it. `n` is never rendered as a bare number; the whole clause is bold.
function OpenJobsLine({ n, hasSiblings }: { n: number; hasSiblings: boolean }) {
  const word = n === 1 ? "job open" : "jobs open";
  const tail = hasSiblings ? "across these titles right now." : "for this job right now.";
  return (
    <p className="rsrc">
      <b>
        {n} {word}
      </b>{" "}
      {tail}
    </p>
  );
}

// #190 one contact field's row (Phone or Email) inside the About you section — the exact
// one-mechanism door pattern from JobFamilyPanel above: a display block (value + origin, shown the
// way DetailBody shows a fact's source — reusing `.src`/sourceLine's P24/P25 pair verbatim) that the
// door replaces in place with the pinned question, pre-filled with the current value. Saves via
// saveContact then re-fetches /api/profile, exactly like the Job family door — including the same
// "a refetch failure is never reported as a save failure" honesty (#183 code review, applied here
// from the start): only the PUT itself can produce the error state.
function ContactField({
  field,
  label,
  question,
  doorLabel,
  contact,
  onUpdated,
  onAnnounce,
}: {
  field: "phone" | "email";
  label: string;
  question: string;
  doorLabel: string;
  contact: ProfileContact;
  onUpdated: (contact: ProfileContact) => void;
  onAnnounce: (message: string) => void;
}) {
  const data = contact[field];
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState(data?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `contact-${field}-again`;

  useEffect(() => {
    if (asking) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [asking]);

  function openDoor() {
    setValue(data?.value ?? "");
    setError(null);
    setAsking(true);
  }

  function closeDoor() {
    setAsking(false);
    setError(null);
    requestAnimationFrame(() => doorRef.current?.focus());
  }

  async function save() {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveContact(field, next);
    } catch {
      setSaving(false);
      setError(R12);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    try {
      const fresh = await getProfile();
      onUpdated(fresh.contact);
    } catch {
      onUpdated({ ...contact, [field]: { value: next, origin: "person-said" } });
    }
    onAnnounce(`${label} updated.`);
    setSaving(false);
    setAsking(false);
    requestAnimationFrame(() => doorRef.current?.focus());
  }

  return (
    <div className="cxfield">
      <p className="cxlabel">{label}</p>
      {asking ? (
        <div className="rq">
          <label className="rqq" htmlFor={inputId}>
            {question}
          </label>
          <input
            className="rin"
            id={inputId}
            type="text"
            ref={inputRef}
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                // QA fix: the question consumes its own Escape so the phone sheet's page-level
                // Escape handler never also sees it — without this, closing the question on phone
                // also collapsed the sheet out from under the door focus() below.
                e.stopPropagation();
                closeDoor();
              }
            }}
          />
          <div className="rbtns">
            <button type="button" className="rbtn" disabled={saving || !value.trim()} onClick={save}>
              Save
            </button>
            <button type="button" className="rbtn" disabled={saving} onClick={closeDoor}>
              {data ? `Keep ${data.value}` : "Not now"}
            </button>
          </div>
          {saving && <p className="rbusy">{CX_SAVING}</p>}
          {error && (
            <p className="rerr" role="alert">
              {error}
            </p>
          )}
          {!saving && !error && <p className="rnote">{R11}</p>}
        </div>
      ) : (
        <>
          {data ? (
            <>
              <p className="cxvalue">{data.value}</p>
              <p className="src">
                <b>{data.origin === "person-said" ? P24 : P25}</b>
              </p>
            </>
          ) : (
            <p className="cxvalue cxmute">{CX_ABSENT}</p>
          )}
          <button type="button" ref={doorRef} className="rdoor" onClick={openDoor}>
            {data ? doorLabel : question}
          </button>
        </>
      )}
    </div>
  );
}

// #190 the About you section — always the first section in Sorted, always rendered (contact is
// additive on the payload, never absent), so honest absence ("Not on your CV") has somewhere to
// live even for a person with neither phone nor email captured yet.
function AboutYou({
  contact,
  onUpdated,
  onAnnounce,
}: {
  contact: ProfileContact;
  onUpdated: (contact: ProfileContact) => void;
  onAnnounce: (message: string) => void;
}) {
  return (
    <section className="dom">
      <div className="dhead">
        <h2 className="dname">{CX_HEADING}</h2>
      </div>
      <ContactField
        field="phone"
        label={CX_PHONE_LABEL}
        question={CX_PHONE_QUESTION}
        doorLabel={CX_PHONE_DOOR}
        contact={contact}
        onUpdated={onUpdated}
        onAnnounce={onAnnounce}
      />
      <ContactField
        field="email"
        label={CX_EMAIL_LABEL}
        question={CX_EMAIL_QUESTION}
        doorLabel={CX_EMAIL_DOOR}
        contact={contact}
        onUpdated={onUpdated}
        onAnnounce={onAnnounce}
      />
    </section>
  );
}

// #183 the rail's Job family section (design spec §3). Pre-E5 (`family === null`) is the permanent
// shape: role as typed + the door, nothing else — never a family/sibling/count derived client-side.
// The door replaces the display block in place with Q1's own question, re-declared locally (§3.5);
// answering it re-saves via the existing targets route and re-renders from a fresh /api/profile
// fetch — it never calls startDiscovery, which would restart the whole discovery flow.
function JobFamilyPanel({
  search,
  onSearchUpdated,
  onAnnounce,
}: {
  search: ProfileSearch;
  onSearchUpdated: (search: ProfileSearch) => void;
  onAnnounce: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState(search.role ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (asking) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [asking]);

  function openDoor() {
    setValue(search.role ?? "");
    setError(null);
    setAsking(true);
  }

  function closeDoor() {
    setAsking(false);
    setError(null);
    requestAnimationFrame(() => doorRef.current?.focus());
  }

  async function save() {
    const role = value.trim();
    if (role.length < 2 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveTargetTitles([role]);
    } catch {
      // The save itself failed — the server never got the new role. This is the only case R12 may
      // report, so it never claims a save failed when it actually succeeded.
      setSaving(false);
      setError(R12);
      // §6.4: failure keeps focus in the input (never moves it to the button that was just clicked).
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    // The save succeeded — the server already holds the new role. A refetch failure past this point
    // must never be reported as a save failure; fall back to the value we just saved (the next full
    // profile load will pick up any fresher family/siblings/openJobs derived from it).
    try {
      const fresh = await getProfile();
      onSearchUpdated(fresh.search);
      onAnnounce(`Now searching ${fresh.search.role ?? role}.`);
    } catch {
      onSearchUpdated({ ...search, role });
      onAnnounce(`Now searching ${role}.`);
    }
    setSaving(false);
    setAsking(false);
    requestAnimationFrame(() => doorRef.current?.focus());
  }

  const hasSiblings = search.siblingTitles.length > 0;
  const hasRow = hasSiblings || search.openJobs !== null;
  const door = (
    <button type="button" ref={doorRef} className="rdoor" onClick={openDoor}>
      {search.role === null ? R6 : R5}
    </button>
  );

  return (
    <section className="rpanel">
      <h2 className="rtitle">
        {ICON_BRIEFCASE}
        {R2}
      </h2>
      <p className="rsub">{R3}</p>
      {asking ? (
        <div className="rq">
          <label className="rqq" htmlFor="role-again">
            {R7}
          </label>
          <input
            className="rin"
            id="role-again"
            type="text"
            ref={inputRef}
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                // QA fix (same as ContactField): consume Escape here so the phone sheet's
                // page-level handler never also collapses the sheet out from under this door.
                e.stopPropagation();
                closeDoor();
              }
            }}
          />
          <div className="rbtns">
            <button type="button" className="rbtn" disabled={saving || value.trim().length < 2} onClick={save}>
              {R8}
            </button>
            <button type="button" className="rbtn" disabled={saving} onClick={closeDoor}>
              {search.role ? `Keep ${search.role}` : "Not now"}
            </button>
          </div>
          {saving && <p className="rbusy">{R10}</p>}
          {error && (
            <p className="rerr" role="alert">
              {error}
            </p>
          )}
          {!saving && !error && <p className="rnote">{R11}</p>}
        </div>
      ) : (
        <>
          {search.role === null ? <p className="rrole rmute">{R9}</p> : <p className="rrole">{search.role}</p>}
          {search.family !== null && <p className="rfam">Part of {search.family}.</p>}
          {hasRow ? (
            <div className="rrow">
              {hasSiblings && (
                <>
                  <p className="rlabel">{R4}</p>
                  <div className="rkin">
                    {search.siblingTitles.map((title) => (
                      <span className="rtag" key={title}>
                        {title}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {search.openJobs !== null && <OpenJobsLine n={search.openJobs} hasSiblings={hasSiblings} />}
              {door}
            </div>
          ) : (
            door
          )}
        </>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [view, setView] = useState<View>("sorted");
  const [liveMessage, setLiveMessage] = useState("");
  const [selected, setSelected] = useState<ProfileFact | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const sortedButtonRef = useRef<HTMLButtonElement>(null);
  const skyButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const sortedScrollRef = useRef(0);
  const sortedBodyRef = useRef<HTMLDivElement>(null);
  const enteredRef = useRef(false);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureSession();
      const state = await getProfile();
      setProfile(state);
      const hasFacts = state.domains.some((d) => d.facts.length > 0);
      setScreen(hasFacts ? "ready" : "empty");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Entry (§8): focus the first meaningful target when loading resolves.
  useEffect(() => {
    if (screen === "ready" && !enteredRef.current) {
      enteredRef.current = true;
      headingRef.current?.focus();
    } else if (screen === "empty") {
      emptyHeadingRef.current?.focus();
    } else if (screen === "error") {
      errorRef.current?.focus();
    }
  }, [screen]);

  const handleSearchUpdated = useCallback((search: ProfileSearch) => {
    setProfile((p) => (p ? { ...p, search } : p));
  }, []);

  const handleContactUpdated = useCallback((contact: ProfileContact) => {
    setProfile((p) => (p ? { ...p, contact } : p));
  }, []);

  const restoreDialogFocus = useCallback(() => {
    const opener = dialogOpenerRef.current;
    dialogOpenerRef.current = null;
    requestAnimationFrame(() => {
      const fallback = (view === "sorted" ? sortedButtonRef.current : skyButtonRef.current) ?? headingRef.current;
      const target = opener?.isConnected ? opener : fallback;
      target?.focus({ preventScroll: true });
    });
  }, [view]);

  const openFact = useCallback(
    (fact: ProfileFact) => {
      setSelected(fact);
      if (view === "sorted" && !dialogRef.current?.open) {
        const active = document.activeElement;
        dialogOpenerRef.current = active instanceof HTMLElement ? active : null;
        dialogRef.current?.showModal();
      }
      setLiveMessage(`${fact.text} — ${fact.colour === "gold" ? P21 : P22}. ${sourceLine(fact.source)}`);
    },
    [view],
  );

  const closeDialog = useCallback(() => {
    if (dialogRef.current?.open) {
      dialogRef.current.close();
      return;
    }
    setSelected(null);
  }, []);

  const handleDialogClosed = useCallback(() => {
    setSelected(null);
    restoreDialogFocus();
  }, [restoreDialogFocus]);

  const switchView = useCallback((next: View) => {
    if (next === view) return;
    closeDialog();
    if (view === "sorted") sortedScrollRef.current = sortedBodyRef.current?.scrollTop ?? 0;
    setView(next);
    setLiveMessage(next === "sorted" ? "Sorted view" : "Constellation view");
    if (next === "sorted") {
      requestAnimationFrame(() => {
        if (sortedBodyRef.current) sortedBodyRef.current.scrollTop = sortedScrollRef.current;
      });
    }
    (next === "sorted" ? sortedButtonRef : skyButtonRef).current?.focus();
  }, [closeDialog, view]);

  const totalCount = profile?.factCount ?? 0;

  return (
    <div className="jobdeck profile" ref={rootRef}>
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {screen === "loading" && <div className="loadstate">{P1}</div>}

      {screen === "error" && (
        <div className="loadstate">
          <p role="alert" tabIndex={-1} ref={errorRef}>
            {P2}
          </p>
          <button type="button" onClick={load}>
            {P3}
          </button>
        </div>
      )}

      {screen === "empty" && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={emptyHeadingRef}>
            {P9}
          </h1>
          <p>{P10}</p>
          <button type="button" onClick={() => router.push("/discovery")}>
            {P11}
          </button>
        </div>
      )}

      {screen === "ready" && profile && (
        <ReadyScreen
          profile={profile}
          view={view}
          totalCount={totalCount}
          reducedMotion={reducedMotion}
          rootRef={rootRef}
          headingRef={headingRef}
          sortedButtonRef={sortedButtonRef}
          skyButtonRef={skyButtonRef}
          dialogRef={dialogRef}
          sortedBodyRef={sortedBodyRef}
          selected={selected}
          onSwitchView={switchView}
          onOpenFact={openFact}
          onCloseDialog={closeDialog}
          onDialogClosed={handleDialogClosed}
          onBack={() => router.back()}
          onSearchUpdated={handleSearchUpdated}
          onContactUpdated={handleContactUpdated}
          onAnnounce={setLiveMessage}
        />
      )}
    </div>
  );
}

function ReadyScreen({
  profile,
  view,
  totalCount,
  reducedMotion,
  rootRef,
  headingRef,
  sortedButtonRef,
  skyButtonRef,
  dialogRef,
  sortedBodyRef,
  selected,
  onSwitchView,
  onOpenFact,
  onCloseDialog,
  onDialogClosed,
  onBack,
  onSearchUpdated,
  onContactUpdated,
  onAnnounce,
}: {
  profile: ProfileState;
  view: View;
  totalCount: number;
  reducedMotion: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  sortedButtonRef: React.RefObject<HTMLButtonElement | null>;
  skyButtonRef: React.RefObject<HTMLButtonElement | null>;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  sortedBodyRef: React.RefObject<HTMLDivElement | null>;
  selected: ProfileFact | null;
  onSwitchView: (v: View) => void;
  onOpenFact: (f: ProfileFact) => void;
  onCloseDialog: () => void;
  onDialogClosed: () => void;
  onBack: () => void;
  onSearchUpdated: (search: ProfileSearch) => void;
  onContactUpdated: (contact: ProfileContact) => void;
  onAnnounce: (message: string) => void;
}) {
  const indRef = useRef<HTMLSpanElement>(null);

  // §2: the sliding pill is positioned off the pressed button's own box, not hard-coded — works at
  // any width/floor without a second breakpoint to maintain.
  useLayoutEffect(() => {
    const btn = (view === "sorted" ? sortedButtonRef : skyButtonRef).current;
    const ind = indRef.current;
    if (!btn || !ind) return;
    function place() {
      ind!.style.left = `${btn!.offsetLeft}px`;
      ind!.style.width = `${btn!.offsetWidth}px`;
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [view, sortedButtonRef, skyButtonRef]);

  // #192 the phone pull-up sheet — collapsed by default; inert on desktop, where `.pfsheet` is
  // `display: contents` and `.pfsheet-head` is `display: none` (design spec §8). Every entry point
  // (openSheet/closeSheet/toggleSheet, the Escape handler) is gated behind `isSheetActive()` so a
  // desktop click/keypress can never announce, open, or expose sheet-only ARIA — code review
  // MUST-FIX: the sheet must not leak onto desktop.
  const sheetRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<HTMLButtonElement>(null);
  const pfheadRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Whether the sheet exists at all right now, per the DOM's own rendered state — never a viewport
  // sniff. Drives the `role`/`aria-label` on `.pfsheet` (display: contents can otherwise leave a
  // phantom landmark behind on desktop) and is re-derived by the same measurement effect below.
  const [sheetActive, setSheetActive] = useState(false);
  // §2.3: the fallback matches the CSS custom property's own fallback (76px) until the first real
  // measurement lands.
  const peekPxRef = useRef(76);
  // code review fix 3: the safe-area inset, read once (and on every re-measure) from a zero-impact
  // computed-style probe (`.profile`'s `scroll-padding-bottom`, profile.css) — never hard-coded —
  // so the JS drag's max range agrees with the CSS collapsed rest position (`100% - peek - safe
  // area`) instead of overshooting it and visibly snapping on notched phones.
  const safeAreaRef = useRef(0);
  // §3.3: mirrors deck/page.tsx's card-drag idiom, rotated 90° — a mutable per-gesture record (not
  // React state, so pointermove never re-renders) plus `draggedRef`, which survives past the
  // pointerup-to-synthetic-click boundary so onClick can tell a drag from a tap (§3.3's last rule).
  // `pointerId` (code review fix 4) is checked once live so a second finger touching down mid-drag
  // can never hijack the gesture that already has pointer capture.
  const dragStateRef = useRef<{ y0: number; dy: number; openAtStart: boolean; live: boolean; pointerId: number | null } | null>(
    null,
  );
  const draggedRef = useRef(false);

  // The sheet exists only when `.pfsheet-head` actually has a box — true at ≤899px (a child of the
  // fixed `.pfsheet`), false at ≥900px (`display: none`). `offsetParent` is null in exactly that
  // case, and it is a live read of the real rendered DOM, not a media-query duplicated into JS.
  function isSheetActive(): boolean {
    const head = pfheadRef.current;
    return head !== null && head.offsetParent !== null;
  }

  // §2.3: measured on the root (not the sheet) because `.rail`'s bottom padding needs the same
  // value. Re-measures on any size change of the head itself — rotation, dynamic type, the §2.2
  // hint-string swap, and crossing the 900px breakpoint (the head's own box changes from ~72px to
  // 0) all naturally trigger a ResizeObserver firing, no extra dependency needed.
  useLayoutEffect(() => {
    const head = pfheadRef.current;
    const root = rootRef.current;
    if (!head || !root) return;
    function measure() {
      setSheetActive(isSheetActive());
      const h = head!.getBoundingClientRect().height;
      if (h > 0) {
        peekPxRef.current = h;
        root!.style.setProperty("--pf-peek", `${h}px`);
      }
      const safe = parseFloat(getComputedStyle(root!).scrollPaddingBottom);
      safeAreaRef.current = Number.isFinite(safe) ? safe : 0;
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  }, [rootRef]);

  function announceSheet(open: boolean) {
    onAnnounce(open ? PS4 : PS5);
  }
  function openSheet() {
    if (!isSheetActive() || sheetOpen) return;
    setSheetOpen(true);
    announceSheet(true);
  }
  function closeSheet() {
    if (!isSheetActive() || !sheetOpen) return;
    setSheetOpen(false);
    announceSheet(false);
    // code review fix 2 (§3.6): the sheet body's delayed `visibility: hidden` would otherwise strand
    // focus at <body> if it was on something inside the sheet when this fired (Escape, or a drag
    // released past the close threshold) — focus lands on / stays on the grabber on every collapse.
    const active = document.activeElement;
    if (active && active !== grabRef.current && sheetRef.current?.contains(active)) {
      grabRef.current?.focus();
    }
  }
  function toggleSheet() {
    if (!isSheetActive()) return;
    setSheetOpen(!sheetOpen);
    announceSheet(!sheetOpen);
  }

  // §3.2 layered Escape dismissal, first match wins: the native dialog owns its own Escape (rule 1,
  // so this never fires while it's open). Rules 2/3 are both scoped to "expanded", which only means
  // something where the sheet exists at all — gated behind `isSheetActive()` so Escape-clears-
  // selection stays the phone-sheet behaviour the spec asked for, not a new desktop one (code review
  // MUST-FIX: desktop must be behaviour-identical to shipped, not just visually).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // QA fix: a door's own Escape handler calls preventDefault() when it consumes the key (it
      // also calls stopPropagation(), but that alone isn't reliable here — React delegates its own
      // root listener very close to `document`, so two same-node listeners fire in registration
      // order regardless of stopPropagation()). `defaultPrevented` is a property of the shared
      // event object, so it is set well before this ancestor-level listener ever sees the event,
      // independent of listener registration order.
      if (e.defaultPrevented) return;
      if (dialogRef.current?.open) return;
      if (!isSheetActive() || !sheetOpen) return;
      if (selected) {
        onCloseDialog();
        return;
      }
      closeSheet();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogRef, selected, sheetOpen, onCloseDialog]);

  // §3.3 drag, rotated 90° from the deck's horizontal swipe. Handlers live on `.pfgrab` (pointer
  // capture keeps them firing there through the whole gesture); the inline transform is written to
  // the sheet itself, which is what actually slides.
  function onGrabPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragStateRef.current?.live) return; // a second pointer must not hijack an in-progress drag
    draggedRef.current = false;
    dragStateRef.current = { y0: e.clientY, dy: 0, openAtStart: sheetOpen, live: false, pointerId: null };
  }
  function onGrabPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (!drag) return;
    if (drag.live && e.pointerId !== drag.pointerId) return; // ignore other pointers once captured
    const dy = e.clientY - drag.y0;
    drag.dy = dy;
    if (!drag.live) {
      if (Math.abs(dy) < 6) return;
      drag.live = true;
      drag.pointerId = e.pointerId;
      draggedRef.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Under reduced motion, track `dy` for the pointerup decision but never move the sheet live —
    // the shipped precedent for this is deck/page.tsx's own `if (!reducedMotion) setDragX(dx)`.
    if (reducedMotion) return;
    const sheetEl = sheetRef.current;
    if (!sheetEl) return;
    // code review fix 3: matches the CSS collapsed transform's own formula exactly.
    const max = Math.max(0, sheetEl.getBoundingClientRect().height - peekPxRef.current - safeAreaRef.current);
    const base = drag.openAtStart ? 0 : max;
    const y = Math.min(max, Math.max(0, base + dy));
    sheetEl.style.transform = `translateY(${y}px)`;
  }
  function onGrabPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (drag?.live && e.pointerId !== drag.pointerId) return; // a stray pointer must not end the real gesture
    dragStateRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (sheetRef.current) sheetRef.current.style.transform = "";
    if (!drag || !drag.live) return;
    if (drag.dy < -56) openSheet();
    else if (drag.dy > 56) closeSheet();
    else if (drag.openAtStart) openSheet();
    else closeSheet();
  }
  // §3.3 last rule: a drag's synthetic click must not also toggle — `draggedRef` is the guard,
  // reset on the next pointerdown rather than here.
  function onGrabClick() {
    // QA fix: this must CONSUME the flag, not just read it — it was previously cleared only in
    // onGrabPointerDown, so a keyboard Enter/Space (which fires click with no pointerdown at all)
    // read a flag left `true` by the last drag forever, going permanently keyboard-dead.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    toggleSheet();
  }

  const visibleCount = profile.domains.reduce((s, d) => s + d.facts.length, 0);
  const gold = profile.domains.reduce((s, d) => s + d.facts.filter((f) => f.colour === "gold").length, 0);
  // rest is total − gold (the h1's factCount), not visible − gold: factCount includes facts the
  // domains don't draw (e.g. "no" answers), and the two hero lines must never contradict each other.
  const grey = Math.max(0, profile.factCount - gold);
  const showP12 = visibleCount <= 2;

  const domains = useMemo(() => [...profile.domains].sort((a, b) => b.facts.length - a.facts.length), [profile.domains]);
  const biggest = domains.reduce((m, d) => Math.max(m, d.facts.length), 1);

  return (
    <>
      <div className="topbar">
        <button type="button" className="back" aria-label="Back" onClick={onBack}>
          {P4}
        </button>
        <div className="seg" role="group" aria-label={P15}>
          <span className="ind" ref={indRef} aria-hidden="true" />
          <button
            type="button"
            ref={sortedButtonRef}
            className={view === "sorted" ? "on" : ""}
            aria-pressed={view === "sorted"}
            title={P13}
            aria-label={P13}
            aria-controls="profileview"
            onClick={() => {
              // §3.2: the toggle stays in the topbar, so on phone it must be able to reach what it
              // controls even while the sheet sits collapsed. openSheet() is idempotent; switchView
              // early-returns on an unchanged view, so the open must never be gated behind it.
              openSheet();
              onSwitchView("sorted");
            }}
          >
            {ICON_SORTED}
          </button>
          <button
            type="button"
            ref={skyButtonRef}
            className={view === "constellation" ? "on" : ""}
            aria-pressed={view === "constellation"}
            title={P14}
            aria-label={P14}
            aria-controls="profileview"
            onClick={() => {
              openSheet();
              onSwitchView("constellation");
            }}
          >
            {ICON_SKY}
          </button>
        </div>
        <FactBadge count={totalCount} fly={null} rootRef={rootRef} />
      </div>

      <div className="stage">
        <div className={`field ${view}`}>
          {/* #192 §1: the hero now renders in every view (was Sorted-only); desktop restores its
              Sorted-only hero via `.field.constellation .phead { display: none }` at ≥900px. */}
          <section className="phead">
            <p className="ptitle">{P5}</p>
            <h1 className="pcount" tabIndex={-1} ref={headingRef}>
              <span className="n">{totalCount}</span>{" "}
              <span className="t">{totalCount === 1 ? "thing you've told me" : "things you've told me"}</span>
            </h1>
            <Pwait gold={gold} rest={grey} />
          </section>

          {/* #192 §1: one DOM, two layouts. At ≥900px `.pfsheet`/`.pfsheet-body` are `display:
              contents`, so `.body` is once again a direct flex child of `.field` — desktop shape A
              is byte-identical. At ≤899px this becomes the fixed pull-up sheet. `role`/`aria-label`
              are added only while `sheetActive` — `display: contents` does not reliably strip an
              element's own ARIA semantics, so an unconditional landmark here would survive on
              desktop as an empty "Your facts" region (code review MUST-FIX). */}
          <div
            className={`pfsheet ${view}${sheetOpen ? " open" : ""}${dragging ? " dragging" : ""}`}
            ref={sheetRef}
            {...(sheetActive ? { role: "region", "aria-label": PS1 } : {})}
          >
            <div className="pfsheet-head" ref={pfheadRef}>
              <button
                type="button"
                className="pfgrab"
                ref={grabRef}
                aria-expanded={sheetOpen}
                aria-controls="pfsheetbody"
                onClick={onGrabClick}
                onPointerDown={onGrabPointerDown}
                onPointerMove={onGrabPointerMove}
                onPointerUp={onGrabPointerUp}
                onPointerCancel={onGrabPointerUp}
              >
                <span className="pfbar" aria-hidden="true" />
                <span className="pfrow">
                  <span className="pftitle">{PS1}</span>{" "}
                  <span className="pfnum">
                    {totalCount}
                    <span className="sr-only"> {totalCount === 1 ? "fact" : "facts"}</span>
                  </span>
                </span>
                <span className="pfhint" aria-hidden="true">
                  {sheetOpen ? PS3 : PS2}
                </span>
              </button>
            </div>
            <div id="pfsheetbody" className="pfsheet-body">
              <div id="profileview" className={`body ${view}`} ref={view === "sorted" ? sortedBodyRef : undefined}>
                {view === "sorted" ? (
                  <div className="sheetwrap">
                    <AboutYou contact={profile.contact} onUpdated={onContactUpdated} onAnnounce={onAnnounce} />
                    {domains.map((d, i) => {
                      const { lead, rest } = pickLead(d.facts);
                      const a = (0.035 + 0.075 * (d.facts.length / biggest)).toFixed(3);
                      return (
                        <section
                          className="dom"
                          key={d.tag}
                          style={reducedMotion ? undefined : { animationDelay: `${Math.min(i * 55, 330)}ms` }}
                        >
                          <span className="aura" style={{ ["--a" as string]: a }} aria-hidden="true" />
                          <div className="dhead">
                            <h2 className="dname">{d.heading}</h2>
                            <span className="dcount">
                              {d.facts.length}
                              <span className="sr-only"> {d.facts.length === 1 ? "fact" : "facts"}</span>
                            </span>
                          </div>
                          <p className={`dlead ${lead.colour}`}>{lead.text}</p>
                          {rest.length > 0 && (
                            <div className="facts">
                              {rest.map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  className={`fact ${f.colour}`}
                                  aria-label={`${f.text} — ${f.colour === "gold" ? P21 : P22}`}
                                  onClick={() => onOpenFact(f)}
                                >
                                  {chipText(f.text)}
                                </button>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                    <p className="dnote">
                      {showP12
                        ? P12
                        : "The highlighted ones make your CV right now. The rest are kept for when a job needs them. Your CV is two pages, so it picks; nothing is ever dropped."}
                    </p>
                  </div>
                ) : (
                  <Constellation domains={domains} reducedMotion={reducedMotion} selected={selected} onOpenFact={onOpenFact} />
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="rail" aria-label={R1}>
          <JobFamilyPanel search={profile.search} onSearchUpdated={onSearchUpdated} onAnnounce={onAnnounce} />
        </aside>
      </div>

      <dialog
        className="detail"
        ref={dialogRef}
        onClose={onDialogClosed}
        onClick={(e) => {
          if (e.target === dialogRef.current) onCloseDialog();
        }}
      >
        {selected && (
          <>
            <DetailBody fact={selected} />
            <button type="button" className="detailclose" onClick={onCloseDialog}>
              {P26}
            </button>
          </>
        )}
      </dialog>
    </>
  );
}

// ---------- Constellation ----------

const VB = 120;
const PAD_B = 104;

interface SkyNode {
  fact: ProfileFact;
  domainIndex: number;
  nx: number;
  ny: number;
  depth: number;
  ph: number;
  sp: number;
  linked: number[]; // indices into the flat node array — nearest already-placed sibling(s)
}

function buildSky(domains: ProfileDomain[]): SkyNode[] {
  const nodes: SkyNode[] = [];
  const k = domains.length;
  domains.forEach((d, i) => {
    const R = k <= 2 ? 17 : 34;
    const a = (i / k) * 2 * Math.PI - Math.PI / 2;
    const cx = 60 + Math.cos(a) * R;
    const cy = 60 + Math.sin(a) * R * 0.94;
    const m = d.facts.length;
    const maxSpr = k < 3 ? 18 : Math.min(19, R * Math.sin(Math.PI / k) * 0.9);
    const spread = Math.min(maxSpr, 3.4 + Math.sqrt(m) * 2.6);
    const domainStart = nodes.length;
    d.facts.forEach((fact, j) => {
      const r = spread * Math.sqrt((j + 0.6) / m);
      const theta = j * 2.399963;
      const nx = cx + Math.cos(theta) * r;
      const ny = cy + Math.sin(theta) * r;
      const depth = 0.45 + (((j * 37 + i * 71) % 100) / 100) * 0.55;
      const ph = j * 1.7 + i;
      const sp = 0.7 + (((j * 53 + i * 17) % 100) / 100) * 0.6;
      // ponytail: O(m²) nearest-sibling scan — fine at m <= 200 (design-20-profile-screen.md §5);
      // upgrade to a spatial grid if a domain ever grows past that.
      let nearest = -1;
      let best = Infinity;
      for (let p = 0; p < j; p++) {
        const other = nodes[domainStart + p];
        const dx = other.nx - nx;
        const dy = other.ny - ny;
        const dist = dx * dx + dy * dy;
        if (dist < best) {
          best = dist;
          nearest = domainStart + p;
        }
      }
      const idx = nodes.length;
      const node: SkyNode = { fact, domainIndex: i, nx, ny, depth, ph, sp, linked: [] };
      if (nearest >= 0) {
        node.linked.push(nearest);
        nodes[nearest].linked.push(idx);
      }
      nodes.push(node);
    });
  });
  return nodes;
}

function Constellation({
  domains,
  reducedMotion,
  selected,
  onOpenFact,
}: {
  domains: ProfileDomain[];
  reducedMotion: boolean;
  selected: ProfileFact | null;
  onOpenFact: (f: ProfileFact) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<SkyNode[]>([]);
  const spritesRef = useRef<{ gold: HTMLCanvasElement; grey: HTMLCanvasElement } | null>(null);
  const rafRef = useRef<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const selIndexRef = useRef<number | null>(null);
  const t0Ref = useRef(0);
  const geomRef = useRef({ s: 1, sy: 1, ox: 0, oy: 0, usable: 0, w: 0, h: 0 });
  const [geom, setGeom] = useState(() => geomRef.current);
  const nodes = useMemo(() => buildSky(domains), [domains]);

  useEffect(() => {
    nodesRef.current = nodes;
    hoveredRef.current = null;
    selIndexRef.current = null;
  }, [nodes]);

  // Bloom sprites, baked once (§5) — the low-power path: never a live createRadialGradient per node.
  useEffect(() => {
    function makeSprite(rgb: string) {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, `rgba(${rgb},0.9)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return c;
    }
    spritesRef.current = { gold: makeSprite("232,163,61"), grey: makeSprite("116,138,161") };
  }, []);

  function px(n: SkyNode, t: number): { x: number; y: number } {
    const { s, sy, ox, oy } = geomRef.current;
    if (reducedMotion) return { x: ox + n.nx * s, y: oy + n.ny * sy };
    const A = 2.1 * n.depth;
    const w = t * 0.00026 * n.sp;
    const x = ox + (n.nx + Math.sin(w + n.ph) * A + Math.sin(w * 2.3 + n.ph * 0.6) * A * 0.3) * s;
    const y = oy + (n.ny + Math.cos(w * 0.82 + n.ph * 1.3) * A + Math.cos(w * 1.9 + n.ph) * A * 0.28) * sy;
    return { x, y };
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(rect.width * dpr);
      canvas!.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const usable = Math.max(60, rect.height - PAD_B);
      const s = Math.min(rect.width, usable) / VB;
      const sy = Math.min(usable / VB, s * 1.32);
      const ox = (rect.width - VB * s) / 2;
      const oy = (usable - VB * sy) / 2 + 6;
      const nextGeom = { s, sy, ox, oy, usable, w: rect.width, h: rect.height };
      geomRef.current = nextGeom;
      setGeom(nextGeom);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const n = nodesRef.current.length || 1;
    const baseR = Math.min(3.2, Math.max(n < 8 ? 2.2 : 1.15, 15 / Math.sqrt(n)));

    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    function nearestNode(cx: number, cy: number, maxDist: number, t: number): number | null {
      let best: number | null = null;
      let bestD = maxDist * maxDist;
      nodesRef.current.forEach((node, i) => {
        const p = px(node, t);
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    }

    function onPointerMove(e: PointerEvent) {
      if (!canHover) return;
      const rect = canvas!.getBoundingClientRect();
      const idx = nearestNode(e.clientX - rect.left, e.clientY - rect.top, 26, performance.now() - t0Ref.current);
      hoveredRef.current = idx;
      canvas!.classList.toggle("hoverable", idx !== null);
    }
    function onPointerDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const idx = nearestNode(e.clientX - rect.left, e.clientY - rect.top, 46, performance.now() - t0Ref.current);
      if (idx !== null) {
        selIndexRef.current = idx;
        onOpenFact(nodesRef.current[idx].fact);
      }
    }
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);

    let visible = !document.hidden;
    function onVisChange() {
      visible = !document.hidden;
      if (visible) t0Ref.current = performance.now() - (performance.now() - t0Ref.current);
    }
    document.addEventListener("visibilitychange", onVisChange);

    t0Ref.current = performance.now();

    function litSet(idx: number | null): Set<number> {
      const s = new Set<number>();
      if (idx === null) return s;
      s.add(idx);
      for (const l of nodesRef.current[idx].linked) s.add(l);
      return s;
    }

    function draw(now: number) {
      const t = now - t0Ref.current;
      const { w, h } = geomRef.current;
      ctx.clearRect(0, 0, w, h);

      const hotIndex = hoveredRef.current ?? selIndexRef.current;
      const lit = litSet(hotIndex);
      const anyLit = lit.size > 0;
      const intro = Math.min(1, t / 900);

      // (1) links
      ctx.lineCap = "round";
      nodesRef.current.forEach((node, i) => {
        const p1 = px(node, t);
        node.linked.forEach((j) => {
          if (j < i) return; // draw each pair once
          const other = nodesRef.current[j];
          const p2 = px(other, t);
          const stagger = Math.max(0, Math.min(1, (t - i * 6) / 500));
          const litLine = lit.has(i) && lit.has(j);
          const alpha = (litLine ? 0.95 : anyLit ? 0.1 : 0.32) * intro * stagger;
          const toneA = node.fact.colour === "gold" ? "232,163,61" : "116,138,161";
          const toneB = other.fact.colour === "gold" ? "232,163,61" : "116,138,161";
          const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          grad.addColorStop(0, `rgba(${toneA},${alpha})`);
          grad.addColorStop(1, `rgba(${toneB},${alpha})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.max(0.4, baseR * 0.16);
          const midX = (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.07;
          const midY = (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.07;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
          ctx.stroke();
        });
      });

      // (2) node halos + cores, additive
      ctx.globalCompositeOperation = "lighter";
      const sprites = spritesRef.current;
      nodesRef.current.forEach((node, i) => {
        const p = px(node, t);
        const stagger = Math.max(0, Math.min(1, (t - i * 6) / 500));
        const isHot = hoveredRef.current === i || selIndexRef.current === i;
        const recede = anyLit ? (lit.has(i) ? 1 : 0.22) : 1;
        const dim = 0.72 + node.depth * 0.34;
        const r = baseR * node.depth * 1.15 * (isHot ? 1.4 : 1);
        const boost = isHot ? 1.9 : 1;
        const sprite = node.fact.colour === "gold" ? sprites?.gold : sprites?.grey;
        if (sprite) {
          const hr = r * 7 * boost;
          ctx.globalAlpha = dim * stagger * intro * recede;
          ctx.drawImage(sprite, p.x - hr, p.y - hr, hr * 2, hr * 2);
        }
        ctx.globalAlpha = 0.95 * dim * stagger * intro * recede;
        ctx.fillStyle = node.fact.colour === "gold" ? "rgba(255,224,170,1)" : "rgba(188,201,214,1)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.8, r), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // (4) cluster labels
      ctx.font = "9.5px var(--mono, monospace)";
      ctx.fillStyle = "rgba(151,170,188,0.62)";
      const k = domains.length;
      domains.forEach((d, i) => {
        const R = k <= 2 ? 17 : 34;
        const a = (i / k) * 2 * Math.PI - Math.PI / 2;
        const cx = 60 + Math.cos(a) * R;
        const cy = 60 + Math.sin(a) * R * 0.94;
        const m = d.facts.length;
        const maxSpr = k < 3 ? 18 : Math.min(19, R * Math.sin(Math.PI / k) * 0.9);
        const spread = Math.min(maxSpr, 3.4 + Math.sqrt(m) * 2.6);
        const lx = cx + Math.cos(a) * (spread + 7);
        const ly = cy + Math.sin(a) * (spread + 7) + 1.2;
        const { s, sy, ox, oy } = geomRef.current;
        ctx.textAlign = Math.cos(a) > 0.4 ? "left" : Math.cos(a) < -0.4 ? "right" : "center";
        ctx.fillText(d.heading, ox + lx * s, oy + ly * sy);
      });

      // (5) hover tooltip
      const hoverIdx = hoveredRef.current;
      if (hoverIdx !== null) {
        const node = nodesRef.current[hoverIdx];
        const p = px(node, t);
        const label = node.fact.text;
        ctx.font = "12px var(--sans, sans-serif)";
        const tw = ctx.measureText(label).width;
        const flip = p.x + 16 + tw + 16 > geomRef.current.w;
        const bx = flip ? p.x - 16 - tw - 16 : p.x + 16;
        const by = Math.max(16, Math.min(geomRef.current.h - 12, p.y - 10));
        ctx.fillStyle = "rgba(9,12,16,0.88)";
        const rr = 8;
        const bw = tw + 16;
        const bh = 24;
        ctx.beginPath();
        ctx.moveTo(bx + rr, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
        ctx.arcTo(bx, by + bh, bx, by, rr);
        ctx.arcTo(bx, by, bx + bw, by, rr);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#eef2f6";
        ctx.fillText(label, bx + 8, by + 16);
      }

      if (!reducedMotion && visible) rafRef.current = requestAnimationFrame(draw);
    }

    if (reducedMotion) {
      draw(t0Ref.current);
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }

    // Redraw once on selection/hover changes even under reduced motion (no rAF loop there).
    const redraw = () => {
      if (reducedMotion) draw(t0Ref.current);
    };
    canvas.addEventListener("pointermove", redraw);
    canvas.addEventListener("pointerdown", redraw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", redraw);
      canvas.removeEventListener("pointerdown", redraw);
      document.removeEventListener("visibilitychange", onVisChange);
    };
    // Interaction state stays in refs so tapping a star can update the hot node without tearing down
    // the draw loop. `px` is render math over refs plus reducedMotion, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains, reducedMotion, onOpenFact]);

  function chooseNode(i: number) {
    selIndexRef.current = i;
    hoveredRef.current = i;
    onOpenFact(nodes[i].fact);
  }

  return (
    <div className="sky" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="vig" aria-hidden="true" />
      <div className="legend" aria-hidden="true">
        <span>
          <span className="dot" /> {P18}
        </span>
        <span className="c">
          <span className="dot" /> {P19}
        </span>
      </div>
      <ul className="skylist" aria-label={P29}>
        {nodes.map((node, i) => {
          const positioned = geom.w > 0 && geom.h > 0;
          const style = positioned
            ? { left: `${geom.ox + node.nx * geom.s}px`, top: `${geom.oy + node.ny * geom.sy}px` }
            : { left: `${node.nx}%`, top: `${node.ny}%` };
          return (
            <li key={node.fact.id} style={style}>
              <button
                type="button"
                className={`star ${node.fact.colour}${selected?.id === node.fact.id ? " active" : ""}`}
                aria-label={`${node.fact.text} — ${node.fact.colour === "gold" ? P21 : P22}`}
                onFocus={() => chooseNode(i)}
                onPointerEnter={() => {
                  hoveredRef.current = i;
                }}
                onPointerLeave={() => {
                  if (hoveredRef.current === i) hoveredRef.current = null;
                }}
                onClick={() => chooseNode(i)}
              />
            </li>
          );
        })}
      </ul>
      <div className={`sheet ${selected ? "in sheetin" : "hint"}`}>
        {selected ? <DetailBody fact={selected} /> : <p>{P20}</p>}
      </div>
    </div>
  );
}
