// E2/JC-18/19 magic-link auth. request-link mints a single-use, 15-min token (hash stored, raw
// emailed), verify consumes it and CLAIMS the anonymous session for the user (the JC-19 merge is the
// one setClaimedByUserId call), logout clears the cookie. Security: uniform 200 on request (no email
// enumeration), per-IP rate limit, raw token never logged or returned except the dev-mailer link.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AuthStore } from "../auth.js";
import type { Mailer } from "../mailer.js";
import { IpRateLimiter, type SessionStore } from "../sessions.js";
import { SESSION_COOKIE } from "./sessions.js";
import { googleAuthUrl, googleConfigured, googleEmailFromCode } from "../oauth.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_TTL_MS = 15 * 60 * 1000;
const OAUTH_STATE_COOKIE = "jc_oauth_state";
const OAUTH_FROM_COOKIE = "jc_oauth_from";
// Where a failed/cancelled Google round-trip lands. An allowlist, not a "does it look like a path?"
// pattern: only two screens start an OAuth trip, and an allowlist can't be talked into an open
// redirect (`//evil.com` passes most path checks). Add a path here when a third door opens.
const RETURN_PATHS = new Set(["/deck", "/signup"]);
const returnPath = (from: unknown) =>
  typeof from === "string" && RETURN_PATHS.has(from) ? from : "/signup";

export interface AuthDeps {
  auth: AuthStore;
  sessions: SessionStore;
  mailer: Mailer;
  /** Absolute web origin for the emailed link (only needed when a real mailer is wired). */
  webUrl?: string;
  /** Defaults to 5 requests / 15 min per IP. */
  limiter?: IpRateLimiter;
  /** Google code→email exchange (ported from vitacairn). Tests inject a fake. */
  googleEmail?: (code: string, redirectUri: string) => Promise<string | null>;
}

export function authRoutes(deps: AuthDeps) {
  const limiter = deps.limiter ?? new IpRateLimiter(5, TOKEN_TTL_MS);
  const webUrl = deps.webUrl ?? "";

  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const cookieSecure = process.env.APP_ENV !== "local" && process.env.NODE_ENV !== "test";

    app.post(
      "/auth/request-link",
      // Trim before validating — pasted emails often carry trailing whitespace. `job` is the onboarding
      // job the user is mid-flow on; it rides the link so verify can route back cross-browser.
      { schema: { body: z.object({ email: z.string().trim().email(), job: z.string().optional() }) } },
      async (req, reply) => {
        if (!limiter.allow(req.ip))
          return reply.status(429).send({
            error: { code: "rate_limited", message: "too many sign-in requests — try again shortly" },
          });
        const email = req.body.email.toLowerCase();
        const raw = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
        // Carry the requesting session: verify claims THIS session (the one holding the preview/deck),
        // not whichever browser opens the email — the JC-18 in-app-webview footgun.
        await deps.auth.createToken(email, sha256(raw), expiresAt, req.session?.id ?? null);

        const job = req.body.job ? `&job=${encodeURIComponent(req.body.job)}` : "";
        const path = `/auth/verify?token=${raw}${job}`;
        await deps.mailer.sendLoginLink(email, webUrl + path);
        // Uniform 200 whether or not the email has an account (no enumeration). The link is returned
        // ONLY when no real mailer is configured (dev/CI/e2e), as a same-origin relative path.
        return { ok: true, ...(deps.mailer.live ? {} : { devLink: path }) };
      },
    );

    app.post(
      "/auth/verify",
      { schema: { body: z.object({ token: z.string().min(1) }) } },
      async (req, reply) => {
        // Token first: a bad link is 400 regardless of who's holding a session (the token is what's
        // invalid). Only after a good token do we need a session to attach the account to.
        const consumed = await deps.auth.consumeToken(sha256(req.body.token));
        if (!consumed)
          return reply.status(400).send({
            error: { code: "invalid_or_expired", message: "this sign-in link is invalid or has expired" },
          });

        // Claim the session that REQUESTED the link (it holds the preview/deck), falling back to the
        // browser that opened it. This is what makes a cross-browser open (mail-app webview) work: the
        // right anonymous session becomes the account's, whichever browser lands here.
        const opener = req.session;
        const target =
          (consumed.pendingSessionId && (await deps.sessions.getById(consumed.pendingSessionId))) ||
          opener;
        if (!target)
          return reply.status(401).send({
            error: { code: "no_session", message: "no active session to attach this sign-in to" },
          });

        const user = await deps.auth.upsertUser(consumed.email);
        await deps.sessions.setClaimedByUserId(target.id, user.id); // ← the JC-19 merge, in full

        // Re-home this browser onto the claimed session so a cross-browser open continues seamlessly
        // (its cookie now points at the session that owns the job). No-op when they're already the same.
        if (opener?.id !== target.id)
          reply.setCookie(SESSION_COOKIE, target.token, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: cookieSecure,
          });
        return { user };
      },
    );

    // Logout clears the cookie only; the session row keeps its owner. A fresh anon session starts next.
    app.post("/auth/logout", async (_req, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });

    // --- Google OAuth (ported from vitacairn) ---
    // Same account seam as verify: resolve a verified email, upsert the user, claim the session
    // (the JC-19 merge). The browser reaches these routes through the web app's /api proxy, so
    // browser-bound redirects are RELATIVE (they stay on the web origin in every environment).
    // Only the redirect_uri sent to Google must be absolute — `${WEB_URL}/api/auth/google/callback`,
    // matching the URI registered in the Google console (dev default: localhost:3000).
    const googleRedirectUri = `${deps.webUrl || "http://localhost:3000"}/api/auth/google/callback`;
    const exchange = deps.googleEmail ?? googleEmailFromCode;

    const oauthCookie = {
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      secure: cookieSecure,
      maxAge: 600,
    };

    app.get(
      "/auth/google",
      { schema: { querystring: z.object({ from: z.string().optional() }) } },
      async (req, reply) => {
        // Remember which door the visitor came through so a failure lands back there rather than on
        // /signup — the /deck wall keeps the reveal it already showed. Never sent to Google.
        const from = returnPath(req.query.from);
        if (!googleConfigured() && !deps.googleEmail) return reply.redirect(`${from}?login=error`);
        // Short-lived CSRF token: set here, echoed back by Google, checked on callback.
        const state = randomBytes(16).toString("base64url");
        reply.setCookie(OAUTH_STATE_COOKIE, state, oauthCookie);
        reply.setCookie(OAUTH_FROM_COOKIE, from, oauthCookie);
        return reply.redirect(googleAuthUrl(googleRedirectUri, state));
      },
    );

    app.get(
      "/auth/google/callback",
      { schema: { querystring: z.object({ code: z.string().optional(), state: z.string().optional() }) } },
      async (req, reply) => {
        const saved = req.cookies?.[OAUTH_STATE_COOKIE];
        // Re-validated, not trusted: a tampered cookie falls back to /signup like an absent one.
        const from = returnPath(req.cookies?.[OAUTH_FROM_COOKIE]);
        reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
        reply.clearCookie(OAUTH_FROM_COOKIE, { path: "/" });
        // CSRF: the state cookie must match the state Google echoed back.
        if (!saved || !req.query.state || saved !== req.query.state || !req.query.code)
          return reply.redirect(`${from}?login=expired`);
        const email = await exchange(req.query.code, googleRedirectUri);
        if (!email) return reply.redirect(`${from}?login=expired`);

        // Claim the browser's anonymous session (its preview rides along); a visitor who somehow
        // arrives without one still gets logged in on a fresh session.
        let session = req.session;
        if (!session) {
          session = await deps.sessions.create();
          reply.setCookie(SESSION_COOKIE, session.token, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: cookieSecure,
          });
        }
        const user = await deps.auth.upsertUser(email);
        await deps.sessions.setClaimedByUserId(session.id, user.id); // the JC-19 merge, same as verify
        return reply.redirect(`/auth/verify?oauth=ok`);
      },
    );
  };
}
