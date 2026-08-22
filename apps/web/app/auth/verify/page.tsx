"use client";

// E2/JC-18/19 — the magic-link landing. Reads the token from the URL, POSTs it to /auth/verify
// (which claims this browser's anonymous session for the user — the JC-19 merge), then returns to
// wherever the wall interrupted (the deck for the job stashed before the redirect).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { verifyToken } from "../../../lib/api";

export default function VerifyScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const resume = () => {
        // #22: the onboarding wall (/deck, no jobId) stashes jc_return before either sign-in door
        // opens. Always consume it (one-shot) so an abandoned wall visit can never resurface on a
        // later, unrelated sign-in. But a job-scoped intent (the S2 preview->signup flow, `?job=` or
        // jc_job) always wins when present — it's more specific than the generic /deck stash, and a
        // stale jc_return must not hijack it (the bug this guarded against).
        const jcReturn = localStorage.getItem("jc_return");
        localStorage.removeItem("jc_return");

        const jobId = params.get("job") || localStorage.getItem("jc_job");
        if (jobId) {
          router.replace(`/deck/${jobId}`);
          return;
        }
        if (jcReturn && jcReturn.startsWith("/") && !jcReturn.startsWith("//")) {
          router.replace(jcReturn);
          return;
        }
        router.replace("/"); // #272: no stash, no job — start at the front door
      };
      // Google OAuth return: the callback already claimed this session server-side — just resume.
      if (params.get("oauth") === "ok") return resume();
      const token = params.get("token");
      if (!token) {
        setError("This sign-in link is missing its token.");
        return;
      }
      try {
        await verifyToken(token);
        resume();
      } catch (e) {
        setError(e instanceof Error ? e.message : "This sign-in link is invalid or has expired.");
      }
    })();
  }, [router]);

  return (
    <main>
      <h1>{error ? "Sign-in link problem" : "Signing you in…"}</h1>
      {error && (
        <div className="card">
          <p className="error" style={{ marginTop: 0 }}>{error}</p>
          <a className="btn" href="/signup">
            Get a new link
          </a>
        </div>
      )}
    </main>
  );
}
