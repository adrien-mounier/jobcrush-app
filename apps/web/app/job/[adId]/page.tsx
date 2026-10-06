"use client";

// #303 — the job's own screen: where the paste door lands him, never back on the deck (#291 ruling
// 2). It is the SHIPPED DECK CARD, reused, so nothing new has to be learned at the moment he is
// deciding (#300) — the same `CardBody`, inside the same `.jobcard > .jcbody` wrapper, with the
// swipe gesture and its two stamps left behind because there is nothing here to swipe past.
//
// #306 made the four changes that turn it into the finished screen, and three of the four are here:
// the apply row under the title (a slot CardBody renders and the deck never fills), one full-width
// "Write the tailored CV" where the deck has its swipe pair, and the "where you don't — yet" rows
// un-muted by job.css on this screen only. The fourth — "Read the ad in full" moved up under the
// heading — is in CardBody, because it happens on both screens.
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureSession, getJob, wantCard, type JobCard } from "../../../lib/api";
import { ApplyRow } from "../../applyrow";
import { CardBody } from "../../jobcard";
import { PasteDoor } from "../../pastedoor";
import "../../deck.css";
import "./job.css";

const LOADING = "Opening this job…";
const GONE_H = "This job isn't on your deck";
const GONE =
  "We couldn't open it. A job you pasted stays; one we found can drop off when its listing does.";
const BACK = "Back to my deck";
// #306 change 2 / #300: ONE full-width action, and it says what the press produces. It reads
// differently from the deck's own button on purpose — there "I want this one" pairs with "Not for me"
// and matches the stamp shown when the card is dragged right, so relabelling it would make a card
// contradict itself mid-swipe. Same card, two contexts, one word different.
const WRITE = "Write the tailored CV";
const WRITING = "Opening…";
const WRITE_FAILED = "We couldn't start on this one. Please try again.";

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
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        setCard((await getJob(adId)).card);
      } catch (e) {
        // #338 (ADR-0016 clause 6): no job is shown until a brought CV is reviewed — the server
        // says so with its own code, and the review is where he goes, not a "gone" screen.
        if ((e as { code?: string }).code === "review_pending") {
          router.replace("/review");
          return;
        }
        setError(e instanceof Error ? e.message : GONE);
      }
    })();
  }, [adId, router]);

  // He arrived here by pressing a door on another screen, so the heading of what he asked for is
  // where focus belongs — the same route-change rule the deck follows for its own card.
  useEffect(() => {
    if (card) headingRef.current?.focus();
  }, [card]);
  useEffect(() => {
    if (error) goneHeadingRef.current?.focus();
  }, [error]);

  /** The one next step. It is the deck's own handoff — the same `want` call, so a job reaches the
   *  Tailor step by one route whichever screen he pressed it from — minus the swipe choreography the
   *  deck wraps it in, because there is no card to animate off a screen showing one job. */
  const write = useCallback(async () => {
    if (!card || starting) return;
    setStarting(true);
    setActionError(null);
    try {
      await wantCard(card.adId);
      router.push("/tailor");
    } catch {
      setActionError(WRITE_FAILED);
      setStarting(false);
    }
  }, [card, router, starting]);

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
              <CardBody
                card={card}
                headingRef={headingRef}
                applyRow={<ApplyRow adId={card.adId} applicationUrl={card.applicationUrl} />}
              />
            </div>
            {actionError && (
              <p className="deckerr" role="alert">
                {actionError}
              </p>
            )}
            <div className="jcfoot">
              <button type="button" className="sw yes" disabled={starting} onClick={write}>
                {starting ? WRITING : WRITE}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
