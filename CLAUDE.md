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

### The product proposes stretches — it does not police honesty

**Owner philosophy, 2026-08-04** ([map #127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
decision 9). A CV is a **marketing document**. Stretching adjacent or aspirational experience is a
normal part of getting hired, not lying. When a role wants a signal the candidate lacks, the product
should **propose** it, **soften** it so it stays defensible, and attach a **prepared interview
narrative**. Never refuse, never moralise, never add anti-lying guardrails.

Read `prompts/claim-miner.md` rule 7 (*"Do not invent. Do not improve the candidate"*) in that light:
it governs **reading a CV**, where the machine writes down what is there and nothing more. **It is not
a product-wide honesty mandate and must not be extended into one.**

**The one clause that is not a guardrail, because it is the owner's own:** *the machine never adds
silently; the human owns every stretch.* A parser that quietly upgrades a title is not a stretch — the
person never chose it, never saw it, and **cannot defend it at interview**, which defeats the narrative
that makes stretching safe. **Visible proposal = the product. Silent drift = the bug.** An honest
baseline is the *precondition* for confident stretching, not a limit on it.

**[ADR-0004](docs/adr/0004-each-elements-own-parts.md) clause 1a makes this checkable rather than merely
stated — decided, not yet built.** Every structured fact must **point at its origin**, and a fact
pointing at nothing is a **defect**, not a low-confidence result. *Machine-read* points at the **exact
source words**; *the person said it* points at the **answer and the question that prompted it**;
*corrected* points at the **superseded value**; *proposed and approved* points at the **proposal and its
interview narrative**; *computed* points at the **facts underneath**. **This governs every element — a
job, a title, a date, a degree, a location — not skills alone.**

⭐ **Origin also decides reuse across adverts:** a fact the person **stated, corrected, or that we read
from their CV** is theirs **permanently** and belongs on any tailored CV where it helps — **including a
skill they gave in a grill answer, which is a real fact and not a leak.** Only a
**proposed-and-approved stretch** carries the scope of the advert it was made for.

⚠️ Two things not to get wrong: **nothing checks origins today** (this is a decided shape; the design map
ends at build tickets, so never assume the check exists), and **a check that finds nothing must be
distinguishable from one that did not run** — the failure mode observed three times in one month in the
project this pattern came from.

### A stretch belongs to its advert

**[ADR-0005](docs/adr/0005-a-stretch-belongs-to-its-advert.md), decided 2026-08-06 in
[#141](https://github.com/adrien-mounier/jobcrush-app/issues/141) — decided, not yet built.**

**An approved stretch is a fact about one *application*, not about the person.** The profile holds only
what is true and theirs; stretches live **beside** it, attached to the advert they were approved for. The
leak is therefore **structurally impossible rather than policed** — a later advert's CV writer has nothing
to filter and nothing to fail. This is why *beside* beat *inside with a marked separation*: a separation is
a convention every future reader must remember, and **an absence cannot fail the way a check can.**

Nine clauses; the ADR is the normative home. The ones most likely to be broken by accident:

- **The stretch library proposes; it never adds.** A previously approved stretch reaching a CV without a
  **fresh per-advert approval** reopens ADR-0005 by definition. The pressure to break this will arrive as
  a usability improvement (twenty applications, twenty taps), not as a disagreement.
- **Written once at proposal, frozen at render.** The interview narrative defends *that exact sentence* —
  re-wording it on the way to the page means rehearsing a defence of a line that is not on the CV. Tuning
  happens when a stretch is *proposed* for a new advert, never behind the person.
- **A stretch never graduates into an ordinary fact.** It is **superseded** when the person states the
  real thing. Any automatic promotion (job won, approved N times) is the machine deciding a claim became
  true — the one clause of the marketing-document philosophy the owner named as his own.
- **A stretch may displace a genuine fact, but never invisibly** — and `conservationIssues()` does **not**
  catch this, because it counts fact *classes* and a bullet-for-bullet swap is invisible to it.

⚠️ **The ported enrichment contract is now wrong in four places** — an approved stretch is **not** an
`origin:enrichment` claim-graph node · `originOffer` is **required on approval** · a decline carries a
**scope** (this advert, or never) · an approval **records its parent proposal**. Fix in the zod port
**and** the `.mjs` oracle, per the repo rule that the oracle is the spec.

✅ **The decision-9 reconciliation is settled.** `prompts/claim-miner.md` rule 7 needs **no change** (it
governs reading a CV). #128 §1 governs **facts**, and a proposal is not a fact until approved for a named
advert. **ADR-0002 clause 2 needs a scope note, not an amendment** — it governs thin input on the person's
*own* material, not a stretch. Only that note's exact wording is still open.

### A project is a container, not a fact

**[ADR-0006](docs/adr/0006-a-project-is-a-container-not-a-fact.md), decided 2026-08-06 in
[#146](https://github.com/adrien-mounier/jobcrush-app/issues/146) — decided, not yet built.**

A **project** is a **named container holding ordinary sentences**, exactly parallel to a job:
*section → container → sentences*. Its bullets are **ordinary claims — there is no new sentence type**,
which is the whole reason the element is cheap. The container holds **a name and an optional link, and
no date**; a date the person wrote stays inside their sentence, as their words.

Ten clauses; the ADR is the normative home. The ones most likely to be broken by accident:

- 🚨 **A project is never an employment entry, and never counts towards years of experience.** A project
  title reaching `roles[]` or `Draft.experience` prints as **an employer the person never worked for** —
  decision 9's *the machine never adds silently*, and #138's observed real-parser failure. Unpaid work is
  kept out of the career total by #126's existing ***is this work?*** switch.
- **The section is `Projects`** — *Personal* dropped. 🚨 **`Portfolio` is rejected outright for this
  market**: a defined **PMI** term (a collection of projects and programmes) *and* a banking term, and
  owner decision 8 has the section name **read aloud** during chunked ingestion.
- **A link is not a project.** A GitHub profile, a personal website and a portfolio URL are **contact
  detail** — five shipping tools split them from projects with no dissent. A link *belonging to one
  project* is a field of that project.
- **The tailor may drop a project, but `conservationIssues()` must learn to watch the section.** Today
  projects are invisible to it: all three could vanish from a tailored CV and nothing would say a word.

⚠️ **Two scope notes were written into [ADR-0001](docs/adr/0001-growth-rule-for-structured-facts.md)**,
and both change how a future element is judged:

- 🚨 **Rule 4's *used in matching* gate is satisfied by EITHER matching mechanism.** This product has
  two — the eligibility gates that withdraw a posting, **and the judged score**, where an LLM grades
  each advert requirement against the visitor's confirmed sentences (*"the candidate's own phrasing
  counts"*). **#146 spent two rounds concluding a project could never match, having checked only the
  first. Check both.**
- **Rule 5 sorts *facts* from *preferences*; a container is neither** and skips the sorting test. **The
  tell:** if the new thing holds nothing but a name and the sentences beneath it, it is a container.
- **Rule 4's *"multi-session project"* cost is per-element, not universal.** Projects cost roughly one
  session. Price the element; don't quote the rule.

🚨 **The paper stress test is retired — do not stage a fourth attempt.** Map #127's destination promised
the growth rule would be stress-tested on paper; three tries missed (#125 same element, #140 mechanical
ADR-0003, #146 a container) and **no candidate remains**. **The test transfers to the first element added
after build.** Accepted cost, stated plainly: **we ship a growth rule nobody has stress-tested.**

### What prints is decided per application, not per fact

**[ADR-0007](docs/adr/0007-what-prints-is-decided-per-application.md), decided 2026-08-06 in
[#144](https://github.com/adrien-mounier/jobcrush-app/issues/144) — decided, not yet built.**

**There is no unprintable fact.** Everything we hold may print; what exists is a **withholding pass that
runs per application** and may answer differently next time. **This changes render, never capture** —
#130's *capture the maximum* stands in full.

Eleven clauses; the ADR is the normative home. The ones most likely to be broken by accident:

- ⭐ **The machine never removes silently** — the mirror of decision 9's own clause. Every removal is
  explained, and the person **puts it back for that one application**. A *standing* "always show this"
  setting is the [ADR-0005](docs/adr/0005-a-stretch-belongs-to-its-advert.md) leak shape and was rejected.
- **A country page is a strip-list, never a market style guide.** Seven names — date of birth · age ·
  marital status · photograph · race · religion · gender. **No page means nothing is stripped**, so an
  unresearched market prints everything. The pressure to add CV length, date format, tone and vocabulary
  will arrive as an obvious improvement; that is clause 2's whole point.
- **A withholding never touches the profile**, and every rendering **records which page answered**.
  A withheld fact is **declared to `conservationIssues()`, never discovered by it** — otherwise a
  deliberate withholding is byte-identical to the loss that lint exists to catch.
- **An expired certification prints with its state shown**; the person chooses with the date, **without
  the date**, or not at all. 🚨 **That option stands even on the advert demanding that certification** —
  *propose, never police*; adding a guardrail there is what decision 9 rejected.
- 🚨 **The stretch is deliberately NOT unified with this.** #141 asked that *must-not-print* and
  *prints-only-here* be one mechanism; the answer is **no**. ADR-0005 put a stretch *beside* the profile
  so there is nothing to filter — a shared withholding pass re-introduces the check it dissolved.

⚠️ **ADR-0001 rule 4 gains a third scope note:** **some facts exist only to be printed or withheld and
can never satisfy *used in matching*** (a date of birth, an age, a marital status). They are **not
preferences** — they narrow nothing — so rule 5 still calls them facts. They ship on **four** readers,
with reader 2 **satisfied by the absence being deliberate, not waived**: the element must *state* that no
advert can test it. **Nationality is not in this group.** ⚠️ Discovered on the route, **not** a fourth
stress-test attempt.

🚨 **Two live prompt rules are wrong today.** `prompts/preview-tailor.md` rule 6 tells the tailor
nationality must **never be dropped** — as a *conservation* rule it forbids the pass from ever firing and
must become a **default**. And *"certifications are sacred… never drop, rename, or merge"* needs clause
9's case: a state suffix is not a rename. ✅ **Nationality is never needed to say the useful thing** — the
`work-rights` dimension already asks *"can you work in {city} without sponsorship?"*, and **a photograph
cannot print at all** (the renderer has no image slot).

⚠️ **Singapore's rules bind employers, not our user.** This is a **CV-quality** decision, not a compliance
one. 🚨 **Two things this repo wrote down and got wrong** (corrected 2026-08-06 by
[#151](https://github.com/adrien-mounier/jobcrush-app/issues/151)): *"SGD 50,000 **per violation**"* — it is
the **maximum civil penalty on a first court order against a corporate employer**, for **systemic or severe**
contraventions, and **nothing on a CV triggers it** · and **the Act is the wrong instrument to cite for the
field list** — *"date of birth"* and *"application form"* do not appear in the enacted text. **Cite the
Tripartite Guidelines.**

⚠️ **The country pages are researched and they barely differ** (`docs/research/market-strip-lists.md` +
`last30days-` companion). We serve **Hong Kong, Singapore, Vietnam, Australia** — zero UK, zero EU. **Three
strip all seven**, on three unrelated legal footings. **Vietnam is the only divergence: one certain cell
(gender), one contested (date of birth — our two research halves disagreed; Labour Code Art 16(2) is a
contract-stage duty, Art 8 governs recruitment), and the inert photograph.** ⚠️ **Marital status was expected
to be a keep and is not.** **The design is unchanged; the build priority is not what it looked like.**

⚠️ **Two open items ADR-0007 records but does not decide:** the **graduation year** is the most reliable age
proxy on our CVs and is **not among the seven** — routed to [#143](https://github.com/adrien-mounier/jobcrush-app/issues/143),
not to clause 2 · and this feature **must not be sold as handling discrimination signals**: the **name**
carries most of that signal, and **de-identification is not evidence-backed** (Australia's own randomised
trial found it did not promote diversity).

### A fact is read, worked out, or asked — and a worked-out value is never asked

**[ADR-0008](docs/adr/0008-how-a-fact-arrives-read-worked-out-or-asked.md), decided 2026-08-06 in
[#131](https://github.com/adrien-mounier/jobcrush-app/issues/131) — decided, not yet built.**

A fact arrives one of **three** ways and **keeps that way permanently**: **read** (the words are in the
person's document) · **worked out** (derived from facts we hold) · **asked** (the person supplied it). These
are **ADR-0004 clause 1a's origins seen from the capture side — no new origin is added.** What is added: the
arrival kind is a property of the **fact**, not something that varies per visitor.

🚨 **The binding clause — *the Mei rule*: never ask for a value the machine will regenerate on its own.**
A worked-out value is a regenerable copy (#128 §4) and the facts underneath always win, so the answer has
**no chance of surviving**. **This is the correct scope of #128 §5** — *asked* and *computed* were never
alternatives. A worked-out value is never asked **under any circumstance, including the one where we cannot
work it out**; then we ask for the **missing parts underneath, never the answer on top**. The tell for a
future element: **if a rebuild would overwrite the answer, the question is aimed one level too high.**

Six clauses; the ADR is the normative home. The ones most likely to be broken by accident:

- **A silence in the document is asked, and the answer outranks any later re-read** (#128 §3). This is
  **not** a fallback — nothing regenerates a read fact, so her answer is permanent. ⚠️ **A silence is still
  never an absence**: clause 4 makes it *askable*, not answerable by the machine.
- **The five gated dimensions:** `years-experience` **worked out** (total never asked; missing *dates* are)
  · `work-rights` **always asked** · `degree` + `certification` **read when stated, asked when silent**
  · `language` **split**. 🚨 **Degrees and certifications are askable now and today are not** —
  `ASK_DIMENSIONS` holds three, and `certification` is a **hard advert-side gate the visitor is never asked
  about**, so the card reports the bar untested.
- 🚨 **A level word on the CV does not settle the level.** *"Mandarin (fluent)"* is stored as a sentence,
  not as a graded level — #125's scale is **concrete situations** (*can run a meeting in it*), which
  "fluent" does not answer. Taking the adjective at face value grades her at a level she never chose.

✅ **The failure #131's brief feared was already closed** by a decision taken *after* the brief was written:
*"her CV is in English, so she is fluent"* points at nothing, and **ADR-0004 clause 1a calls that a defect**.

⚠️ **ADR-0001 rule 4 gains a question:** a new element must state **how it arrives**. ⚠️ **Structured facts
break the shipped confirm deck's tiering test** — it batches *verbatim* sentences, but one quoted line
carries several unseen machine decisions including 🚨 ***is this work***, which moves the experience total.
**The promise is in scope and taken; the tap count is interface and is out of scope on map #127.**

**Falsifiable check:** `years-experience` must never appear in `ASK_DIMENSIONS`.

### A project done for an employer stays a bullet

**[ADR-0009](docs/adr/0009-a-work-project-stays-a-bullet.md), decided 2026-08-06 in
[#150](https://github.com/adrien-mounier/jobcrush-app/issues/150) — decided, and the decision is to build
nothing.**

A work project gets **no named container inside the job**: no name field, no client, no project dates, no
nested bullet group. It is written the way our market already writes it — **inside the sentence**
(`Chatbot FINDER: Coordinated development of…`, `a trading platform (Lao Forex Exchange)`, or as a suffix
on the job title). This is the **first "build nothing" pass through ADR-0001 rule 4's gates**, and a
refusal reached by walking the gates is the rule working, not a skip.

Nine clauses; the ADR is the normative home. The ones most likely to be broken by accident:

- 🚨 **A client line is never an employment entry — and no rule covers this today.** `ASSYTEM (client) -
  02/2021 - 05/2021` is a **name plus a date range nested under an employer**, byte-for-byte an employment
  block. ADR-0006 clause 5 forbids a *project* reaching `roles[]`; **nothing forbids a client**, and the
  client is the one that looks exactly like a job. It is blocked today only by the accident that
  `MinedRole.title` is `min(1)` and a client block has no title — **#126 rewrites that record.** This is
  the one build consequence and it lands with #126.
- **The project name must survive into the bullet.** It does today, but nothing *states* it, so a tailor
  rewrite could drop `Chatbot FINDER:` as a redundant prefix — and **`conservationIssues()` counts fact
  classes and would not catch it**, the same blind spot ADR-0005 records for a stretch swap.
- 🚨 **Two corpus facts this repo wrote down and got wrong**, corrected in clauses 2–4: **0 of 18** of
  Thomas Chauviere's named projects carries a date of its own and **10 of 18** have no bullets — the rich
  shape #150 described exists **four times, in one job of one CV** · and the **7:1 ratio is one document
  from another market** (façade engineering). Across the **five** CVs in banking / IT-PM the count is
  **zero**. Also: Adrien's `Project Achievements` is a **label over a second bullet list**, not project
  entries — `personal-projects-on-a-cv.md` carries the correction.
- **Naming buys nothing in matching, checkably.** `buildJudgeInput()` hands the grader a flat `id`/`text`
  list with **no employer, no job, no grouping** — the job container is already invisible to it. The
  remaining gain is a tidier page, which #150's own Q3 pre-committed to the **design effort**.
- ⚠️ **Decided before #126 deliberately.** Carving a container out of today's job bullets is **ADR-0001's
  employer case**; it is free *only* because the job record does not exist yet. **Cheap today, a migration
  after #126** — which is why it was recorded now rather than left on the ticket.

⚠️ **Not a stress-test attempt.** ADR-0006 clause 10 retired the paper test; #150 proposes no new element
at all. ✅ **#150's Q5 is closed:** the confidential-client convention (sanitise to *"a leading global
bank"*, keep the engagement) is uniform with no dissent — it **removes an objection to building and
supplies no reason to build**, and it makes the client hazard worse, not better.

**Falsifiable checks:** `Draft.experience` holds no project or client slot · a work project's name lives
**inside** a claim's text, never as a field beside it.

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
