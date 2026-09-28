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

const LABEL = "＋ Paste a job";

export function PasteDoor({ inert }: { inert?: boolean }) {
  // A disabled control rather than a hidden one: the slot does not move between screens, which is
  // what makes it a slot. `aria-disabled` rather than `disabled`, on a real button: a `disabled`
  // control (or a bare span) leaves the tab order, so a keyboard user would find the door on three
  // screens and lose it on the fourth — the exact thing a fixed slot exists to prevent. It is
  // announced, reachable, and does nothing.
  if (inert)
    return (
      <button type="button" className="pastedoor" aria-disabled="true" data-testid="paste-door-inert">
        {LABEL}
      </button>
    );
  return (
    <Link className="pastedoor" href="/paste" data-testid="paste-door">
      {LABEL}
    </Link>
  );
}
