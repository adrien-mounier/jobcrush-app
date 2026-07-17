"use client";

// JC-17 paste-text fallback: textarea → the same raw_cv pipeline as an upload.
// Triggered by an unparseable file or by choice. No cleverness.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureSession, pasteCv } from "../../lib/api";

export default function PasteScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const { jobId } = await pasteCv(text);
      router.push(`/progress/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Paste your CV</h1>
      <p className="lede">
        Copy the text of your CV — from a doc, an email, anywhere — and paste it here.
      </p>
      <div className="card">
        <textarea
          rows={16}
          placeholder={"Jane Doe\nProject Manager\n\nExperience\n…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn" onClick={submit} disabled={busy || text.trim().length < 100}>
        {busy ? "Sending…" : "Use this text"}
      </button>
      {text.trim().length > 0 && text.trim().length < 100 && (
        <p className="lede" style={{ marginTop: 8 }}>
          Keep going — a bit more text and we can work with it.
        </p>
      )}
    </main>
  );
}
