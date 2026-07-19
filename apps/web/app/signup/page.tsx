"use client";

// E2/JC-18 the signup wall — sits between the preview and the deck (the deck redirects here on a
// 401). Two doors, same account seam: Google OAuth (ported from vitacairn — a plain link into
// /api/auth/google; the API handles state + callback and claims the session), or the passwordless
// magic link. With no mail provider configured (local/CI/staging-without-a-key) the API returns
// the link and we render it as a "dev" button.
import { useEffect, useState } from "react";
import { ensureSession, requestLink } from "../../lib/api";

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The deck we're mid-flow on (the wall redirected here with ?job=…). Carried into the sign-in link
  // so it can route back cross-browser.
  const [job, setJob] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setJob(params.get("job"));
    // Surface how we got here: a Google sign-in that didn't complete, or one that isn't set up.
    const login = params.get("login");
    if (login === "expired") setError("Google sign-in didn't complete — try again, or use your email below.");
    else if (login === "error") setError("Google sign-in isn't available right now — use your email below.");
    // The anonymous session must exist BEFORE the Google redirect, or the callback can't claim it
    // (and your preview wouldn't follow you into the account).
    ensureSession().catch(() => {});
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureSession(); // the anonymous session we'll claim must exist before we send the link
      setSent(await requestLink(email, job ?? undefined));
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
          <a
            className="btn"
            href="/api/auth/google"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 12 }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </a>
          <p className="lede" style={{ margin: "0 0 12px" }}>or get a sign-in link by email:</p>
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
          <p className="lede" style={{ marginBottom: 12 }}>
            We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
          </p>
          {sent.devLink && (
            <a className="btn" href={sent.devLink} style={{ marginRight: 12 }}>
              Open your sign-in link (dev)
            </a>
          )}
          {/* Recovery from a typo'd address: back to the form with the email kept, so it's a quick fix. */}
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSent(null);
              setBusy(false);
            }}
          >
            Wrong email? Change it
          </button>
        </div>
      )}
    </main>
  );
}
