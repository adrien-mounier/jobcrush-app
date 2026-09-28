"use client";

// #303 — the job's own screen: where the paste door lands him, never back on the deck (#291 ruling
// 2). It is the SHIPPED DECK CARD, reused, so nothing new has to be learned at the moment he is
// deciding (#300) — the same `CardBody`, inside the same `.jobcard > .jcbody` wrapper, with the
// swipe gesture and its two stamps left behind because there is nothing here to swipe past.
//
// #306 makes the four changes that turn this into the finished screen: the apply row under the
// title, one full-width "Write the tailored CV", "Read the ad in full" moved up, and the "where you
// don't — yet" rows un-muted here only. This ticket builds the room it lands in and nothing more.
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ensureSession, getJob, type JobCard } from "../../../lib/api";
import { CardBody } from "../../jobcard";
import { PasteDoor } from "../../pastedoor";
import "../../deck.css";
import "./job.css";

const LOADING = "Opening this job…";
const GONE_H = "This job isn't on your deck";
const GONE =
  "We couldn't open it. A job you pasted stays; one we found can drop off when its listing does.";
const BACK = "Back to my deck";

/** Next's `useParams` hands back the URL segment as it was WRITTEN, still percent-encoded — and an
 *  adId is `posting:<hex>`, whose colon the paste screen had to encode to put it in a path. Without
 *  this the id is encoded a second time on the way to the API (`posting%253A…`) and every pasted job
 *  404s: the screen the paste door exists to reach would never open. Idempotent for the id shapes
 *  this app produces (a decoded `posting:abc` contains no `%`), and it never throws: a hand-typed
 *  segment with a malformed escape is passed through and 404s honestly instead of crashing. */
function decodeAdId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default function JobScreen() {
  const { adId: segment } = useParams<{ adId: string }>();
  const adId = decodeAdId(segment);
  const router = useRouter();
  const [card, setCard] = useState<JobCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const goneHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        setCard((await getJob(adId)).card);
      } catch (e) {
        setError(e instanceof Error ? e.message : GONE);
      }
    })();
  }, [adId]);

  // He arrived here by pressing a door on another screen, so the heading of what he asked for is
  // where focus belongs — the same route-change rule the deck follows for its own card.
  useEffect(() => {
    if (card) headingRef.current?.focus();
  }, [card]);
  useEffect(() => {
    if (error) goneHeadingRef.current?.focus();
  }, [error]);

  return (
    <div className="jobdeck jobscreen">
      <div className="topbar">
        <span className="wordmark">JobCrush</span>
        <span className="spacer" />
        <PasteDoor />
      </div>

      {!card && !error && (
        <div className="loadstate">
          <p>{LOADING}</p>
        </div>
      )}

      {error && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={goneHeadingRef}>
            {GONE_H}
          </h1>
          <p>{GONE}</p>
          <button type="button" onClick={() => router.push("/deck")}>
            {BACK}
          </button>
        </div>
      )}

      {card && (
        <div className="onejob">
          <div className="jobcard">
            <div className="jcbody">
              <CardBody card={card} headingRef={headingRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
