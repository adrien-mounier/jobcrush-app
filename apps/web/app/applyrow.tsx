"use client";

// #306 (#300 change 1) — the apply row on the job's own screen, and the reason it is a component of
// its own rather than a branch inside jobcard.tsx: the deck must never be able to render it.
//
// The deck card is swiped, so a link inside it fights the gesture, and offering "apply here"
// mid-triage invites leaving for the job board before the app has written a better CV (#300). The
// cheapest way to be certain of that is structural — `CardBody` takes the apply row as a slot its
// caller fills, and the deck passes nothing, so there is no flag anybody can get the wrong way round.
//
// Its empty state is a CONTROL, not a caption. A pasted advert may carry no link (the paste door
// never blocks on one) while the application report puts that link at the top (#293), so a job with
// no link leaves a hole in the one document read immediately before applying. Narrating the hole
// would be the product describing its own gap; the control closes it.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { addApplicationLink } from "../lib/api";

const APPLY = "Apply for this job";
const EMPTY = "No application link yet — add the application link";
const FIELD = "The link to apply for this job";
const PLACEHOLDER = "https://";
const SAVE = "Save the link";
const SAVING = "Saving…";
const CANCEL = "Cancel";
// Said the way the server says it, so the same refusal does not read as two different rules
// depending on which side caught it.
const BAD_LINK = "A link has to start with http:// or https://";
const FAILED = "We could not save that link. Please try again.";

/** Where the link actually goes, shown beside it. He pasted the advert from somewhere and may be
 *  adding a link hours later; the host is the one cheap way to see it points where he thinks before
 *  he leaves the app for it. Null on anything unparseable, which the contract and both write
 *  boundaries already exclude — so this never becomes the only thing standing between him and a
 *  scheme nobody checked. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function ApplyRow({ adId, applicationUrl }: { adId: string; applicationUrl?: string }) {
  // `saved` is what THIS screen just wrote, never a copy of the card's own field — the link shown is
  // the card's unless we have a fresher one, so a card that reloads is not fighting a stale useState.
  const [saved, setSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = saved ?? applicationUrl ?? null;
  // Cancel hands the keyboard back to the button that opened the form. Without this the focus falls
  // to the page and somebody navigating by keyboard has to walk the whole card to get back to it.
  const addRef = useRef<HTMLButtonElement>(null);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (cancelled) addRef.current?.focus();
  }, [cancelled]);

  if (link) {
    const host = hostOf(link);
    return (
      <p className="applyrow">
        <a className="applylink" href={link} target="_blank" rel="noopener noreferrer">
          {APPLY}
        </a>
        {host && <span className="applyhost">{host}</span>}
      </p>
    );
  }

  if (!adding) {
    return (
      <p className="applyrow">
        <button
          type="button"
          className="applyadd"
          ref={addRef}
          onClick={() => {
            setCancelled(false);
            setAdding(true);
          }}
        >
          {EMPTY}
        </button>
      </p>
    );
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = typed.trim();
    // The same guard the route and the store write both apply. Checked here as well so a typo is
    // answered instantly rather than after a round trip — never INSTEAD of the two behind it.
    if (!/^https?:\/\//i.test(value)) return setError(BAD_LINK);
    setSaving(true);
    setError(null);
    try {
      setSaved((await addApplicationLink(adId, value)).applicationUrl);
    } catch (e) {
      // A link somebody else added first is not a failure, it is the answer: the advert record is
      // shared, the first link wins, and the server hands back the one that is actually there. Show
      // THAT rather than leaving him pressing a control over a gap that is already closed.
      const already = e instanceof Error ? (e as { body?: { applicationUrl?: string } }).body : undefined;
      if (already?.applicationUrl) return setSaved(already.applicationUrl);
      // The route refuses exactly one thing, and its refusal arrives in Fastify's schema envelope,
      // whose shape jfetch cannot read a message out of — so it would otherwise reach him as the word
      // "Bad Request". The one value that gets past the guard above and is still refused is a link
      // that is not a real web address, so that is what he is told.
      const message = e instanceof Error ? e.message : "";
      setError(!message || message === "Bad Request" ? BAD_LINK : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    // noValidate, with `type="url"` kept for the keyboard it gives him on a phone: the browser's own
    // validation intercepts the submit and answers in a bubble that lives outside the page, so the
    // product would have a refusal nothing can read back and no test could ever prove he was told.
    // One guard, one message, in the page — and the server's own refusal is still the real boundary.
    <form className="applyrow adding" onSubmit={save} noValidate>
      <input
        className="applyinput"
        type="url"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={PLACEHOLDER}
        aria-label={FIELD}
        autoFocus
      />
      <button type="submit" className="applysave" disabled={saving}>
        {saving ? SAVING : SAVE}
      </button>
      <button
        type="button"
        className="applycancel"
        onClick={() => {
          setAdding(false);
          setError(null);
          setCancelled(true);
        }}
        disabled={saving}
      >
        {CANCEL}
      </button>
      {error && (
        <span className="applyerr" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
