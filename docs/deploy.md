# JC-6 — infra bootstrap (blocked on account creation: the user's ~30-minute action)

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
