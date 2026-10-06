# jobcrush-app — working conventions

## What this repo is

**jobcrush-app is the hosted JobCrush product** — a Fastify API + Next.js web and mobile thin
clients that let anyone upload a CV and get a tailored, ATS-aware draft. It is the primary repo for
product development. Current status lives in `roadmap.md`.

It is a **clean-room repo**: logic is **ported by copying** from the personal-pipeline repo
(`JobCrush`), never imported across repos. The two are separate products and evolve independently.

## v1 scope and the golden rule (owner decision, 2026-09-26)

**v1 is the product that works for its one real user.** The owner — an IT project manager /
product owner — pastes a real job posting he'd actually apply to, runs it through the app end to
end, and it hands him a CV good enough that he chooses to send it himself. The paste-a-job-ad door
is the way in; the deck stays live but off the critical path. **No real visitors while this scope
holds** (#288 un-parks first the day that changes). Every phase `roadmap.md`'s Milestones lists as
parked (full tables in `docs/archive/roadmap-2026-10-06.md`) remains the final product — parked, not
cancelled.

**The golden rule — built for one user, designed for many.** No schema, contract, or code path may
hardcode the owner's case: job families stay plural and growable, markets stay a parameter,
vocabularies stay lists that grow. The IT-PM/product-owner narrowing lives only in the quality bar
and the test data, never in the data model. The boundary: the rule protects data models, contracts,
and code paths — it does not license building features for users who don't exist yet; those stay
parked.

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

## The CV brain is the source of truth (read before touching CV logic)

[`docs/cv-brain/`](docs/cv-brain/README.md) is what the pipeline must stay true to:
`cv-authoring-rules.md` (output + writing-style rules), `tailoring-reasoning.md` (taxonomy,
classification, gap handling, the conservation principle), `research/`. The pipeline that implements
it: `apps/api/prompts/{claim-miner,preview-tailor}.md` and `apps/api/src/preview.ts` (the canonical
Draft schema + `conservationIssues()` lint — the mechanical enforcement of **"tailor by emphasis,
not amputation"**). Change the rules → update `docs/cv-brain/` too; it is the reference, not a copy
to let rot.

**Do all CV-reasoning work here.** The brain was forked from JobCrush 2026-07-18 and evolves here
independently; JobCrush is frozen for CV logic. **No two-way sync, ever** — if an improvement here
also helps JobCrush's pipeline, port that single insight by hand; a silent two-way sync is the drift
that caused the JC-2 rating failure. Full boundary record: JobCrush's
`docs/boundary-with-jobcrush-app.md`.

**Owner philosophy (map #127 decision 9):** a CV is a marketing document. The product **proposes**
stretches, softens them so they stay defensible, and attaches an interview narrative — it never
refuses, moralises, or adds anti-lying guardrails. The one clause that is the owner's own: *the
machine never adds silently; the human owns every stretch.* Visible proposal = the product; silent
drift = the bug. ADR-0004/0005 carry the full shape.

**Before pricing a CV-reasoning feature, read what the owner's cv-factory produces**
(`C:/Users/adrie/AI/cv-factory/job_offers/*/report.md`) — the running reference implementation.

## Git workflow

Solo repo, no branch protection. **Stay on `main`** for ordinary work.

When a meaningful unit of work lands (see session hygiene):

1. **Commit to `main`** with a clear message — commits are local and reversible, always safe.
2. **Run `pnpm test && pnpm typecheck`.** Both green → **push**. Red → fix first. **CI auto-deploys
   `main` to Fly staging on every green push, so a push is a deploy** — the green gate is
   non-negotiable.

   One exception: **a docs-only push runs no CI and does not deploy** (the `paths-ignore` list
   in `.github/workflows/ci.yml`). `apps/api/prompts/*.md` are the product, not documentation — they
   are code and still gate the deploy. Run the pipeline by hand on a skipped push with the
   workflow's `workflow_dispatch`. **A superseded run is cancelled**, so pushing again supersedes the
   previous push's checks. Nothing a test reads may live under a `paths-ignore` path (`docs/**`) — a
   docs-only edit would then break `main` on exactly the push that skipped the suite.
3. **`pnpm test` runs no browser tests.** Before calling a slice done, run the browser specs and
   journeys the diff can reach (`e2e:mocked`, `e2e:tier2` in `apps/web`) — a contract or shared-step
   change lands there, not in the unit tier.

**Stage files by name — never `git add -A`.** Scratch scripts, screenshots and workspace copies live
in the session scratch dir, never under the repo (a copied `apps/web` once broke every gate).

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
  session would want to know. Caps (enforced by `close-session`): entries ≤ ~10 lines, the file
  keeps the last ~10 — older ones move unedited to `docs/session-log/YYYY-MM.md`; `roadmap.md` is
  one screen that links the tracker, never copies it (history: `docs/archive/`).
- When you learn something non-obvious that would save future-you time, add a short `lessons.md`
  entry under its topic (~40 lessons max). A lesson that has become an always/never rule goes into
  this file or `CODING_STANDARDS.md` instead, where every session sees it.
- When you disprove a claim, grep for every copy and correct the source document first.
  `session-log.md` entries are history: annotate with a dated correction, never rewrite.
- Commit research and evidence files an ADR or doc cites — background agents are told not to
  commit, so the session that receives the artifact does.
- A reference doc over ~100 lines opens with a `## Contents` list; this file, injected whole, has none.

The `close-session` skill does the full end-of-session sync; this rule keeps the docs honest
between those.

## Repo rules

- **Confirmation gates are server-side.** No export/submit route may exist for unverified content
  (spec §8-3). Pipeline stages checkpoint LLM outputs so retries never re-spend.

## Layout

Standard pnpm monorepo (`apps/{api,web,mobile}`, `packages/`, `docs/`). The non-obvious parts:
`packages/contracts` holds the zod ports, golden-tested against the `.mjs` oracle validators in
`oracle/`; `packages/ui` is design tokens only; deploy lives at the root (`docs/deploy.md`,
`Dockerfile*`, `fly.*.toml`).

## Develop

Commands are in `package.json`. Smoke test after a build:
`node apps/api/dist/main.js`, then `curl localhost:3000/healthz`. Bypass the turbo cache with
`TURBO_FORCE=1 pnpm test` (never `pnpm test -- --force`, which vitest rejects); prefer `pnpm test`
over raw vitest, which can't resolve an unbuilt `@jobcrush/contracts`. **`vitacairn` shares this
machine, the Fly/Cloudflare accounts and ports 3000/3001** (`../SHARED_INFRA.md`): drive locally on
free high ports, prove *which* server answered, and kill only what you started.

The LLM seam (`apps/api/src/llm.ts`): a real `ANTHROPIC_API_KEY` uses the Anthropic API; local dev
falls back to the Claude Code CLI; tests inject a fake. Model: `claude-sonnet-5`, thinking disabled.

## Agent skills

The lifecycle is the plugin's, plus the local **`/qa-gate`**: after `/implement` + `/code-review`
and before any commit, the independent `qa-tester` agent re-runs the gates, audits every acceptance
criterion, and drives the real app in a browser with evidence — commit only on GO.

  **This file outranks a skill's own closing line.** `/implement` ends with "commit your work to
  the current branch" and names neither a gate nor a tracker — it is written for repos with
  neither. The instruction in front of you is not the outer one.

  **A ticket is not done at "the code works" — it is done at GO.** `/implement` → `/code-review`
  → `/qa-gate` is one unit of work: carry it to the end yourself, and let the gate verdict be the
  next thing you bring the owner. A status report handed over mid-lifecycle reads as "finished"
  for work nothing has verified. Bring the owner a decision — GO/NO-GO, or a genuine blocker.

  **Enforced, not written:** a commit hook refuses any `git commit` touching code until
  `/qa-gate` has recorded a GO for the current HEAD. Docs-only commits pass freely.

- **Issue tracker:** specs and tickets are GitHub Issues in `adrien-mounier/jobcrush-app` (via
  `gh`). See `docs/agents/issue-tracker.md`. Labels: `ready-for-agent`, `wayfinder:*`.
  - Read a ticket with `--comments` (decisions often live there) and check every AC and premise
    against HEAD before designing — the tracker lags the code by design.
  - A stale or contradicted AC is the owner's call: build the later decision and quote both sources
    to him; never retire an AC yourself.
  - A deferral, or a closing decision/research ticket, names a *filed* ticket for the follow-up —
    file it in the same breath; a roadmap phrase is invisible to every frontier query.
  - On PowerShell, pass bodies with `--body-file` (a here-string splits into many args) and read
    `gh api` with `--jq` (`ConvertFrom-Json | Select-Object` prints blank rows that look like "none").
    A 422 "already been taken" on `blocked_by` means the edge already exists.
- **Domain docs:** glossary in `GLOSSARY.md`, decisions in `docs/adr/`. See `docs/agents/domain.md`.
- **Coding standards:** `CODING_STANDARDS.md` — read and cited by the Standards axis of
  `/code-review`.

