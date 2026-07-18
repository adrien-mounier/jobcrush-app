# jobcrush-app — working conventions

<!-- SHARED:START -->
## What this repo is

**jobcrush-app is the hosted JobCrush product** — a Fastify API + Next.js web and mobile thin
clients that let anyone upload a CV and get a tailored, ATS-aware draft. It is the **primary repo for
product development** as of 2026-07-18.

It is a **clean-room repo**: logic is **ported by copying** from the personal-pipeline repo
(`JobCrush`), never imported across repos. The two are separate products and evolve independently.

**Status:** S0 (spikes + foundation) and **S1 (magic-mirror preview) are DONE** — the S1 quality
floor passed JC-2 round 2 on 2026-07-18. S2 (full onboarding) is the next slice.

## Relationship to the JobCrush repo (read this before touching CV logic)

- **This repo owns the CV brain.** The CV-tailoring reasoning + research live in
  [`docs/cv-brain/`](docs/cv-brain/README.md) — forked once from JobCrush on 2026-07-18 and evolving
  here independently. **Do all CV-reasoning work here.** JobCrush is frozen for CV logic.
- **No two-way sync, ever.** If an improvement made here also happens to help JobCrush's own pipeline,
  port that single insight by hand into JobCrush — never stand up a sync. A silent two-way sync is the
  drift that caused the JC-2 rating failure.
- Full boundary record: JobCrush's `docs/boundary-with-jobcrush-app.md`.

## The CV brain is the source of truth

`docs/cv-brain/` is what the pipeline must stay true to:

- `cv-authoring-rules.md` — CV output + writing-style rules (ATS, length/density, formatting).
- `tailoring-reasoning.md` — role taxonomy, content classification, decision rules, gap handling,
  the conservation principle.
- `research/` — ATS pitfalls, AI-writing-tells, formatting standards, IT-PM best practices.

The pipeline that implements it: `apps/api/prompts/{claim-miner,preview-tailor}.md` and
`apps/api/src/preview.ts` (the canonical Draft schema + `conservationIssues()` lint — the mechanical
enforcement of **"tailor by emphasis, not amputation"**: rephrase/reorder/select, never silently drop
a fact class the source CV had). Change the rules → update `docs/cv-brain/` too; it is the reference,
not a copy to let rot.

## Git workflow

Default to **committing directly to `main` and pushing** — solo repo, no branch protection.

- **CI auto-deploys `main`** to Fly staging (both api + web) on every green push. So **keep `main`
  green**: run `pnpm test && pnpm typecheck` before pushing. A red `main` ships a broken staging.
- Use a branch + PR only for a `/code-review` pass or a change risky enough that staging must stay up
  while it is in progress.
- Background-job **worktree isolation** still applies: finish in a worktree, then fast-forward into
  `main` and push (no PR).
- **Commit or push only when the user asks** (or when establishing a convention like this one).

## Keeping the plan honest (session hygiene)

`roadmap.md`, `session-log.md`, and `lessons.md` are the project's memory — keep them current **as part
of the work**, proactively, not only when asked or at session end:

- After a **meaningful unit of work** lands (a ticket, a bug fix, a shippable slice), before moving on:
  add a newest-first `session-log.md` entry with ticket + commit refs, and update `roadmap.md` (mark
  done, trim what remains). "Meaningful" is a judgment call — skip trivia; log what a future session
  would want to know.
- When you **learn something non-obvious** that would save future-you time (a gotcha, a latent-bug
  class, a tool or flow that works here), add a short `lessons.md` entry. Only genuinely reusable
  insight — never a restatement of the code or the commit message.

The `close-session` skill still does the full end-of-session sync (context files + all three docs);
this rule keeps the docs honest *between* those, so no progress goes unrecorded.

## Repo rules

- **The `.mjs` oracles are the contract spec.** If a zod port and `packages/contracts/oracle/*`
  disagree, the port is wrong. Change contracts only by versioning, in both places.
- **Confirmation gates are server-side.** No export/submit route may exist for unverified content
  (spec §8-3). Pipeline stages checkpoint LLM outputs so retries never re-spend.
- **Coding discipline:** simplest thing that works, surgical diffs, no speculative abstractions. Read
  the code a change touches before writing.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API + job store/SSE; the mine → tailor → render preview pipeline (`src/preview.ts`, `prompts/`) |
| `apps/web` / `apps/mobile` | Next.js web shell / mobile client |
| `packages/contracts` | Zod ports of the frozen contracts, golden-tested against the `.mjs` oracle validators (`oracle/`) |
| `packages/api-client` | Typed client shared by web + mobile |
| `packages/ui` | Design tokens |
| `docs/cv-brain/` | **The forked CV brain — source of truth for CV reasoning + research** |
| `docs/`, `Dockerfile*`, `fly.*.toml` | Deploy (`deploy.md`), runbooks, per-slice kickoffs |

## Develop

```sh
pnpm install
pnpm test        # golden contract tests + api tests
pnpm typecheck
pnpm build
node apps/api/dist/main.js   # then: curl localhost:3000/healthz
```

The LLM seam (`apps/api/src/llm.ts`): a real `ANTHROPIC_API_KEY` uses the Anthropic API; local dev
falls back to the Claude Code CLI; tests inject a fake. Model: `claude-sonnet-5`, thinking disabled.
<!-- SHARED:END -->

## Claude Code specifics (private — Claude Code only)

Unlike the JobCrush repo, this repo has **no bundled Claude Code subagents, slash commands, or
CV-lint hooks** — it is a conventional TypeScript monorepo. The CV rules here are enforced by code
(`conservationIssues()` + the zod Draft schema + prompt discipline), not by editor hooks, so there is
nothing that auto-injects the rules on a CV-file edit. When changing miner/tailor prompts or the Draft
schema, open `docs/cv-brain/` yourself as the reference.
