# jobcrush-app — working conventions

## What this repo is

**jobcrush-app is the hosted JobCrush product** — a Fastify API + Next.js web and mobile thin
clients that let anyone upload a CV and get a tailored, ATS-aware draft. It is the primary repo for
product development. Current status lives in `roadmap.md`.

It is a **clean-room repo**: logic is **ported by copying** from the personal-pipeline repo
(`JobCrush`), never imported across repos. The two are separate products and evolve independently.

## The two rules that break everything if broken

- **The `.mjs` oracles are the contract spec.** If a zod port and `packages/contracts/oracle/*`
  disagree, the port is wrong. Change contracts only by versioning, in both places — zod port and
  oracle together.
- **`routes/onboarding.ts` is a ratchet — it may only shrink.**
  `apps/api/test/onboardingRatchet.test.ts` fails any push that grows the file. New logic goes in
  its own module beside the subsystem it belongs to; the route entry stays thin (new endpoints are
  fine that way). If your ticket touches an in-file helper (`buildJobCard`, `buildTailorState`, …),
  move it out as part of the ticket and lower the limit. Raising the limit requires the owner's
  explicit OK, recorded in the commit message — the pressure to raise it will arrive looking like a
  reasonable improvement; the right response is extraction.

## Architecture decisions live in `docs/adr/`

Every decided design shape is recorded in `docs/adr/`. **Read the relevant ADR before touching
capture, render, or the claim graph.** The ADRs are the normative home; most are decided but not yet
built, so confirm in code before relying on any check one describes.

## Relationship to the JobCrush repo (read this before touching CV logic)

- **This repo owns the CV brain.** CV-tailoring reasoning + research live in
  [`docs/cv-brain/`](docs/cv-brain/README.md) — forked from JobCrush 2026-07-18, evolving here
  independently. Do all CV-reasoning work here; JobCrush is frozen for CV logic.
- **No two-way sync, ever.** If an improvement here also helps JobCrush's pipeline, port that single
  insight by hand — a silent two-way sync is the drift that caused the JC-2 rating failure.
- Full boundary record: JobCrush's `docs/boundary-with-jobcrush-app.md`.

## The CV brain is the source of truth

`docs/cv-brain/` is what the pipeline must stay true to: `cv-authoring-rules.md` (output +
writing-style rules), `tailoring-reasoning.md` (taxonomy, classification, gap handling, the
conservation principle), `research/`. The pipeline that implements it:
`apps/api/prompts/{claim-miner,preview-tailor}.md` and `apps/api/src/preview.ts` (the canonical
Draft schema + `conservationIssues()` lint — the mechanical enforcement of **"tailor by emphasis,
not amputation"**). Change the rules → update `docs/cv-brain/` too; it is the reference, not a copy
to let rot.

**Owner philosophy (map #127 decision 9):** a CV is a marketing document. The product **proposes**
stretches, softens them so they stay defensible, and attaches an interview narrative — it never
refuses, moralises, or adds anti-lying guardrails. The one clause that is the owner's own: *the
machine never adds silently; the human owns every stretch.* Visible proposal = the product; silent
drift = the bug. ADR-0004/0005 carry the full shape.

## Git workflow

Solo repo, no branch protection. **Stay on `main`** for ordinary work.

When a meaningful unit of work lands (see session hygiene):

1. **Commit to `main`** with a clear message — commits are local and reversible, always safe.
2. **Run `pnpm test && pnpm typecheck`.** Both green → **push**. Red → fix first. **CI auto-deploys
   `main` to Fly staging on every green push, so a push is a deploy** — the green gate is
   non-negotiable.

**`Closes #123` on its own line ends a finishing commit — written only after `/qa-gate` returns
GO.** The keyword acts on push, the same moment the deploy does, so a `Closes` written earlier
marks the board done for work nothing verified. `(#123)` alone links and never closes: the git log
is full of it, and copying that habit is how finished work keeps sitting on the board as available.
Reference a parent/map issue and close only the child. Work with no code commit behind it — a
decision, a research pass — closes by hand, with a comment naming the commit.

Use a branch + PR only for a `/code-review` pass or a change risky enough that staging must stay up
while it is in progress. Background-job worktree isolation still applies: finish in a worktree,
fast-forward into `main`, push-when-green (no PR).

## Keeping the plan honest (session hygiene)

`roadmap.md`, `session-log.md`, and `lessons.md` are the project's memory — keep them current as
part of the work, not only at session end:

- After a meaningful unit of work lands: add a newest-first `session-log.md` entry with ticket +
  commit refs, update `roadmap.md`, then commit and push-when-green. Skip trivia; log what a future
  session would want to know.
- When you learn something non-obvious that would save future-you time, add a short `lessons.md`
  entry — genuinely reusable insight only.

The `close-session` skill does the full end-of-session sync; this rule keeps the docs honest
between those.

## Repo rules

- **Confirmation gates are server-side.** No export/submit route may exist for unverified content
  (spec §8-3). Pipeline stages checkpoint LLM outputs so retries never re-spend.
- **Coding discipline:** simplest thing that works, surgical diffs, no speculative abstractions.
  Read the code a change touches before writing.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API + job store/SSE; the mine → tailor → render preview pipeline (`src/preview.ts`, `prompts/`) |
| `apps/web` / `apps/mobile` | Next.js web shell / mobile client |
| `packages/contracts` | Zod ports of the frozen contracts, golden-tested against the `.mjs` oracle validators (`oracle/`) |
| `packages/api-client` | Typed client shared by web + mobile |
| `packages/ui` | Design tokens |
| `docs/cv-brain/` | The forked CV brain — source of truth for CV reasoning + research |
| `docs/`, `Dockerfile*`, `fly.*.toml` | Deploy (`deploy.md`), runbooks, per-slice kickoffs |

## Develop

Standard pnpm monorepo — commands are in `package.json`. Smoke test after a build:
`node apps/api/dist/main.js`, then `curl localhost:3000/healthz`.

The LLM seam (`apps/api/src/llm.ts`): a real `ANTHROPIC_API_KEY` uses the Anthropic API; local dev
falls back to the Claude Code CLI; tests inject a fake. Model: `claude-sonnet-5`, thinking disabled.

## Agent skills

This repo runs the **development-lifecycle** workflow from the **mattpocock-skills plugin**
(`/grill-with-docs` or `/wayfinder` → `/to-spec` → `/to-tickets` → `/implement` → `/code-review`),
plus the local **`/qa-gate`** skill: after `/implement` + `/code-review` and before any commit, the
independent `qa-tester` agent re-runs the gates, audits every acceptance criterion, and drives the
real app in a browser with evidence — commit only on GO.

  **This file outranks a skill's own closing line.** `/implement` ends with "commit your work to
  the current branch" and names neither a gate nor a tracker — it is written for repos with
  neither. The instruction in front of you is not the outer one.

- **Issue tracker:** specs and tickets are GitHub Issues in `adrien-mounier/jobcrush-app` (via
  `gh`). See `docs/agents/issue-tracker.md`. Labels: `ready-for-agent`, `wayfinder:*`.
- **Domain docs:** glossary in `CONTEXT.md`, decisions in `docs/adr/`. See `docs/agents/domain.md`.
- **Coding standards:** `CODING_STANDARDS.md` — read and cited by the Standards axis of
  `/code-review`.

## Claude Code specifics

Unlike the JobCrush repo, this repo has no bundled Claude Code subagents, slash commands, or CV-lint
hooks — it is a conventional TypeScript monorepo. CV rules are enforced by code
(`conservationIssues()` + the zod Draft schema + prompt discipline). When changing miner/tailor
prompts or the Draft schema, open `docs/cv-brain/` yourself as the reference.
