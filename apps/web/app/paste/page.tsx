"use client";

// #303 / #291 door B, "its own room" — the screen the paste door opens. It takes the advert text and
// the application link SIDE BY SIDE: the link is asked up front, is optional, and is pre-filled when
// the pasted text carries one, so both answers to the link question arrive at once and neither
// blocks the read.
//
// The right-hand column is the wait's home. #304 fills it: three named steps over the existing
// job/progress stream, with the requirements lifting out of the advert as they are read, and a full
// failure screen — with his text kept — for an advert that yields nothing. Until then it says what
// it is for and the read reports plainly; a failed read already keeps the text, because this screen
// never navigates away from it.
//
// Landing: that job's own screen, never back on the deck (#291 ruling 2). He asked for this job.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ensureSession, linkInText, pasteJob } from "../../lib/api";
import { PasteDoor } from "../pastedoor";
import "../deck.css";
import "./paste.css";

const H1 = "Paste a job you found";
const LEDE =
  "The whole advert, as you copied it. It is stored, read and scored like a job we found for you — it just came from you.";
const TA_LABEL = "The advert";
const TA_PLACEHOLDER = "Paste the advert…";
const LINK_LABEL = "Link of the application";
const LINK_HINT = "optional — it goes to the top of your application email";
const GO = "Read it";
const GOING = "Reading…";
const PANEL_H = "What this job asks for";
const PANEL_EMPTY =
  "Nothing yet. Paste the advert and this fills in as we read it — you will see what we found before anything is scored.";
const PANEL_READING = "Reading your advert, looking up the employer, and checking it against your profile.";
const FALLBACK_ERROR = "We could not read that. Your text is still here — try pasting more of the advert.";

export default function PasteScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The pre-fill may only ever happen to a field he has not touched — once he types (or clears) it,
  // the answer is his. Tracked in a ref, not state: nothing renders differently because of it.
  const linkTouched = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void ensureSession().catch(() => {});
    // Route-change focus (the house rule): he pressed a door to get here, so the room he opened is
    // what should be announced, not wherever focus happened to land.
    headingRef.current?.focus();
  }, []);

  const onText = (value: string) => {
    setText(value);
    if (linkTouched.current) return;
    const found = linkInText(value);
    if (found) setLink(found);
  };

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await pasteJob(text, link.trim() || null);
      router.push(`/job/${encodeURIComponent(result.adId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : FALLBACK_ERROR);
      setBusy(false);
    }
  };

  return (
    <div className="jobdeck pastescreen">
      <div className="topbar">
        <span className="wordmark">JobCrush</span>
        <span className="spacer" />
        <PasteDoor inert />
      </div>

      <div className="desk">
        <div className="head">
          <h1 tabIndex={-1} ref={headingRef}>
            {H1}
          </h1>
          <p className="lede">{LEDE}</p>
        </div>

        <div className="left">
          <label className="sr-only" htmlFor="advert">
            {TA_LABEL}
          </label>
          <textarea
            id="advert"
            className="ta"
            placeholder={TA_PLACEHOLDER}
            value={text}
            disabled={busy}
            onChange={(e) => onText(e.target.value)}
          />
          <div className="field">
            <label htmlFor="applylink">
              {LINK_LABEL} <i>— {LINK_HINT}</i>
            </label>
            <input
              id="applylink"
              type="url"
              placeholder="https://…"
              value={link}
              disabled={busy}
              onChange={(e) => {
                linkTouched.current = true;
                setLink(e.target.value);
              }}
            />
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="go" disabled={busy || text.trim().length === 0} onClick={read}>
            {busy ? GOING : GO}
          </button>
        </div>

        <div className="right" aria-live="polite">
          <h2>{PANEL_H}</h2>
          <p className="empty">{busy ? PANEL_READING : PANEL_EMPTY}</p>
        </div>
      </div>
    </div>
  );
}
