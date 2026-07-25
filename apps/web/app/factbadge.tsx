"use client";

// #17 the profile badge — "a pile that only grows". Mounted on both /discovery and /tailor, in their
// shared `.topbar` idiom. The parent owns the data (the loaded/answered factCount, monotonically
// clamped) and the click rect; this component owns all motion — the flying chip, the pile's layer
// geometry, the landing pulse, and the number/word tweens. Unscoped styles: factbadge.css, §0A.
//
// Never a fill-up: no container is drawn, no maximum exists (log2 growth has no ceiling to reach),
// no count maps to a proportion, and the shown count only ever climbs *within one mount* — client-side
// clamped (Math.max, at every write); the server itself can still lower factCount via an independent
// deck-reject path (apps/api/src/discovery.ts:131-135), which is a server-side fix if it ever matters.
import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import "./factbadge.css";
import { useReducedMotion } from "./jobcard";

export interface FactChipFlight {
  rect: DOMRect;
  label: string; // the visitor's own answer, verbatim (truncated below)
}

const WORD_THRESHOLD = 3; // "fact"/"facts" shown at 1-3, gone from 4 (badge-ui-spec.md §5)
const CHIP_FLY_MS = 700;
const PULSE_MS = 640;
const LAYERIN_MS = 480;
const NUMBER_TWEEN_MS = 420;
const CHIP_LABEL_MAX = 22;

// The layer rule (badge-ui-spec.md §1): logarithmic, so the pile keeps densifying past 30 facts
// instead of drawing the same icon forever. Layer count changes at n = 1, 2, 5, 11, 22, 45, 90, 181, 362.
function layersFor(n: number): number {
  return Math.min(9, Math.max(1, Math.round(Math.log2(n + 1))));
}

function truncateLabel(s: string): string {
  return s.length > CHIP_LABEL_MAX ? `${s.slice(0, CHIP_LABEL_MAX - 1).trimEnd()}…` : s;
}

function badgeLabel(n: number): string {
  return n === 1 ? "Your profile — 1 fact about you" : `Your profile — ${n} facts about you`;
}

export function FactBadge({
  count,
  fly,
  rootRef,
}: {
  count: number; // the target — server truth, already monotonically clamped by the caller
  fly: FactChipFlight | null; // a fresh object identity drives exactly one flight
  rootRef: RefObject<HTMLDivElement | null>; // the screen root to append the chip to — never document.body
}) {
  const reducedMotion = useReducedMotion();

  const [shown, setShown] = useState(count); // first-paint default only — the effect below keeps it live
  const [pulsing, setPulsing] = useState(false);
  const [freshTop, setFreshTop] = useState(false);
  const [wordGone, setWordGone] = useState(count > WORD_THRESHOLD);

  const shownRef = useRef(count);
  const profRef = useRef<HTMLAnchorElement>(null);
  const flyingRef = useRef<{ chip: HTMLDivElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layerinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unmount safety net (CODING_STANDARDS: effects clean up timers/rAF/DOM nodes in teardown).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (layerinTimerRef.current) clearTimeout(layerinTimerRef.current);
      if (flyingRef.current) {
        clearTimeout(flyingRef.current.timer);
        flyingRef.current.chip.remove();
      }
    };
  }, []);

  // Keeps `shown` live for a `count` change that arrives without a `fly` (a resume/reload, or any
  // future path that re-runs a load in place without unmounting the badge) — direct set, no tween,
  // matching the resume state (badge-ui-spec.md §6). Without this, `useState(count)`'s one-time seed
  // would freeze `shown` at whatever `count` was on first mount forever.
  useEffect(() => {
    if (!fly && count > shownRef.current) {
      shownRef.current = count;
      setShown(count);
      setWordGone(count > WORD_THRESHOLD);
    }
  }, [count, fly]);

  useEffect(() => {
    if (!fly) return;
    // §9: a fresh `fly` only ever flies if it actually grows the count — a correction (delta 0) is a
    // silent no-op here, not a special case the caller has to know about.
    if (count <= shownRef.current) return;

    // Settles the ring/number/pile/word to `to` — used both for a genuine landing and, per §4 "two
    // chips at once", to commit an interrupted flight immediately before the new one launches.
    function land(to: number) {
      if (flyingRef.current) {
        clearTimeout(flyingRef.current.timer);
        flyingRef.current.chip.remove();
        flyingRef.current = null;
      }
      const from = shownRef.current;
      const grewLayers = layersFor(to) > layersFor(from);
      setFreshTop(grewLayers);
      if (layerinTimerRef.current) clearTimeout(layerinTimerRef.current);
      if (grewLayers) layerinTimerRef.current = setTimeout(() => setFreshTop(false), LAYERIN_MS);
      if (to > WORD_THRESHOLD) setWordGone(true); // one-way — the count only grows
      setPulsing(true);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setPulsing(false), PULSE_MS);

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // §5: no tween off a true first landing (from === 0) — a badge that reads 0 for even one
      // tween frame is exactly the incompleteness signal this component exists to never send.
      if (reducedMotion || from === to || from === 0) {
        shownRef.current = to;
        setShown(to);
        return;
      }
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / NUMBER_TWEEN_MS);
        const eased = 1 - Math.pow(1 - k, 3);
        const v = Math.round(from + (to - from) * eased);
        shownRef.current = v;
        setShown(v);
        rafRef.current = k < 1 ? requestAnimationFrame(tick) : null;
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    if (flyingRef.current) land(count); // interrupted flight commits its reward beat immediately

    if (reducedMotion) {
      land(count);
      return;
    }

    const root = rootRef.current;
    const target = profRef.current;
    if (!root || !target) {
      land(count);
      return;
    }

    const a = fly.rect;
    const chip = document.createElement("div");
    chip.className = "factchip";
    chip.setAttribute("aria-hidden", "true");
    chip.textContent = `+ ${truncateLabel(fly.label)}`;
    chip.style.left = `${a.left}px`;
    chip.style.top = `${a.top + a.height / 2 - 12}px`;
    root.appendChild(chip); // the screen root, never document.body — §0's "flies behind the screen" bug

    const flyRaf = requestAnimationFrame(() => {
      const c = chip.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      chip.style.transform = `translate(${b.left + b.width / 2 - c.left - c.width / 2}px, ${
        b.top + b.height / 2 - c.top - c.height / 2
      }px) scale(.35)`;
      chip.style.opacity = "0";
    });

    const timer = setTimeout(() => {
      flyingRef.current = null;
      chip.remove();
      land(count);
    }, CHIP_FLY_MS);
    flyingRef.current = { chip, timer };

    return () => cancelAnimationFrame(flyRaf);
    // Deliberately just [fly]: `count`/`reducedMotion`/the refs are read fresh at the moment this
    // fires (which is exactly when a new flight is meant to launch), not meant to re-trigger a flight
    // on their own — same "deliberately excluded, stated reason" allowance CODING_STANDARDS gives.
  }, [fly]);

  // M1: on a brand-new visitor's first-ever answer, `shown` is still 0 when this fires (the tween
  // only lands once the chip does) — falling back to the target `count` renders the badge NOW, at its
  // landed value, so `profRef` has a real mounted target for the fly effect above to aim the chip at
  // (badge-ui-spec.md §6: "badge mounts mid-flight ... so the chip has a visible target"). Once `shown`
  // itself lands, `n` just reads `shown` as before — this only matters for that one 0-to-something gap.
  const n = shown || count;
  if (n === 0) return null; // §6: 0 facts is not rendered at all — no element, no zero

  const L = layersFor(n);
  const gap = 15 / L;
  const h = Math.max(1.6, Math.min(4.6, gap * 0.72)); // the 4.6 clamp — required, §1, not decoration
  const rects = Array.from({ length: L }, (_, i) => {
    const w = 16 - i * (10 / L);
    const isTop = i === L - 1;
    return (
      <rect
        key={i}
        x={(18 - w) / 2}
        y={16 - i * gap}
        width={w}
        height={h}
        rx={1.2}
        className={[isTop ? "top" : "", isTop && freshTop ? "new" : ""].filter(Boolean).join(" ")}
      />
    );
  });

  const label = badgeLabel(n);

  return (
    <Link href="/profile" ref={profRef} className={`prof${pulsing ? " pulse" : ""}`} title={label} aria-label={label}>
      <span className="ring" aria-hidden="true" />
      <svg className="pile" viewBox="0 0 18 21" aria-hidden="true">
        {rects}
      </svg>
      <span className="n" aria-hidden="true">
        {n}
      </span>
      <span className={`unit${wordGone ? " gone" : ""}`} aria-hidden="true">
        {n === 1 ? "fact" : "facts"}
      </span>
    </Link>
  );
}
