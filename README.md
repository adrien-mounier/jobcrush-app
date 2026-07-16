# jobcrush-app

Hosted JobCrush v0.1 — server API + web and mobile thin clients. Clean-room repo: logic is
**ported by copying** from the personal-pipeline repo (`JobCrush`), never imported across repos.
Spec and plan live there: `docs/onboarding-init-design.md` (§8 authoritative) and
`docs/dev-plan-v01-hosted.md` (+ per-slice `docs/s*-kickoff.md`).

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API (JC-8) + job store/SSE (JC-9); in-memory driver until Redis exists |
| `apps/web` / `apps/mobile` | Stubs — land in S1 (JC-14) and S4 (JC-46) |
| `packages/contracts` | Zod ports of the frozen contracts, golden-tested against the copied `.mjs` oracle validators (`oracle/`) |
| `packages/api-client` | Typed client shared by web + mobile |
| `packages/ui` | Design tokens (evidence-badge palette per spec §5) |
| `Dockerfile`, `fly.api.toml`, `docs/deploy.md` | JC-6 artifacts; deployment blocked on account creation (see deploy.md) |

## Develop

```sh
pnpm install
pnpm test        # golden contract tests + api tests
pnpm typecheck
pnpm build
node apps/api/dist/main.js   # then: curl localhost:3000/healthz
```

## Rules of the repo

- **The `.mjs` oracles are the spec.** If a zod port and `packages/contracts/oracle/*` disagree,
  the port is wrong. Change contracts only by versioning, in both places.
- **Confirmation gates are server-side.** No export/submit route may exist for unverified content
  (spec §8-3); pipeline stages checkpoint LLM outputs so retries never re-spend (JC-9).
