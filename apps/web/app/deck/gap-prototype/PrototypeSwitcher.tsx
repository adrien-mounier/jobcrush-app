"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const VARIANTS = [
  { key: "A", name: "One important gap" },
  { key: "B", name: "Full gap ledger" },
  { key: "C", name: "Review layer" },
] as const;

export function PrototypeSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const index = Math.max(0, VARIANTS.findIndex(({ key }) => key === current));

  function go(offset: number) {
    const next = VARIANTS[(index + offset + VARIANTS.length) % VARIANTS.length];
    router.replace(`?variant=${next.key}`);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <nav className="prototype-switcher" aria-label="Prototype variants">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        {VARIANTS[index].key} — {VARIANTS[index].name}
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </nav>
  );
}
