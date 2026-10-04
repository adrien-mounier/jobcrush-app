# Writing the lines for a thin job — model comparison (2026-10-03, grilling #326)

**Question.** If discovery stops asking the job family's must-have questions, the app instead *drafts*
the lines a thin job is missing, and the person ticks / edits / drops each one. Can a model draft those
lines without inventing, and which model does it best?

## Contents

- [Method](#method)
- [Scoring](#scoring)
- [Results — Claude](#results--claude)
- [Results — open models on Fireworks](#results--open-models-on-fireworks)
- [Findings](#findings)
- [Open-model shortlist](#open-model-shortlist)
- [Cost of this test](#cost-of-this-test)
- [Re-running it](#re-running-it)

## Method

- **Blind.** The owner's CV v9 (`JobCrush/root_cv/cv_mounier_root_v9.md`) with **every line under the
  BRED job deleted** (`input-full-cv.md`). A second input keeps only the BRED title, dates and degree
  (`input-thin-cv.md`) — the "one job, zero lines" case. No generator ever saw the real BRED lines.
- **The instructions are inside the input files** (rules R1–R6 + output format). Inputs: the IT Project
  Manager family's label, scope and four must-haves (`apps/api/research/it-project-delivery-v2.json`),
  and the CV. Output: each line with its SOURCE, then what was refused and by which rule.
- **Claude runs:** Claude Code CLI, `--tools ""`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (verified to keep
  the owner's personal instructions out of the run), system prompt *"You are a careful CV writer. Follow
  the user's rules exactly."* The top three settings ran 4 times each. Timings were measured with runs in
  parallel, so they are inflated.
- **Open models:** Fireworks chat-completions API, same system prompt and input,
  `reasoning_effort: "high"`, one run each (`run-fireworks.mjs`).
- `outputs/NOT-BLIND_first-simulation-by-session-model.md` is the session model's first attempt, written
  after it had read the real BRED lines. **It is not evidence** — kept so nobody mistakes it for one.

## Scoring

Against the owner's real BRED lines (the ground truth no generator saw):

- **Personal facts found (of 6):** true at BRED and recoverable from elsewhere on the CV — core banking,
  digital banking transformation, teams across Europe / Asia-Pacific / Africa, LLM workflows, external
  vendors, AI workshops. Agile/Scrum (also true) is counted separately: the family scope says "any working
  method", which every Claude run read as a reason to refuse it.
- **Slip:** an unconfirmed BRED-specific claim written as a plain line, without its OPTIONAL / INDUSTRY
  GUESS flag. The flag is what tells the person which lines to check hardest.
- **Invention:** a claim with no source on the CV, or a source from another job presented as BRED's.

## Results — Claude

| Setting | Runs | Personal facts (of 6) | Agile offered | Slips | Inventions | Time / run |
|---|---|---|---|---|---|---|
| **Fable 5.1, max** | 4 | 4, 4, 5, 4 | no | 0 | 0 | 3.5–6 min |
| Fable 5.1, high | 4 | 5, 6, 5, 5 | no | 0, 3, 0, 2 | 0 | ~1 min |
| Opus 5.5, max | 4 | 4, 4, 3, 3 | no | 0 | 0 | 5.5–8 min |
| Sonnet 5.5, max | 1 | 0 | no | 0 | 0 | — |
| Sonnet 5.5, sub-agent default effort (full + thin CV) | 2 | 0 | no | 0 | 0 | ~20 s |
| Sonnet 5, low (closest to the app's setting today) | 1 | 0 | no | 1 | 1 ("resource allocation") | — |

## Results — open models on Fireworks

One run each — less evidence than the four-run Claude settings.

| Model (maker) | Personal facts (of 6) | Agile offered | Slips | Inventions | Time | Cost |
|---|---|---|---|---|---|---|
| Kimi K3 Fast via Fire Pass (Moonshot) | 5 | yes | 3 | 0 | 51 s | $0 if the pass is active |
| Kimi K3 (Moonshot) | 4 | yes | 2 | 0 | 39 s | $0.029 |
| GLM 5.3 (Z.ai) | 4 | yes | 3 | 0 | 52 s | $0.016 |
| GLM 5.3 Flash (Z.ai) | 4 | no | 2 | 0 | 19 s | $0.0014 |
| Nemotron 3 Ultra (NVIDIA) | 3 | yes | 2 | 4 (data governance at BRED, "modernisation", "across jurisdictions", "regulatory audiences") | 59 s | $0.019 |
| Qwen 3.8 Max (Alibaba) | 2 | yes | 0 | 0 | 218 s | $0.139 |
| MiniMax M3 (MiniMax) | 2 | no | 2 | 1 ("financial controls"); past tense for a current job | 68 s | $0.014 |
| gpt-oss-120b (OpenAI, open-weight) | 1 | yes | 4 | 1 (Confluence tied to BRED) | 71 s | $0.009 |
| DeepSeek V4.1 Flash (DeepSeek) | 0 | no | 0 | 0 | 174 s | $0.016 |
| DeepSeek V4 Pro | — | — | — | — | — | listed for the key, but 404 "not deployed" |

## Findings

1. **Recall is a reasoning skill.** The strong models noticed that "Africa" and "core banking" appear
   under no other job, so they probably belong to BRED, and offered them as OPTIONAL lines. Weaker models
   (every Sonnet setting, DeepSeek Flash) refused anything not written under BRED and produced only the
   generic must-haves.
2. **Flag discipline separates the top.** Only Claude Fable 5.1 max and Opus 5.5 max never stated a guess
   as a fact. Every open model that recovered personal facts also slipped at least twice.
3. **No open model matched Fable 5.1 max.** The best open result (Kimi K3 Fast) beat every Sonnet setting
   on recall but slipped like Fable 5.1 high.
4. **Rule R2 works for budget everywhere.** Every model split "budget" into its own OPTIONAL line.
5. **Agile/Scrum:** most open models offered it as OPTIONAL; every Claude run refused it, citing
   "any working method". This is a rules-wording question for the grilling, not a model property.
6. **Runs vary.** The same input gives different wording each time — a drafted line must be generated
   once and stored, never regenerated behind the person's back.

## Open-model shortlist

For this step, if an open model is wanted (licences not checked):

1. **Kimi K3 (Moonshot)** — best open recall. Fire Pass makes Kimi K3 Fast free, **but the Fire Pass
   terms say "non-production coding use only"**, so the app itself cannot run on it. Pay-per-call
   Kimi K3 is about $0.03 a run.
2. **GLM 5.3 (Z.ai)** — close second, about $0.016 a run.
3. **GLM 5.3 Flash (Z.ai)** — same recall as GLM 5.3 at a tenth of a cent and 19 seconds; the value pick.
4. **Qwen 3.8 Max (Alibaba)** — the only open model with zero slips, but low recall and slow.

Not recommended for this step: Nemotron 3 Ultra, MiniMax M3, gpt-oss-120b (each invented BRED facts),
DeepSeek V4.1 Flash (generic only, like Sonnet). Not tested: older versions of the tested families
(GLM 5.2, Kimi K2.6 / K2.7, MiniMax M2.7) and unfamiliar models on the key (ember-1, inkling,
muse-glimmer, qwen3p8-2p4t).

**The app can already call Fireworks** — `FireworksLlm` in `apps/api/src/llm.ts` runs the job-family
labeler (#220). It is not wired to the CV-brain stages, by design: its own comment says a stage moves
there only after that stage's own measurement says it can. Its 60-second timeout and 8,000-token default
would also cut off the reasoning-heavy runs above (Qwen 3.8 Max took 218 s and 22k tokens).

## Cost of this test

- Claude: 14 CLI runs + 2 sub-agent runs, on the Claude subscription (no per-call charge).
- Fireworks: 10 calls, plus 1 retry that returned 404 and was not billed. **About USD 0.25**, computed
  from each response's token counts × the per-token prices on `docs.fireworks.ai/serverless/pricing`
  (read 2026-10-03); raw counts in `fireworks-usage.json`. The Kimi K3 Fast call is $0 only if the
  Fire Pass is active — its status shows only on the Fireworks billing page, which this session could
  not read.

## Cost per run (added 2026-10-04)

Prices from `platform.claude.com/docs/en/about-claude/pricing` (read 2026-10-04): Fable 5.1 $10 in /
$50 out per million tokens; Opus 5.5 $4 / $20. Token counts are the logged averages of the runs above
(output includes reasoning): Fable 5.1 high ≈ 3.3k out, Fable 5.1 max ≈ 21k, Opus 5.5 max ≈ 53k.

| Setting | Pay per call (the deployed app; ~1.6k tokens in) | Subscription via Claude Code CLI (local only), share of a week |
|---|---|---|
| Fable 5.1 high | ≈ $0.18 | ≈ 0.35% of the Fable week |
| Fable 5.1 max | ≈ $1.08 | ≈ 0.5% of the Fable week |
| Opus 5.5 max | ≈ $1.07 | ≈ 0.16% of the all-models week |
| Kimi K3 (Fireworks, measured) | ≈ $0.03 | — |

- **The deployed app always pays per call.** The subscription powers the app only when it runs on the
  owner's laptop through the CLI fallback.
- **Through the CLI, every run carries ~134k tokens of Claude Code's own context**, even with
  `--tools ""` and a custom system prompt. Written to cache cold, that overhead is most of a Fable 5.1
  high run's cost.
- **How the weekly share was estimated.** Anthropic does not publish limits in tokens. All Claude usage
  this machine logged since the weekly reset (2026-09-29 15:59 UTC) was priced at API rates: Fable
  (5 + 5.1) ≈ $523 at a reading of 97% → a Fable week ≈ $540; all models ≈ $646 at 59% → ≈ $1,095.
  This assumes the limit tracks API-equivalent cost. Usage on claude.ai or other devices is not in the
  logs, so the real share per run is at most these figures.

## The full-CV review (added 2026-10-04)

The owner widened the job: for **every** job, fix spelling/grammar, judge each existing line (keep /
untick, never delete), draft missing must-haves, and offer options for vague phrases
(`input-full-review.md`, the real CV with all lines). Two runs, Opus 5.5 at max reasoning:

| | Run 1 | Run 2 |
|---|---|---|
| Output tokens (reasoning share) | 68,674 (95%) | 69,631 (96%) |
| Time | 606 s | 621 s |
| Pay-per-call cost (≈3k in) | ≈ $1.39 | ≈ $1.41 |

- **Fable 5.1 max is estimated, not measured** (the Fable week was 97% used): on the thin-job task
  it produced ~40% of Opus's tokens at 2.5× the price, which puts a full review at **≈ $1.40–1.50 per
  CV**. Measure it after the weekly reset before relying on it.
- **A flaw the runs exposed:** the input judged every job against the IT Project Manager family, so
  Okoone's "+50% advertising revenue" was marked UNTICK as "off-topic for an IT PM role". Relevance to
  a target job is decided per application (ADR-0007), not on the master CV.

## Re-running it

```sh
# Claude — run from a directory with no CLAUDE.md
CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 claude -p --model claude-fable-5-1 --effort max --tools "" \
  --system-prompt "You are a careful CV writer. Follow the user's rules exactly." < input-full-cv.md

# Fireworks — needs FIREWORKS_API_KEY; reads input-full-cv.md from the directory given
node run-fireworks.mjs <dir>
```
