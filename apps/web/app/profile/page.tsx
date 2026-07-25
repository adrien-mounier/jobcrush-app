"use client";

// #17's thinnest honest placeholder for the badge's destination — the real profile screen is #20,
// not this batch. Carries `.jobdeck` (tailor-ui-spec.md §0's precedent): inherits the tokens,
// .topbar/.wordmark, .loadstate + .big + button styles, the focus ring and the print rule for free,
// and lands on the same deep charcoal instead of flashing the light theme at someone coming off a
// dark screen. Zero new CSS. No count fetched, no Sorted, no Constellation, nothing #20 has to tear out.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import "../deck.css";

const B6 = "Your profile";
const B7 = "Everything you've told me is saved here. This screen is being built.";
const B8 = "Back";

export default function ProfilePage() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="jobdeck">
      <div className="topbar">
        <span className="wordmark">JobCrush</span>
      </div>
      <div className="loadstate">
        <h1 className="big" tabIndex={-1} ref={headingRef}>
          {B6}
        </h1>
        <p>{B7}</p>
        <button type="button" onClick={() => router.back()}>
          {B8}
        </button>
      </div>
    </div>
  );
}
