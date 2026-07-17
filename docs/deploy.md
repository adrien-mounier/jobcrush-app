# JC-6 — infra bootstrap

> **Keep the API at ONE machine** (`fly scale count 1 -a jobcrush-api-staging`) until the shared
> session/job store lands (JC-9). Sessions, uploads, and jobs are in-memory per machine, so with 2+
> machines Fly round-robins requests and a session created on one machine 401s on the next — an
> intermittent break of the whole upload flow. The guestbook (Postgres) is already shared and is
> unaffected. Scaling up is safe only once the in-memory stores move to Postgres/Redis.

> **Guestbook (persistent run log + kept CV data).** Every onboarding run writes one durable row to
> Postgres (the previously-unused attached DB) via `src/guestbook.ts`. Two layers:
> - **Scoreboard (always open):** `GET /guestbook` — outcome, stage, mined-claim count, matched
>   posting, duration, raw error, and the full step feed for debugging. Content-free (no CV text /
>   contact info). HTML, newest first. `GUESTBOOK_KEY` does not gate this — only the CV-content
>   routes below.
> - **Kept CV data (key-gated):** each row also stores the extracted CV (`raw_cv`), the mined
>   `claims`, and the R2 `upload_key` of the original file. Because that's personal data, it is only
>   readable via `GET /guestbook/:id` (JSON) and `GET /guestbook/:id/file` (original download), both
>   of which **require `GUESTBOOK_KEY` to be set and passed as `?key=…`** — with no key set they
>   refuse (PII is never served from an ungated URL). Enable retrieval with
>   `fly secrets set GUESTBOOK_KEY=<random> -a jobcrush-api-staging`. Data is *kept* on every run
>   regardless of the key; the key only gates reading it back.
>
> Table auto-created/evolved on boot (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`, no
> migration step). Writes are best-effort and never block a run. (For persisting *all* request logs —
> not just per-run outcomes — add a Fly log drain later; unneeded at current volume.)

> **Status 2026-07-18: staging API + web are both LIVE.** `jobcrush-api-staging` +
> `jobcrush-pg-staging` (attached) run in `sin`; `https://jobcrush-api-staging.fly.dev/healthz`
> returns the build SHA and the demo job streams over SSE. The web shell is now
> `jobcrush-web-staging.fly.dev` (Next.js, `Dockerfile.web` + `fly.web.toml`); its `/api/*` proxy
> reaches the live API same-origin (verified: `/api/healthz` returns the API SHA). `API_URL` is a
> **build arg**, not just a runtime env — Next resolves `rewrites()` at build time and bakes it
> into the routes manifest. CI now deploys both apps on every green `main` push.
>
> **One open item — R2 CORS for the web origin (user, ~30 s in the Cloudflare dashboard).**
> A credential-free preflight (`OPTIONS` on a real presigned PUT URL, `Origin:
> https://jobcrush-web-staging.fly.dev`) returns `403` with no `Access-Control-Allow-*` headers —
> the bucket does not yet allow the web origin, so browser uploads from the hosted app will fail.
> The app's R2 token is **object-scoped**, so it cannot set bucket CORS (`PutBucketCors` →
> `AccessDenied` even from inside the API container); this must be done with the dashboard or an
> admin-scoped token. In R2 → bucket `jobcrush-staging` → Settings → CORS Policy, add:
> ```json
> [{ "AllowedOrigins": ["https://jobcrush-web-staging.fly.dev"],
>    "AllowedMethods": ["PUT", "GET", "HEAD"],
>    "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
> ```
> Re-run the preflight (or just try an upload from the hosted app) to confirm it flips to `200`
> with the origin echoed. **Redis** stays deferred (nothing uses it until the BullMQ driver).
> Original checklist below for reference.

Deployable artifacts in this repo are ready: `Dockerfile`, `fly.api.toml`, and the CI deploy job
(disabled with `if: false` in `.github/workflows/ci.yml`). To go live:

1. **Fly.io account** → `fly auth signup` / `fly auth login`.
2. `fly apps create jobcrush-api-staging` (region `sin`, per `docs/spikes/jc4-legal-posture.md`).
3. `fly postgres create --name jobcrush-pg-staging --region sin` and
   `fly redis create --name jobcrush-redis-staging` (Upstash) — attach both, set
   `DATABASE_URL` / `REDIS_URL` secrets via `fly secrets set`.
4. Cloudflare R2: create bucket `jobcrush-staging`, set `R2_*` secrets.
5. GitHub: push this repo, add `FLY_API_TOKEN` secret (`fly tokens create deploy`), remove
   `if: false` from the `deploy-staging` job.
6. Verify: `curl https://jobcrush-api-staging.fly.dev/healthz` returns the build SHA, then
   `POST /jobs/demo` + `GET /jobs/:id/events` streams the demo job over SSE.

Once `REDIS_URL` exists, JC-9's BullMQ driver replaces the in-memory `JobStore` behind the same
interface (`apps/api/src/jobs.ts`), and `apps/api/migrations/001_jobs.sql` is applied to Postgres.
A worker Fly app (`fly.worker.toml`, same image with `CMD` overridden) is added when the first
real pipeline job (JC-12) lands.
