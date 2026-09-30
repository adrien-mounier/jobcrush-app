"use client";

// #20 the profile screen (Sorted + Constellation) — under the colour law: gold = on the rendered CV
// right now, grey = saved in reserve. One derivation, rendered by both views, never re-derived here
// (design-20-profile-screen.md §3). No "what you lack" list exists anywhere on this screen: the
// payload carries no negative facts, and the UI must not invent one from an empty domain.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../deck.css";
import "../profile.css";
import { FactBadge } from "../factbadge";
import { PasteDoor } from "../pastedoor";
import { useReducedMotion } from "../jobcard";
import {
  answerDiscovery,
  answerDiscoveryMulti,
  ensureSession,
  getCards,
  getIntent,
  getProfile,
  saveContact,
  saveIntent,
  saveTargetTitles,
  type IntentState,
} from "../../lib/api";
import { areaSuggestions, matchAreaText } from "../../lib/areaMatch";
import {
  type ProfileContact,
  type ProfileDomain,
  type ProfileFact,
  type ProfileLanguagesQuestion,
  type ProfileLocation,
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
// #278 the work-history door. The dated job records behind these blocks are what the years totals
// (#162/#222), the job family and the change-of-direction sentence (#229/#256) are worked out from,
// and the check that corrects them lost its only entrance when the draft screen went (#272). It
// lives here because this is already the screen that shows what was read from the CV with a door
// beside it (#190/#194), and it is PASSIVE — always offered, never a nudge: nothing on this payload
// says which record looks doubtful, and inventing a doubt would be a "what you lack" list by
// another name (the one thing this screen may never grow).
const P30 = "Check your work history";

// #186 the list, style B — the two kept-caption wordings (design-186-188.md §A5). The list-run
// caption never carries a trailing period; the detail caption does (feeding straight into the bold
// told/read line beside it, matching P23's own shape).
const CAP_EXP_RUN = "Left out for space — it swaps in when a job needs it";
const CAP_OTHER_RUN = "Kept for when a job needs it";
const CAP_EXP_DETAIL = "Left out for space — it swaps in when a job needs it. ";
function keptRunCaption(tag: string): string {
  return tag === "experience" ? CAP_EXP_RUN : CAP_OTHER_RUN;
}
function keptDetailCaption(tag: string): string {
  return tag === "experience" ? CAP_EXP_DETAIL : P23;
}

// #186 A8 — the languages door. Review round 2 (must-fix): question/consequence/options render from
// `profile.languagesQuestion` verbatim — never a locally re-declared copy. Unlike the Job family
// panel's Q1 text (fixed, never varies), the languages question's `answer` is per-visitor state that
// lives in the eligibility store, not in CV-mined claim text — the two are different provenances
// (a claim like "Fluent in English and Mandarin." matches no option), so only the payload's own
// field can pre-tick this door correctly.
const LANG_DOOR = "Change your languages";
const LANG_UNANSWERED = "You haven't answered this yet.";
const LANG_SAVING = "Saving…";
const LANG_SAVED = "Your languages are updated.";

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
// #188 the rail's Location section (design-186-188.md PART B). Pin path from
// prototypes/profile-desktop.prototype.html's PIC.pin.
const ICON_PIN = (
  <svg className="pic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
    <path d="M7 12.6C9.7 9.7 11.4 7.5 11.4 5.4a4.4 4.4 0 1 0-8.8 0c0 2.1 1.7 4.3 4.4 7.2z" />
    <circle cx="7" cy="5.4" r="1.5" />
  </svg>
);
const LOC_TITLE = "Location";
const LOC_SUB = "Where you're searching.";
const LOC_ASK = "Where should JobCrush look?";
const LOC_HELPER = "Tell us the area you want to search — it can be different from where you live.";
const LOC_CONFIRM = "Search this";
const WR_TOLD_TAIL = " I haven't asked you about this place yet.";
const WR_CHANGE = "Change this answer";
const WR_ASK = "Answer it now";
const WR_KEEP = "Keep my answer";

// #194 the rail's Contact section. Same 14×14/stroke-1.3/currentColor idiom as ICON_PIN/ICON_BRIEFCASE.
const ICON_ENVELOPE = (
  <svg className="pic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
    <rect x="1.5" y="3" width="11" height="8" rx="1.3" />
    <path d="M2 4l5 3.6L12 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CT_TITLE = "Contact";
const CT_SUB = "What's on your CV.";

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

function chipText(text: string): string {
  return text.replace(/\.$/, "");
}

function sourceLine(source: ProfileFact["source"]): string {
  return source === "told" ? P24 : P25;
}

// The shared detail block (§4/A7) — the same lines whether painted into the Sorted dialog or the
// Constellation sheet. `tag` is the owning domain's tag, passed down alongside the fact (never
// re-derived from the fact's text) — it picks the kept caption's wording and, via `fact.job`,
// whether the job context line (`.dctx`, A7 new) draws at all.
function DetailBody({ fact, tag }: { fact: ProfileFact; tag: string }) {
  const on = fact.colour === "gold";
  return (
    <>
      <p className={`cl ${on ? "on" : "wait"}`}>
        <i aria-hidden="true" />
        {on ? P21 : P22}
      </p>
      {fact.job !== null && <p className="dctx">{fact.job}</p>}
      <p className="txt">{fact.text}</p>
      <p className="src">
        {!on && keptDetailCaption(tag)}
        <b>{sourceLine(fact.source)}</b>
      </p>
    </>
  );
}

// #186 A2 — a sentence fact as a full row (profile / experience / edu domains). A real <button>,
// never a <p tabindex=0>.
function FactRow({
  fact,
  tag,
  onOpenFact,
}: {
  fact: ProfileFact;
  tag: string;
  onOpenFact: (fact: ProfileFact, tag: string) => void;
}) {
  return (
    <button
      type="button"
      className={`frow ${fact.colour}`}
      aria-label={`${fact.text} — ${fact.colour === "gold" ? P21 : P22}`}
      onClick={() => onOpenFact(fact, tag)}
    >
      <i className="fdot" aria-hidden="true" />
      <span className="ftxt">{fact.text}</span>
    </button>
  );
}

// #186 A4 — a word fact as a compact chip (skill / cert / lang domains). Opens the same detail as a
// row, via the same onOpenFact handler — no second mechanism.
// #193 B3 — a language answer synthesised server-side (`answerOnly: true`, the API's own pinned
// field — never derived client-side from `id` shape) carries no CV-mined detail behind it: it
// renders as the same kept-coloured chip but inert (no click, no detail sheet) rather than opening
// an empty/misleading DetailBody.
function ChipButton({
  fact,
  tag,
  onOpenFact,
}: {
  fact: ProfileFact;
  tag: string;
  onOpenFact: (fact: ProfileFact, tag: string) => void;
}) {
  if (fact.answerOnly) {
    return <span className={`fact ${fact.colour} inert`}>{chipText(fact.text)}</span>;
  }
  return (
    <button
      type="button"
      className={`fact ${fact.colour}`}
      aria-label={`${fact.text} — ${fact.colour === "gold" ? P21 : P22}`}
      onClick={() => onOpenFact(fact, tag)}
    >
      {chipText(fact.text)}
    </button>
  );
}

// #186 A4 — gold chips, then the kept caption (only if ≥1 grey), then grey chips. Two separate
// `.facts` runs, never one combined list, so an all-gold or all-kept section draws only the run it
// has (A9).
function ChipGroup({
  domain,
  onOpenFact,
}: {
  domain: ProfileDomain;
  onOpenFact: (fact: ProfileFact, tag: string) => void;
}) {
  const gold = domain.facts.filter((f) => f.colour === "gold");
  const grey = domain.facts.filter((f) => f.colour === "grey");
  return (
    <>
      {gold.length > 0 && (
        <div className="facts">
          {gold.map((f) => (
            <ChipButton key={f.id} fact={f} tag={domain.tag} onOpenFact={onOpenFact} />
          ))}
        </div>
      )}
      {grey.length > 0 && <p className="krun">{keptRunCaption(domain.tag)}</p>}
      {grey.length > 0 && (
        <div className="facts">
          {grey.map((f) => (
            <ChipButton key={f.id} fact={f} tag={domain.tag} onOpenFact={onOpenFact} />
          ))}
        </div>
      )}
    </>
  );
}

// #186 A3 — Professional Experience's job blocks. Block order = first appearance of each `job`
// value in payload order; `job === null` facts form one leading, unheaded block. Inside a block:
// gold rows (payload order), the kept caption (if ≥1 grey), then grey rows (payload order) — the
// only reordering this screen permits, and it never pools across blocks.
// #187 A4 — one derivation of Professional Experience's job blocks, shared by the list
// (ExperienceBody) and the constellation (buildSky). Block order = first appearance of each `job`
// value in payload order; `job === null` facts form one leading, unheaded block.
function jobBlocks(domain: ProfileDomain): Array<{ job: string | null; facts: ProfileFact[] }> {
  const nullFacts = domain.facts.filter((f) => f.job === null);
  const namedFacts = domain.facts.filter((f) => f.job !== null);
  const jobOrder: string[] = [];
  for (const f of namedFacts) {
    if (f.job !== null && !jobOrder.includes(f.job)) jobOrder.push(f.job);
  }
  const blocks: Array<{ job: string | null; facts: ProfileFact[] }> = [];
  if (nullFacts.length > 0) blocks.push({ job: null, facts: nullFacts });
  for (const job of jobOrder) blocks.push({ job, facts: namedFacts.filter((f) => f.job === job) });
  return blocks;
}

// #278 the door itself. A real link rather than a button: it navigates, and a person expects to be
// able to open it in a new tab or come back to it.
function WorkHistoryDoor() {
  return (
    <Link className="rdoor" href="/job-blocks">
      {P30}
    </Link>
  );
}

function ExperienceBody({
  domain,
  onOpenFact,
}: {
  domain: ProfileDomain;
  onOpenFact: (fact: ProfileFact, tag: string) => void;
}) {
  const blocks = jobBlocks(domain);

  return (
    <>
      {blocks.map((block, i) => {
        const gold = block.facts.filter((f) => f.colour === "gold");
        const grey = block.facts.filter((f) => f.colour === "grey");
        return (
          <div className="jblk" id={`job-${i}`} key={block.job ?? "__none__"}>
            {block.job !== null && <h3 className="jhead">{block.job}</h3>}
            {gold.map((f) => (
              <FactRow key={f.id} fact={f} tag="experience" onOpenFact={onOpenFact} />
            ))}
            {grey.length > 0 && <p className="krun">{CAP_EXP_RUN}</p>}
            {grey.map((f) => (
              <FactRow key={f.id} fact={f} tag="experience" onOpenFact={onOpenFact} />
            ))}
          </div>
        );
      })}
      <WorkHistoryDoor />
    </>
  );
}

// #186 A8 — the one place languages are edited. A minimal door: no fetch on open (the question
// itself rides on every /api/profile response). Review round 2 (must-fix): pre-ticks EXCLUSIVELY
// from `languagesQuestion.answer` — the eligibility store's own current set — never from the
// Languages domain's chip text, which is CV-mined claim text, a different provenance that can name a
// language the store was never asked about (or miss one it was). Saves via the existing multi-select
// answer route using the payload's own `questionId`, then re-fetches the whole profile — the same
// one-mechanism door pattern as ContactField/JobFamilyPanel above, R11/R12 reused verbatim from there.
function LanguageDoor({
  languagesQuestion,
  onProfileRefreshed,
  onAnnounce,
}: {
  languagesQuestion: ProfileLanguagesQuestion;
  onProfileRefreshed: (profile: ProfileState) => void;
  onAnnounce: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [langToAdd, setLangToAdd] = useState(""); // #165: the open-list door's own input
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doorRef = useRef<HTMLButtonElement>(null);
  const firstCheckRef = useRef<HTMLInputElement>(null);
  const restoreDoorFocusRef = useRef(false);

  useEffect(() => {
    if (asking) {
      firstCheckRef.current?.focus();
    } else if (restoreDoorFocusRef.current) {
      restoreDoorFocusRef.current = false;
      doorRef.current?.focus();
    }
  }, [asking]);

  function openDoor() {
    setTicked(new Set(languagesQuestion.answer ?? []));
    setLangToAdd("");
    setError(null);
    setAsking(true);
  }

  function closeDoor() {
    restoreDoorFocusRef.current = true;
    setAsking(false);
    setError(null);
  }

  function toggle(name: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // #165: a typed language joins the list already ticked, in the person's own spelling — the server
  // keys the stored fact on the words they used, so "french" must not become a second row beside an
  // existing "French".
  function addLanguage() {
    const word = langToAdd.trim();
    if (!word) return;
    setTicked((prev) =>
      [...prev].some((n) => n.toLowerCase() === word.toLowerCase()) ? prev : new Set([...prev, word]),
    );
    setLangToAdd("");
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await answerDiscoveryMulti(languagesQuestion.questionId, Array.from(ticked));
    } catch {
      setSaving(false);
      setError(R12);
      return;
    }
    // The save succeeded — a refetch failure past this point is never reported as a save failure
    // (the #183 rule, applied here from the start).
    try {
      const fresh = await getProfile();
      onProfileRefreshed(fresh);
    } catch {
      // Best effort only; the next full load will pick up the fresh languages.
    }
    onAnnounce(LANG_SAVED);
    setSaving(false);
    restoreDoorFocusRef.current = true;
    setAsking(false);
  }

  if (!asking) {
    return (
      <button type="button" ref={doorRef} className="rdoor" onClick={openDoor}>
        {LANG_DOOR}
      </button>
    );
  }

  // Whether there's an existing answer to keep — the eligibility store's own signal, not whether
  // the Languages *domain* happens to have chips (CV-mined claim text can exist with no eligibility
  // answer behind it yet, exactly the bug this fix closes) — so "Not now" is genuinely reachable.
  const hasAnswer = languagesQuestion.answer !== null;
  // #186 §A8/discovery precedent: the options array carries N language names then the decline
  // string last (contract-pinned order) — this door renders the tickable languages, matching the
  // same slice the discovery screen's own multi-select uses for the identical list.
  //
  // #165: the options are COMPLETIONS now, not the closed answer set, so a language the person
  // volunteered ("French") lives in `answer` and in no option. Rendering the options alone would
  // hide it here and then DELETE it on save — the door would quietly retract a fact the person
  // stated. The list is therefore the options plus anything already answered that isn't among them.
  const suggested = languagesQuestion.options.slice(0, -1);
  const languages = [
    ...suggested,
    ...(languagesQuestion.answer ?? []).filter((a) => !suggested.some((s) => s.toLowerCase() === a.toLowerCase())),
    ...[...ticked].filter(
      (t) =>
        !suggested.some((s) => s.toLowerCase() === t.toLowerCase()) &&
        !(languagesQuestion.answer ?? []).some((a) => a.toLowerCase() === t.toLowerCase()),
    ),
  ];

  return (
    <div
      className="rq"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          // QA fix (same as ContactField/JobFamilyPanel): consume Escape here so the phone sheet's
          // page-level handler never also collapses the sheet out from under this door.
          e.stopPropagation();
          closeDoor();
        }
      }}
    >
      <p className="rqq" id="lang-q">
        {languagesQuestion.question}
      </p>
      {languagesQuestion.consequence && <p className="rconseq">{languagesQuestion.consequence}</p>}
      {!hasAnswer && <p className="rmute">{LANG_UNANSWERED}</p>}
      <div className="rchecks" role="group" aria-labelledby="lang-q">
        {languages.map((name, i) => (
          <label className="rcheck" key={name}>
            <input
              type="checkbox"
              ref={i === 0 ? firstCheckRef : undefined}
              checked={ticked.has(name)}
              disabled={saving}
              onChange={() => toggle(name)}
            />
            {name}
          </label>
        ))}
      </div>
      {/* #165: the list is open, so this door needs a way IN for a language no suggestion offers —
          without it, a French speaker can only ever remove languages here, never add one. */}
      <div className="rbtns">
        <input
          type="text"
          aria-label="Add another language"
          placeholder="Add another language"
          value={langToAdd}
          disabled={saving}
          onChange={(e) => setLangToAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            addLanguage();
          }}
        />
        <button type="button" className="rbtn" disabled={saving || langToAdd.trim().length === 0} onClick={addLanguage}>
          Add
        </button>
      </div>
      <div className="rbtns">
        <button type="button" className="rbtn" disabled={saving} onClick={save}>
          Save
        </button>
        <button type="button" className="rbtn" disabled={saving} onClick={closeDoor}>
          {hasAnswer ? "Keep what I have" : "Not now"}
        </button>
      </div>
      {saving && <p className="rbusy">{LANG_SAVING}</p>}
      {error && (
        <p className="rerr" role="alert">
          {error}
        </p>
      )}
      {!saving && !error && <p className="rnote">{R11}</p>}
    </div>
  );
}

// #186 the domain section shell — .dom/.dhead/.dname/.dcount/.aura reused exactly as shipped, per
// domain, in payload order. Body varies by tag: experience gets job blocks (A3), skill/cert/lang get
// chips (A4, lang also gets the languages door), everything else (edu) gets flat sentence rows in
// store order — the "Still List Rule": no reordering except the gold-then-grey split A3/A4 name.
function DomainSection({
  domain,
  index,
  biggest,
  reducedMotion,
  onOpenFact,
  languagesQuestion,
  onProfileRefreshed,
  onAnnounce,
}: {
  domain: ProfileDomain;
  index: number;
  biggest: number;
  reducedMotion: boolean;
  onOpenFact: (fact: ProfileFact, tag: string) => void;
  languagesQuestion: ProfileLanguagesQuestion;
  onProfileRefreshed: (profile: ProfileState) => void;
  onAnnounce: (message: string) => void;
}) {
  const gold = domain.facts.filter((f) => f.colour === "gold").length;
  const a = (0.035 + 0.075 * (domain.facts.length / biggest)).toFixed(3);
  const isChips = domain.tag === "skill" || domain.tag === "cert" || domain.tag === "lang";
  return (
    <section className="dom" style={reducedMotion ? undefined : { animationDelay: `${Math.min(index * 55, 330)}ms` }}>
      <span className="aura" style={{ ["--a" as string]: a }} aria-hidden="true" />
      <div className="dhead">
        <h2 className="dname">{domain.heading}</h2>
        <span className="dcount">
          {domain.facts.length}
          <span className="sr-only"> {domain.facts.length === 1 ? "fact" : "facts"}</span>
          {gold > 0 && <span className="dgold"> · {gold} on your CV</span>}
        </span>
      </div>
      {domain.tag === "experience" ? (
        <ExperienceBody domain={domain} onOpenFact={onOpenFact} />
      ) : isChips ? (
        <>
          <ChipGroup domain={domain} onOpenFact={onOpenFact} />
          {domain.tag === "lang" && (
            <LanguageDoor languagesQuestion={languagesQuestion} onProfileRefreshed={onProfileRefreshed} onAnnounce={onAnnounce} />
          )}
        </>
      ) : (
        domain.facts.map((f) => <FactRow key={f.id} fact={f} tag={domain.tag} onOpenFact={onOpenFact} />)
      )}
    </section>
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
  const restoreDoorFocusRef = useRef(false);
  const inputId = `contact-${field}-again`;

  // #320: focus returns to the door from the effect, not a raw rAF — the door only renders again
  // once React has committed the close, and a starved machine can run the frame before that commit,
  // leaving the ref null and the focus lost. Same shape the languages door already uses.
  useEffect(() => {
    if (asking) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreDoorFocusRef.current) {
      restoreDoorFocusRef.current = false;
      doorRef.current?.focus();
    }
  }, [asking]);

  function openDoor() {
    setValue(data?.value ?? "");
    setError(null);
    setAsking(true);
  }

  function closeDoor() {
    restoreDoorFocusRef.current = true;
    setAsking(false);
    setError(null);
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
    restoreDoorFocusRef.current = true;
    setAsking(false);
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

// #190/#186 the About you section — the payload's own no-job "About you" domain group (arrives
// first, tag "profile"), rendered as plain rows under one heading. #194 moves the two contact fields
// out to their own rail panel (ContactPanel, below) — this group keeps only its OTHER facts now, and
// the caller only mounts this component when there's something left to show (never an empty box).
function AboutYou({
  domain,
  onOpenFact,
}: {
  domain: ProfileDomain;
  onOpenFact: (fact: ProfileFact, tag: string) => void;
}) {
  return (
    <section className="dom">
      <div className="dhead">
        <h2 className="dname">{CX_HEADING}</h2>
        <span className="dcount">
          {domain.facts.length}
          <span className="sr-only"> {domain.facts.length === 1 ? "fact" : "facts"}</span>
        </span>
      </div>
      {domain.facts.map((f) => (
        <FactRow key={f.id} fact={f} tag="profile" onOpenFact={onOpenFact} />
      ))}
    </section>
  );
}

// #194 the rail's Contact section — #190's phone/email fields, re-homed unchanged (ContactField
// itself is not touched: same door, same saveContact/getProfile flow, same .cxfield/.src markup —
// "move, don't rebuild"). Follows Location/Job family's own idiom for the panel shell only
// (.rpanel + a marker class, .rtitle + icon, .rsub). Always renders: each field already carries its
// own honest "Not on your CV" state (#190), so there is no "no contact at all" case that needs a
// second, section-level empty state — the two rows already are that state when both are absent.
function ContactPanel({
  contact,
  onUpdated,
  onAnnounce,
}: {
  contact: ProfileContact;
  onUpdated: (contact: ProfileContact) => void;
  onAnnounce: (message: string) => void;
}) {
  return (
    <section className="rpanel rcontact">
      <h2 className="rtitle">
        {ICON_ENVELOPE}
        {CT_TITLE}
      </h2>
      <p className="rsub">{CT_SUB}</p>
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

// #184 (#172): the coverage list rendered in the early-access line — re-declared locally (not
// imported) per the #183 precedent for shared strings/rules, comment citing the source: app/page.tsx
// carries the canonical copy. The list itself always comes from the server response — never a second
// hard-coded country list; only this joining rule lives here too.
function joinCoverage(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// #188 the rail's Location section (design-186-188.md PART B). The rail is never an editor: every
// control opens a re-asked original question, exactly the Job family panel's own door pattern below.
// Two independent doors — search area (reuses #184's validation + coverage copy, never a second
// implementation) and work rights (market-keyed). Neither door holds local memory of a stale
// answer: every render reads `location` straight off the prop, refreshed via onProfileRefreshed —
// the same "re-fetch, never patch in place" rule #186's language door already follows.
function LocationPanel({
  location,
  onProfileRefreshed,
  onAnnounce,
}: {
  location: ProfileLocation;
  onProfileRefreshed: (profile: ProfileState) => void;
  onAnnounce: (message: string) => void;
}) {
  // --- the target-locations door (#214: up to 3 chips, the front door's own widget) ---
  const [areaAsking, setAreaAsking] = useState(false);
  const [areaChips, setAreaChips] = useState<Array<{ text: string; label: string }>>([]);
  const [areaQuery, setAreaQuery] = useState("");
  const [refusedArea, setRefusedArea] = useState<string | null>(null);
  // The completion vocabulary + coverage list are the server's own (the intent response carries
  // both) — fetched when the door opens, never a hard-coded copy.
  const [vocabulary, setVocabulary] = useState<IntentState["areaVocabulary"]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [areaSaving, setAreaSaving] = useState(false);
  const [areaSaveError, setAreaSaveError] = useState(false);
  // Fetching/failed persist past the door closing (B2: the area zone is one of line | door |
  // fetching | fetch-failed) so they're their own state, not folded into `areaAsking`.
  const [fetchingMarket, setFetchingMarket] = useState<string | null>(null);
  const [fetchFailedMarket, setFetchFailedMarket] = useState<string | null>(null);
  // Shared across every state the area zone's trailing button can be in (Change / the no-area
  // prompt / Try again) — only one ever renders at a time, so one ref suffices, and focus always
  // returns to "whichever door-like button is now on screen" (B6).
  const areaDoorRef = useRef<HTMLButtonElement>(null);
  const areaInputRef = useRef<HTMLInputElement>(null);
  const restoreAreaDoorFocusRef = useRef(false);
  const atCap = areaChips.length >= 3;

  // #320: the door's focus-return runs from the effect, never a raw rAF (see ContactField).
  useEffect(() => {
    if (areaAsking) {
      areaInputRef.current?.focus();
    } else if (restoreAreaDoorFocusRef.current && !fetchingMarket) {
      restoreAreaDoorFocusRef.current = false;
      areaDoorRef.current?.focus();
    }
  }, [areaAsking, fetchingMarket]);

  function openAreaDoor() {
    setAreaChips(location.areas.map((area) => ({ text: area.text, label: area.label })));
    setAreaQuery("");
    setRefusedArea(null);
    setAreaSaveError(false);
    setAreaAsking(true);
    void getIntent()
      .then((state) => {
        setVocabulary(state.areaVocabulary);
        setCoverage(state.coverage);
      })
      .catch(() => {
        // Suggestions stay empty; the save path still works — the server resolves on save.
      });
  }
  function closeAreaDoor() {
    restoreAreaDoorFocusRef.current = true;
    setAreaAsking(false);
    setRefusedArea(null);
    setAreaSaveError(false);
  }

  // The shared matcher (lib/areaMatch.ts). Deliberate divergence from the front door, kept at the
  // call sites below: this door fetches the vocabulary lazily, so while it is still empty a typed
  // word is kept as-is and the server's save-time resolution decides.
  const resolveAreaText = (text: string) => matchAreaText(text, vocabulary);

  function addArea(text: string) {
    const trimmed = text.trim();
    if (!trimmed || atCap || areaSaving) return;
    const match = resolveAreaText(trimmed);
    if (!match && vocabulary.length > 0) {
      setRefusedArea(trimmed);
      return;
    }
    const label = match?.label ?? trimmed;
    if (!areaChips.some((chip) => chip.label === label)) {
      setAreaChips([...areaChips, { text: trimmed, label }]);
    }
    setAreaQuery("");
    setRefusedArea(null);
  }

  // #185 decision 5: the profile refresh + the deck-warming request together ARE the honest end
  // signal for a market switch — no unbounded spinner anywhere in this flow. `getCards()` is what
  // actually drives the new market's pull, and it alone is what the fetching line waits on;
  // `getProfile()` runs alongside it only to bring the rest of the payload current.
  async function runFetch(market: string) {
    // Armed up front for the same reason the doors arm before their state change: the effect that
    // reads it only runs once the fetch line is gone and a door is on screen again.
    restoreAreaDoorFocusRef.current = true;
    setFetchFailedMarket(null);
    setFetchingMarket(market);
    try {
      await getCards();
      setFetchingMarket(null);
    } catch {
      setFetchingMarket(null);
      setFetchFailedMarket(market);
    }
  }

  async function confirmArea() {
    if (areaSaving) return;
    // Text still in the input is one last chip-add — never silently dropped (the front door's rule).
    let chips = areaChips;
    if (areaQuery.trim()) {
      const match = resolveAreaText(areaQuery);
      if (!match && vocabulary.length > 0) {
        setRefusedArea(areaQuery.trim());
        requestAnimationFrame(() => areaInputRef.current?.focus());
        return;
      }
      const label = match?.label ?? areaQuery.trim();
      if (!atCap && !chips.some((chip) => chip.label === label)) {
        chips = [...chips, { text: areaQuery.trim(), label }];
      }
    }
    if (chips.length === 0) return;
    setAreaChips(chips);
    setAreaQuery("");
    setAreaSaving(true);
    setAreaSaveError(false);
    let accepted: IntentState;
    try {
      accepted = await saveIntent({ searchAreas: chips.map((chip) => chip.text) });
    } catch {
      setAreaSaving(false);
      setAreaSaveError(true);
      requestAnimationFrame(() => areaInputRef.current?.focus());
      return;
    }
    setAreaSaving(false);
    // The server is the gate: a refusal is an early-access coverage fact, never the person's
    // mistake — the door stays open, showing what DID store.
    setAreaChips(accepted.intent.searchAreas.map((entry) => ({ text: entry.text, label: entry.label })));
    if (accepted.refused.length > 0) {
      setRefusedArea(accepted.refused[0]!.text);
      setCoverage(accepted.refused[0]!.coverage);
      requestAnimationFrame(() => areaInputRef.current?.focus());
      return;
    }
    const places = joinCoverage(accepted.intent.searchAreas.map((entry) => entry.label));
    setAreaAsking(false);
    setRefusedArea(null);
    onAnnounce(`Now searching ${places}.`);
    void getProfile()
      .then(onProfileRefreshed)
      .catch(() => {
        // A refetch failure here is never reported as a save failure (the #183 rule) — the fetching
        // line's own success/failure below is the only honest signal this flow reports on.
      });
    await runFetch(places);
  }

  // --- the work-rights doors (#214: one row per covered market, each its own door) ---
  const [wrOpenMarket, setWrOpenMarket] = useState<string | null>(null);
  const [wrSaving, setWrSaving] = useState(false);
  const [wrError, setWrError] = useState(false);
  const wrDoorRef = useRef<HTMLButtonElement>(null);
  const wrFirstOptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (wrOpenMarket) wrFirstOptRef.current?.focus();
  }, [wrOpenMarket]);

  // A market list change never carries a door's open state across — an open question about a
  // removed market must not still be sitting open once the rail no longer lists it.
  const marketsKey = location.workRights.map((row) => row.market).join("|");
  const prevMarketsRef = useRef(marketsKey);
  useEffect(() => {
    if (marketsKey !== prevMarketsRef.current) {
      prevMarketsRef.current = marketsKey;
      setWrOpenMarket(null);
      setWrError(false);
    }
  }, [marketsKey]);

  function openWrDoor(market: string) {
    setWrError(false);
    setWrOpenMarket(market);
  }
  function closeWrDoor() {
    setWrOpenMarket(null);
    setWrError(false);
    requestAnimationFrame(() => wrDoorRef.current?.focus());
  }

  async function pickWorkRights(row: ProfileLocation["workRights"][number], option: string) {
    if (wrSaving) return;
    setWrSaving(true);
    setWrError(false);
    try {
      await answerDiscovery(row.questionId, option);
    } catch {
      setWrSaving(false);
      setWrError(true);
      return;
    }
    try {
      const fresh = await getProfile();
      onProfileRefreshed(fresh);
    } catch {
      // Best effort only; the next full load will pick up the fresh answer.
    }
    onAnnounce(`Work rights for ${row.market}: ${option}.`);
    setWrSaving(false);
    setWrOpenMarket(null);
    requestAnimationFrame(() => wrDoorRef.current?.focus());
  }

  return (
    <section className="rpanel rloc">
      <h2 className="rtitle">
        {ICON_PIN}
        {LOC_TITLE}
      </h2>
      <p className="rsub">{LOC_SUB}</p>

      {fetchingMarket ? (
        <p className="rfetch" role="status">{`Fetching ${fetchingMarket} jobs… nothing you've answered is re-asked.`}</p>
      ) : fetchFailedMarket ? (
        <div className="rline">
          <p className="rerr">{`Couldn't fetch ${fetchFailedMarket} jobs just now.`}</p>
          <button type="button" ref={areaDoorRef} className="rdoor" onClick={() => void runFetch(fetchFailedMarket)}>
            {P3}
          </button>
        </div>
      ) : areaAsking ? (
        <div
          className="rq rareas"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              // QA fix (same pattern as every other door on this screen): consume Escape here so
              // the phone sheet's page-level handler never also collapses the sheet from under it —
              // the rail sits outside the sheet, but a person can have the sheet open at the same
              // time as this door.
              e.stopPropagation();
              closeAreaDoor();
            }
          }}
        >
          <label className="rqq" htmlFor="loc-area-again">
            {LOC_ASK}
          </label>
          {areaChips.length > 0 && (
            <ul className="chips" aria-label="Places you've chosen">
              {areaChips.map((chip) => (
                <li key={chip.label}>
                  <span className="lbl">{chip.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    disabled={areaSaving}
                    onClick={() => {
                      setAreaChips(areaChips.filter((c) => c.label !== chip.label));
                      setRefusedArea(null);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            id="loc-area-again"
            className="rin"
            ref={areaInputRef}
            value={areaQuery}
            disabled={areaSaving || atCap}
            aria-describedby={["loc-area-helper", refusedArea ? "loc-area-coverage" : null].filter(Boolean).join(" ")}
            onChange={(e) => {
              setAreaQuery(e.target.value);
              setRefusedArea(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addArea(areaQuery);
              }
            }}
          />
          <p id="loc-area-helper" className="rnote">
            {atCap ? "Three places is the limit — remove one to add another." : LOC_HELPER}
          </p>
          {!atCap && areaSuggestions(areaQuery, vocabulary, areaChips.map((chip) => chip.label)).length > 0 && (
            <div className="sugg" role="status" aria-live="polite">
              {areaSuggestions(areaQuery, vocabulary, areaChips.map((chip) => chip.label)).map((v) => (
                <button key={v.label} type="button" disabled={areaSaving} onClick={() => addArea(v.label)}>
                  {v.label === v.market ? v.label : `${v.label} — ${v.market}`}
                </button>
              ))}
            </div>
          )}
          {refusedArea && (
            <p id="loc-area-coverage" className="rcover" role="status">
              {`JobCrush is in early access — we currently cover ${joinCoverage(coverage)}.`}
            </p>
          )}
          <div className="rbtns">
            <button
              type="button"
              className="rbtn"
              disabled={areaSaving || (areaChips.length === 0 && !areaQuery.trim())}
              onClick={() => void confirmArea()}
            >
              {LOC_CONFIRM}
            </button>
            <button type="button" className="rbtn" disabled={areaSaving} onClick={closeAreaDoor}>
              {location.areas.length > 0
                ? `Keep ${joinCoverage(location.areas.map((area) => area.label))}`
                : "Not now"}
            </button>
          </div>
          {areaSaving && <p className="rbusy">{CX_SAVING}</p>}
          {areaSaveError && (
            <p className="rerr" role="alert">
              {R12}
            </p>
          )}
          {!areaSaving && !areaSaveError && <p className="rnote">{R11}</p>}
        </div>
      ) : (
        <div className="rline">
          {location.areas.length > 0 ? (
            <ul className="chips rchips" aria-label="Places you're searching">
              {location.areas.map((area) => (
                <li key={area.label}>
                  <span className="lbl">{area.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rrole rmute">{R9}</p>
          )}
          <button type="button" ref={areaDoorRef} className="rdoor" onClick={openAreaDoor}>
            {location.areas.length > 0 ? "Change" : LOC_ASK}
          </button>
        </div>
      )}

      {/* B5: a work-rights row exists only per valid, covered market — an answer about nowhere has
          no meaning, and this screen never draws an empty box. #214: one row per selected market. */}
      {location.workRights.map((row) => (
        <div className="rrow" key={row.market}>
          <p className="rlabel">{`Work rights · ${row.market}`}</p>
          {wrOpenMarket === row.market ? (
            <div
              className="rq"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeWrDoor();
                }
              }}
            >
              <p className="rqq" id={`wr-q-${row.questionId}`}>
                {row.question}
              </p>
              <div className="rbtns" role="group" aria-labelledby={`wr-q-${row.questionId}`}>
                {row.options.map((opt, i) => {
                  const picked = opt === row.answer;
                  return (
                    <button
                      key={opt}
                      type="button"
                      ref={i === 0 ? wrFirstOptRef : undefined}
                      className={`rbtn${picked ? " picked" : ""}`}
                      aria-current={picked ? "true" : undefined}
                      disabled={wrSaving}
                      onClick={() => void pickWorkRights(row, opt)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <button type="button" ref={wrDoorRef} className="rdoor" disabled={wrSaving} onClick={closeWrDoor}>
                {row.answer !== null ? WR_KEEP : "Not now"}
              </button>
              {wrSaving && <p className="rbusy">{CX_SAVING}</p>}
              {wrError && (
                <p className="rerr" role="alert">
                  {R12}
                </p>
              )}
              {!wrSaving && !wrError && <p className="rnote">{R11}</p>}
            </div>
          ) : row.answer !== null ? (
            <>
              <p className="rrole">{row.answer}</p>
              <p className="src">{P24}</p>
              <button type="button" className="rdoor" onClick={() => openWrDoor(row.market)}>
                {WR_CHANGE}
              </button>
            </>
          ) : (
            <>
              <p className="rrole rmute">{`${row.question}${WR_TOLD_TAIL}`}</p>
              <button type="button" className="rdoor" onClick={() => openWrDoor(row.market)}>
                {WR_ASK}
              </button>
            </>
          )}
        </div>
      ))}
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
  const restoreDoorFocusRef = useRef(false);

  // #320: the door's focus-return runs from the effect, never a raw rAF (see ContactField).
  useEffect(() => {
    if (asking) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreDoorFocusRef.current) {
      restoreDoorFocusRef.current = false;
      doorRef.current?.focus();
    }
  }, [asking]);

  function openDoor() {
    setValue(search.role ?? "");
    setError(null);
    setAsking(true);
  }

  function closeDoor() {
    restoreDoorFocusRef.current = true;
    setAsking(false);
    setError(null);
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
    restoreDoorFocusRef.current = true;
    setAsking(false);
  }

  const hasSiblings = search.siblingTitles.length > 0;
  const hasRow = hasSiblings || search.openJobs !== null;
  const door = (
    <button type="button" ref={doorRef} className="rdoor" onClick={openDoor}>
      {search.role === null ? R6 : R5}
    </button>
  );

  return (
    // #188: `rjob` mirrors Location's own `rloc` marker — the rail now holds two `.rpanel` sections,
    // and each needs its own scoping hook for both CSS and e2e locators (`.rrole` etc. are shared
    // across both panels' shells).
    <section className="rpanel rjob">
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
  // #186: the fact plus the tag of the domain it came from — the detail block needs the tag to pick
  // the right kept-caption wording (A5) without re-deriving it from the fact's text.
  const [selected, setSelected] = useState<{ fact: ProfileFact; tag: string } | null>(null);

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

  // #186 A8 — the languages door replaces the whole payload after a save (languages can shift gold/
  // grey elsewhere too, e.g. via a re-tailor), the same "re-fetch, never patch in place" rule the
  // Job family/contact doors already follow.
  const handleProfileRefreshed = useCallback((next: ProfileState) => {
    setProfile(next);
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
    (fact: ProfileFact, tag: string) => {
      setSelected({ fact, tag });
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
          onProfileRefreshed={handleProfileRefreshed}
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
  onProfileRefreshed,
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
  selected: { fact: ProfileFact; tag: string } | null;
  onSwitchView: (v: View) => void;
  onOpenFact: (f: ProfileFact, tag: string) => void;
  onCloseDialog: () => void;
  onDialogClosed: () => void;
  onBack: () => void;
  onSearchUpdated: (search: ProfileSearch) => void;
  onContactUpdated: (contact: ProfileContact) => void;
  onProfileRefreshed: (profile: ProfileState) => void;
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

  // #186 A0/A1: Sorted renders the payload's own CV order (About you first); the client-side
  // size-sort is deleted from that path entirely — CV order is the law. Constellation keeps its
  // prior behaviour (its own size-sorted input), hence the two separate consts.
  const domainsCv = profile.domains;
  // Review round 2 (cheap hardening): looked up by tag, not assumed at index 0 — the contract says
  // the payload puts this group first, but a defensive lookup means a reordered/malformed payload
  // can never leave the "profile" domain also rendered as its own DomainSection below, which would
  // draw a second "About you" heading.
  const aboutDomain = domainsCv.find((d) => d.tag === "profile") ?? null;
  const restDomains = aboutDomain ? domainsCv.filter((d) => d.tag !== "profile") : domainsCv;
  const domainsBySize = useMemo(
    () => [...profile.domains].sort((a, b) => b.facts.length - a.facts.length),
    [profile.domains],
  );
  const biggest = domainsCv.reduce((m, d) => Math.max(m, d.facts.length), 1);

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
        {/* #303: the same top-bar slot on every signed-in screen — the topbar's far right. */}
        <PasteDoor />
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
                    {aboutDomain && aboutDomain.facts.length > 0 && (
                      <AboutYou domain={aboutDomain} onOpenFact={onOpenFact} />
                    )}
                    {restDomains.map((d, i) => (
                      <DomainSection
                        key={d.tag}
                        domain={d}
                        index={i}
                        biggest={biggest}
                        reducedMotion={reducedMotion}
                        onOpenFact={onOpenFact}
                        languagesQuestion={profile.languagesQuestion}
                        onProfileRefreshed={onProfileRefreshed}
                        onAnnounce={onAnnounce}
                      />
                    ))}
                    {/* #278 code review (Spec axis): the door lives inside Professional Experience,
                        beside the jobs it is about — but the API drops a section with no facts in it,
                        so a profile that has no experience CLAIMS would show no door at all. Her dated
                        job records are mined separately from her claims, so she can have records to
                        check and no section to hang the door on: exactly the person the ticket exists
                        for. It falls back to the end of the list rather than disappearing. */}
                    {!restDomains.some((d) => d.tag === "experience") && <WorkHistoryDoor />}
                    <p className="dnote">
                      {showP12
                        ? P12
                        : "The highlighted ones make your CV right now. The rest are kept for when a job needs them. Your CV is two pages, so it picks; nothing is ever dropped."}
                    </p>
                  </div>
                ) : (
                  <Constellation
                    domains={domainsBySize}
                    reducedMotion={reducedMotion}
                    selected={selected}
                    onOpenFact={onOpenFact}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="rail" aria-label={R1}>
          <LocationPanel location={profile.location} onProfileRefreshed={onProfileRefreshed} onAnnounce={onAnnounce} />
          <JobFamilyPanel search={profile.search} onSearchUpdated={onSearchUpdated} onAnnounce={onAnnounce} />
          <ContactPanel contact={profile.contact} onUpdated={onContactUpdated} onAnnounce={onAnnounce} />
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
            <DetailBody fact={selected.fact} tag={selected.tag} />
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
  tag: string; // #186: the owning domain's tag, threaded to onOpenFact for the detail's caption wording
  nx: number;
  ny: number;
  depth: number;
  ph: number;
  sp: number;
  linked: number[]; // indices into the flat node array — nearest already-placed sibling(s)
  clusterIdx: number | null; // #187 A6 — the owning "job" cluster (for label reveal); null elsewhere
}

// #187 A1/A5/A6 — one geometry source. `draw()` reads `clusters` for labels and never recomputes the
// section/sub-cluster math inline (that duplication was the live drift bug this ticket fixes).
interface SkyCluster {
  kind: "section" | "job";
  label: string; // domain.heading, or fact.job verbatim (#186: never parsed)
  cx: number;
  cy: number;
  spread: number;
  angle: number;
  parent: number | null; // index of the owning section cluster, for a "job" cluster
  nodeIdx: number[];
}

const FLOOR = 0.04; // #187 A3 — every drawn section keeps a visible foothold, however few its facts

function placeBlock(
  nodes: SkyNode[],
  clusters: SkyCluster[],
  facts: ProfileFact[],
  cx: number,
  cy: number,
  spread: number,
  tag: string,
  secIdx: number,
  clusterIdx: number | null,
) {
  const m = facts.length;
  const start = nodes.length;
  facts.forEach((fact, j) => {
    const r = spread * Math.sqrt((j + 0.6) / m);
    const theta = j * 2.399963;
    const nx = cx + Math.cos(theta) * r;
    const ny = cy + Math.sin(theta) * r;
    const flatIdx = nodes.length; // #187 A4 — flat index, not the per-block j, so drift stays varied
    const depth = 0.45 + (((flatIdx * 37 + secIdx * 71) % 100) / 100) * 0.55;
    const ph = flatIdx * 1.7 + secIdx;
    const sp = 0.7 + (((flatIdx * 53 + secIdx * 17) % 100) / 100) * 0.6;
    // ponytail: O(m²) nearest-sibling scan, confined to this block (#187 A4) — fine at m <= 200
    // (design-20-profile-screen.md §5); upgrade to a spatial grid if a block ever grows past that.
    let nearest = -1;
    let best = Infinity;
    for (let p = 0; p < j; p++) {
      const other = nodes[start + p];
      const dx = other.nx - nx;
      const dy = other.ny - ny;
      const dist = dx * dx + dy * dy;
      if (dist < best) {
        best = dist;
        nearest = start + p;
      }
    }
    const idx = nodes.length;
    const node: SkyNode = { fact, domainIndex: secIdx, tag, nx, ny, depth, ph, sp, linked: [], clusterIdx };
    if (nearest >= 0) {
      node.linked.push(nearest);
      nodes[nearest].linked.push(idx);
    }
    nodes.push(node);
    clusters[secIdx].nodeIdx.push(idx);
    if (clusterIdx !== null && clusterIdx !== secIdx) clusters[clusterIdx].nodeIdx.push(idx);
  });
}

function buildSky(domains: ProfileDomain[]): { nodes: SkyNode[]; clusters: SkyCluster[] } {
  const nodes: SkyNode[] = [];
  const clusters: SkyCluster[] = [];
  // #187 A2 — empty sections get no sky at all: no cluster, no wedge, no label, no shifted angle.
  const drawn = domains.filter((d) => d.facts.length > 0);
  const k = drawn.length;
  const W = drawn.reduce((s, d) => s + d.facts.length, 0) || 1;

  let cum = 0;
  drawn.forEach((d) => {
    const facts_i = d.facts.length;
    const raw = facts_i / W;
    // #187 A3 — share-driven wedge with the FLOOR so a 1-fact section still gets a visible foothold
    // and never collides with its neighbour (its own max spread shrinks with its share).
    const share = (raw + FLOOR) / (1 + k * FLOOR);
    const a = -Math.PI / 2 + 2 * Math.PI * (cum + share / 2);
    cum += share;
    const R = k <= 2 ? 17 : 34;
    const cx = 60 + Math.cos(a) * R;
    const cy = 60 + Math.sin(a) * R * 0.94;
    const maxSpr = k < 3 ? 18 : Math.min(19, R * Math.sin(Math.PI * share) * 0.9);
    const spread = Math.min(maxSpr, 3.4 + Math.sqrt(facts_i) * 2.6);

    const secIdx = clusters.length;
    clusters.push({ kind: "section", label: d.heading, cx, cy, spread, angle: a, parent: null, nodeIdx: [] });

    if (d.tag === "experience") {
      // #187 A4 — per-job sub-constellations, exactly ExperienceBody's block rule.
      const blocks = jobBlocks(d);
      const B = blocks.length;
      blocks.forEach((block, b) => {
        const m_b = block.facts.length;
        const subR = B === 1 ? 0 : spread * 0.52;
        const beta = a + Math.PI + ((b + 0.5) / B) * 2 * Math.PI; // +π: no sub-cluster under the section label
        const subCx = cx + Math.cos(beta) * subR;
        const subCy = cy + Math.sin(beta) * subR * 0.94;
        const subSpr = Math.min(spread * 0.42, 1.8 + Math.sqrt(m_b) * 1.5);

        let jobIdx: number | null = null;
        if (block.job !== null) {
          jobIdx = clusters.length;
          clusters.push({ kind: "job", label: block.job, cx: subCx, cy: subCy, spread: subSpr, angle: beta, parent: secIdx, nodeIdx: [] });
        }
        placeBlock(nodes, clusters, block.facts, subCx, subCy, subSpr, d.tag, secIdx, jobIdx);
      });
    } else {
      placeBlock(nodes, clusters, d.facts, cx, cy, spread, d.tag, secIdx, null);
    }
  });

  return { nodes, clusters };
}

function Constellation({
  domains,
  reducedMotion,
  selected,
  onOpenFact,
}: {
  domains: ProfileDomain[];
  reducedMotion: boolean;
  selected: { fact: ProfileFact; tag: string } | null;
  onOpenFact: (f: ProfileFact, tag: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<SkyNode[]>([]);
  const clustersRef = useRef<SkyCluster[]>([]);
  const labelCacheRef = useRef<Map<number, { s: number; text: string }>>(new Map());
  const spritesRef = useRef<{ gold: HTMLCanvasElement; grey: HTMLCanvasElement } | null>(null);
  const rafRef = useRef<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const selIndexRef = useRef<number | null>(null);
  const t0Ref = useRef(0);
  const geomRef = useRef({ s: 1, sy: 1, ox: 0, oy: 0, usable: 0, w: 0, h: 0 });
  const [geom, setGeom] = useState(() => geomRef.current);
  const sky = useMemo(() => buildSky(domains), [domains]);
  const nodes = sky.nodes;

  useEffect(() => {
    nodesRef.current = sky.nodes;
    clustersRef.current = sky.clusters;
    labelCacheRef.current = new Map();
    hoveredRef.current = null;
    selIndexRef.current = null;
  }, [sky]);

  // #187 A6 — closing the fact sheet clears the tap-driven reveal (selected comes from the parent).
  useEffect(() => {
    if (selected === null) selIndexRef.current = null;
  }, [selected]);

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
        onOpenFact(nodesRef.current[idx].fact, nodesRef.current[idx].tag);
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

      // (4) cluster labels — #187 A1/A5: geometry comes from `clusters`, the one geometry source;
      // draw() never recomputes it inline (the fix for the old live-drift bug).
      const { s, sy, ox, oy } = geomRef.current;
      const clustersNow = clustersRef.current;
      const hotClusterIdx = hotIndex !== null ? nodesRef.current[hotIndex]?.clusterIdx ?? null : null;
      // #187 A6 — every drawn star, across every domain (an answer-only Languages chip is a real
      // fact the API sent us, so it is a star and counts here too — the count law is "every fact
      // in a domain we drew", not a filtered subset).
      const total = nodesRef.current.length;
      const employersVisible = total <= 40;

      ctx.font = "9.5px var(--mono, monospace)";
      ctx.fillStyle = "rgba(151,170,188,0.62)";
      clustersNow.forEach((c) => {
        if (c.kind !== "section") return;
        const lx = c.cx + Math.cos(c.angle) * (c.spread + 7);
        const ly = c.cy + Math.sin(c.angle) * (c.spread + 7) + 1.2;
        ctx.textAlign = Math.cos(c.angle) > 0.4 ? "left" : Math.cos(c.angle) < -0.4 ? "right" : "center";
        ctx.fillText(c.label, ox + lx * s, oy + ly * sy);
      });

      // #187 A5/A6 — employer labels: hidden past 40 facts unless their job is the hot cluster
      // (hover on desktop, tap on touch — one derivation, `hotIndex` above). Width-truncated only,
      // `fact.job` is never parsed. Drawn in cluster order, skipping on collision with an
      // already-drawn box — the label is still reachable by reveal even when skipped here.
      ctx.font = "9px var(--mono, monospace)";
      ctx.textAlign = "center";
      const maxLabelPx = 26 * s;
      const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
      clustersNow.forEach((c, ci) => {
        if (c.kind !== "job" || !c.label) return;
        const revealed = hotClusterIdx === ci;
        if (!employersVisible && !revealed) return;
        const cached = labelCacheRef.current.get(ci);
        let text: string;
        if (cached && cached.s === s) {
          text = cached.text;
        } else {
          text = c.label;
          if (ctx.measureText(text).width > maxLabelPx) {
            while (text.length > 1 && ctx.measureText(`${text}…`).width > maxLabelPx) {
              text = text.slice(0, -1);
            }
            text = `${text}…`;
          }
          labelCacheRef.current.set(ci, { s, text });
        }
        const lpx = ox + c.cx * s;
        const lpy = oy + (c.cy + c.spread + 4.5) * sy;
        const tw = ctx.measureText(text).width;
        const box = { x0: lpx - tw / 2, x1: lpx + tw / 2, y0: lpy - 8, y1: lpy + 3 };
        const overlaps = boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
        if (overlaps) return;
        boxes.push(box);
        ctx.fillStyle = revealed ? "rgba(184,199,213,0.9)" : "rgba(151,170,188,0.42)";
        ctx.fillText(text, lpx, lpy);
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
    onOpenFact(nodes[i].fact, nodes[i].tag);
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
                className={`star ${node.fact.colour}${selected?.fact.id === node.fact.id ? " active" : ""}`}
                aria-label={
                  node.fact.job !== null
                    ? `${node.fact.job} — ${node.fact.text} — ${node.fact.colour === "gold" ? P21 : P22}`
                    : `${node.fact.text} — ${node.fact.colour === "gold" ? P21 : P22}`
                }
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
        {selected ? <DetailBody fact={selected.fact} tag={selected.tag} /> : <p>{P20}</p>}
      </div>
    </div>
  );
}
