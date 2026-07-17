"use client";

// JC-14 import screen: the four §8-6 doors, in that order of prominence. In S1 only
// "Upload a file" and the paste path are live; LinkedIn and Email render visibly
// coming-soon — their click-through rate is free demand data.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadCv } from "../../lib/api";

export default function ImportScreen() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soonClicked, setSoonClicked] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await uploadCv(file);
      router.push(`/progress/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
      setBusy(false);
    }
  };

  // Coming-soon doors log interest client-side; the click itself is the datum.
  const comingSoon = (door: string) => setSoonClicked(door);

  return (
    <main>
      <h1>Bring in your CV</h1>
      <p className="lede">Pick whichever is easiest — it stays on your device session only.</p>

      <button className="door" onClick={() => comingSoon("linkedin")}>
        <div>
          <div className="door-title">Import from LinkedIn</div>
          <div className="door-sub">Your profile URL, or LinkedIn&apos;s &quot;Save profile as PDF&quot;</div>
        </div>
        <span className="soon">coming soon</span>
      </button>

      <button className="door" onClick={() => fileInput.current?.click()} disabled={busy}>
        <div>
          <div className="door-title">{busy ? "Uploading…" : "Upload a file"}</div>
          <div className="door-sub">PDF, Word, or plain text — up to 10 MB</div>
        </div>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ display: "none" }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <button className="door" onClick={() => comingSoon("email")}>
        <div>
          <div className="door-title">Email it to us</div>
          <div className="door-sub">Forward that old CV email — we&apos;ll pick it up</div>
        </div>
        <span className="soon">coming soon</span>
      </button>

      <button className="door" onClick={() => router.push("/paste")}>
        <div>
          <div className="door-title">Build it with me</div>
          <div className="door-sub">No file handy? Paste your CV text and start from there</div>
        </div>
      </button>

      {soonClicked && (
        <p className="lede" style={{ marginTop: 8 }}>
          That door opens soon — noted that you wanted it! For now, uploading a file is the
          fastest way in.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
