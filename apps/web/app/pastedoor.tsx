"use client";

// #303 / #291 door B — `＋ Paste a job`, in the same top-bar slot on every signed-in screen, and
// INERT on the screen it opens. Two rules and nothing else: never hunted for, never offered twice.
//
// Mounted in the `.topbar` idiom the deck, the tailor, the profile and the paste screen already
// share, as the LAST child on each of them — the far-right slot is the one that reads as the same
// place on a screen that also carries the fact badge and on one that does not. Unscoped styles
// (pastedoor.css), for the same reason factbadge.css is: it renders on more than one root and a
// second copy of the block would drift.
import Link from "next/link";
import "./pastedoor.css";

const LABEL = "Paste a job";
const MARK = "＋";

/** The mark always shows; the words collapse only where the top bar has no room for them — the
 *  profile's, BELOW 900px, where a back button, an absolutely centred view toggle and the fact badge
 *  already share a column capped at 560px. From 900px up the profile widens that bar to 1120px and
 *  the words come back, so this is not a profile-wide compromise (pastedoor.css carries the measured
 *  numbers). `aria-label` carries the full name in every case, so the control is never announced as
 *  a bare "+". */
const Face = () => (
  <>
    <span aria-hidden="true">{MARK}</span>
    <span className="pdwords">{LABEL}</span>
  </>
);

export function PasteDoor({ inert }: { inert?: boolean }) {
  // A disabled control rather than a hidden one: the slot does not move between screens, which is
  // what makes it a slot. `aria-disabled` rather than `disabled`, on a real button: a `disabled`
  // control (or a bare span) leaves the tab order, so a keyboard user would find the door on three
  // screens and lose it on the fourth — the exact thing a fixed slot exists to prevent. It is
  // announced, reachable, and does nothing.
  if (inert)
    return (
      <button
        type="button"
        className="pastedoor"
        aria-disabled="true"
        aria-label={LABEL}
        data-testid="paste-door-inert"
      >
        <Face />
      </button>
    );
  return (
    <Link className="pastedoor" href="/paste" aria-label={LABEL} title={LABEL} data-testid="paste-door">
      <Face />
    </Link>
  );
}
