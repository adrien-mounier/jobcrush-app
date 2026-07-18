// E2/JC-18/19 magic-link auth. request-link mints a single-use, 15-min token (hash stored, raw
// emailed), verify consumes it and CLAIMS the anonymous session for the user (the JC-19 merge is the
// one setClaimedByUserId call), logout clears the cookie. Security: uniform 200 on request (no email
// enumeration), per-IP rate limit, raw token never logged or returned except the dev-mailer link.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { AuthStore } from "../auth.js";
import type { Mailer } from "../mailer.js";
import { IpRateLimiter, type SessionStore } from "../sessions.js";
import { SESSION_COOKIE } from "./sessions.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_TTL_MS = 15 * 60 * 1000;

export interface AuthDeps {
  auth: AuthStore;
  sessions: SessionStore;
  mailer: Mailer;
  /** Absolute web origin for the emailed link (only needed when a real mailer is wired). */
  webUrl?: string;
  /** Defaults to 5 requests / 15 min per IP. */
  limiter?: IpRateLimiter;
}

export function authRoutes(deps: AuthDeps) {
  const limiter = deps.limiter ?? new IpRateLimiter(5, TOKEN_TTL_MS);
  const webUrl = deps.webUrl ?? "";

  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/auth/request-link",
      // Trim before validating — pasted emails often carry trailing whitespace.
      { schema: { body: z.object({ email: z.string().trim().email() }) } },
      async (req, reply) => {
        if (!limiter.allow(req.ip))
          return reply.status(429).send({
            error: { code: "rate_limited", message: "too many sign-in requests — try again shortly" },
          });
        const email = req.body.email.toLowerCase();
        const raw = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
        await deps.auth.createToken(email, sha256(raw), expiresAt);

        const path = `/auth/verify?token=${raw}`;
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
        const session = requireSession(req); // the anonymous session to claim
        const email = await deps.auth.consumeToken(sha256(req.body.token));
        if (!email)
          return reply.status(400).send({
            error: { code: "invalid_or_expired", message: "this sign-in link is invalid or has expired" },
          });
        const user = await deps.auth.upsertUser(email);
        await deps.sessions.setClaimedByUserId(session.id, user.id); // ← the JC-19 merge, in full
        return { user };
      },
    );

    // Logout clears the cookie only; the session row keeps its owner. A fresh anon session starts next.
    app.post("/auth/logout", async (_req, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });
  };
}
