# jobcrush-app

Hosted JobCrush v0.1 — server API + web and mobile thin clients. Clean-room repo: logic is
**ported by copying** from the personal-pipeline repo (`JobCrush`), never imported across repos.

**Plan lives here:** the forward roadmap is [`roadmap.md`](roadmap.md) (S2 → S4; S0 + S1 done). The
original detailed spec, per-ticket ACs, and per-slice kickoffs are **archived in the JobCrush repo**
(`docs/onboarding-init-design.md` §8 authoritative, `docs/dev-plan-v01-hosted.md`,
`docs/s0..s4-kickoff.md`) — frozen reference, not a live dependency.

**CV brain (forked 2026-07-18):** the CV-tailoring reasoning + research now lives **here**, in
[`docs/cv-brain/`](docs/cv-brain/README.md) — it was copied once from JobCrush, which is now frozen
for CV logic. This repo owns and evolves the CV brain independently; do CV-reasoning work here, never
in JobCrush. That folder is the source of truth the miner/tailor prompts and `preview.ts` must stay
true to.

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
