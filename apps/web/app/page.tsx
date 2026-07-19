"use client";

// JC-14 landing: target-titles input (free text + suggestions), stored on the anonymous
// session, then on to the import doors. No account, no signup — spec §8-7.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureSession, saveTargetTitles } from "../lib/api";

const SUGGESTIONS = [
  "IT Project Manager",
  "Project Manager",
  "Product Owner",
  "Product Manager",
  "Delivery Manager",
  "Scrum Master",
  "Program Manager",
  "Business Analyst",
];

export default function Landing() {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (title: string) =>
    setPicked((p) => (p.includes(title) ? p.filter((t) => t !== title) : [...p, title]));

  const titles = [
    ...picked,
    ...freeText
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean),
  ];

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      await saveTargetTitles(titles.slice(0, 10));
      router.push("/import");
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>See your CV tailored to a real job — in about 2 minutes.</h1>
      <p className="lede">
        No account needed. Tell us what roles you&apos;re after, share your CV, and watch it
        become a targeted draft for a live posting.
      </p>

      <div className="card">
        <p style={{ marginTop: 0, fontWeight: 600 }}>What roles are you targeting?</p>
        <div>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="chip"
              data-on={picked.includes(s)}
              aria-pressed={picked.includes(s)}
              onClick={() => toggle(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="text"
          aria-label="Add your own target role"
          placeholder="Or type your own (comma-separated)…"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          style={{ marginTop: 12 }}
        />
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" onClick={start} disabled={busy || titles.length === 0}>
        {busy ? "Starting…" : "Continue"}
      </button>
    </main>
  );
}
