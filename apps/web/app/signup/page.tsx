"use client";

// E2/JC-18 the signup wall — sits between the preview and the deck (the deck redirects here on a
// 401). Passwordless: we email a one-tap sign-in link. With no mail provider configured (local/CI/
// staging-without-a-key) the API returns the link and we render it as a "dev" button.
import { useState } from "react";
import { ensureSession, requestLink } from "../../lib/api";

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureSession(); // the anonymous session we'll claim must exist before we send the link
      setSent(await requestLink(email));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not send your link");
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Verify your email to unlock your draft</h1>
      <p className="lede">
        Your tailored draft is ready. Confirm your email and we&apos;ll turn it into a verified master
        CV that&apos;s yours to keep — no password, just a one-tap link.
      </p>

      {!sent ? (
        <div className="card">
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email.includes("@") && submit()}
          />
          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
          <button
            className="btn"
            style={{ marginTop: 12 }}
            onClick={submit}
            disabled={busy || !email.includes("@")}
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </div>
      ) : (
        <div className="card">
          <p style={{ marginTop: 0, fontWeight: 600 }}>Check your email</p>
          <p className="lede" style={{ marginBottom: sent.devLink ? 12 : 0 }}>
            We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
          </p>
          {sent.devLink && (
            <a className="btn" href={sent.devLink}>
              Open your sign-in link (dev)
            </a>
          )}
        </div>
      )}
    </main>
  );
}
