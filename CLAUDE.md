# jobcrush-app — working conventions

<!-- SHARED:START -->
## What this repo is

**jobcrush-app is the hosted JobCrush product** — a Fastify API + Next.js web and mobile thin
clients that let anyone upload a CV and get a tailored, ATS-aware draft. It is the **primary repo for
product development** as of 2026-07-18.

It is a **clean-room repo**: logic is **ported by copying** from the personal-pipeline repo
(`JobCrush`), never imported across repos. The two are separate products and evolve independently.

**Status:** S0 (foundation), S1 (magic-mirror preview), and **S2 (own your facts) are DONE** — S2
closed 2026-07-19: signup wall (magic-link + Google OAuth) → confirm deck → grill → audited root CV
with fix-this review, claim graph v1 in Postgres. **S3 (the hunt) is the next slice** — E5 cluster
engine first.

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

Solo repo, no branch protection. **Stay on `main`.** Don't create branches for ordinary work —
branches + merging exist for teams and PR review, neither of which applies here.

**When a meaningful unit of work lands** (see session hygiene below), git is part of finishing it:

1. **Commit to `main`** with a clear message. Commits are local and reversible — always safe to make.
2. **Run `pnpm test && pnpm typecheck`.** Both green → **push**. Red → fix first; a red push ships a
   broken staging. Pushing is automatic *only when green* — that gate is the safety net.

**CI auto-deploys `main`** to Fly staging (both api + web) on every green push, so **a push is a
deploy**. That is why the green gate is non-negotiable, and why we keep `main` green.

- Use a branch + PR only for a `/code-review` pass or a change risky enough that staging must stay up
  while it is in progress.
- Background-job **worktree isolation** still applies: finish in a worktree, then fast-forward into
  `main` and push-when-green (no PR).

## Keeping the plan honest (session hygiene)

`roadmap.md`, `session-log.md`, and `lessons.md` are the project's memory — keep them current **as part
of the work**, proactively, not only when asked or at session end:

- After a **meaningful unit of work** lands (a ticket, a bug fix, a shippable slice), before moving on:
  add a newest-first `session-log.md` entry with ticket + commit refs, update `roadmap.md` (mark
  done, trim what remains), **then commit and push-when-green** (see Git workflow). "Meaningful" is a
  judgment call — skip trivia; log what a future session would want to know.
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

## Agent skills

This repo runs the **development-lifecycle** workflow (`/grill-with-docs` or `/wayfinder` →
`/to-spec` → `/to-tickets` → `/orchestrate-team`). See `AI/ai-lab/skill_lab/docs/development-lifecycle.md`.

### Issue tracker

Specs and tickets are GitHub Issues in `adrien-mounier/jobcrush-app` (via `gh`). See
`docs/agents/issue-tracker.md`.

### Labels

`ready-for-agent` for agent-grabbable specs/tickets; `wayfinder:*` for wayfinder maps and ticket types.

### Domain docs

Single-context — glossary in `CONTEXT.md`, decisions in `docs/adr/` (both created lazily by
`/domain-modeling`). The CV-reasoning source of truth is `docs/cv-brain/`. See `docs/agents/domain.md`.

### Coding standards

`CODING_STANDARDS.md` — read and cited by the Standards axis of `/code-review`.
<!-- SHARED:END -->

## Claude Code specifics (private — Claude Code only)

Unlike the JobCrush repo, this repo has **no bundled Claude Code subagents, slash commands, or
CV-lint hooks** — it is a conventional TypeScript monorepo. The CV rules here are enforced by code
(`conservationIssues()` + the zod Draft schema + prompt discipline), not by editor hooks, so there is
nothing that auto-injects the rules on a CV-file edit. When changing miner/tailor prompts or the Draft
schema, open `docs/cv-brain/` yourself as the reference.
