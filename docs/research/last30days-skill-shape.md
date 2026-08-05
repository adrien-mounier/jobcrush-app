# Skill shape — what the last 30 days actually says

Research leg for [#145](https://github.com/adrien-mounier/jobcrush-app/issues/145) (recent-movement half;
the deep-sources half is `last30days-career-data-standards.md` / `cv-elements-existing-data-standards.md`).

**Window:** 2026-07-06 → 2026-08-05. **Run date:** 2026-08-05.

---

## Bottom line

**Option (c) is not a design bet. It is what the two biggest live products in this space already
ship, and they arrived at it independently.**

The session's recommendation — store the person's verbatim line *and* the atomic terms inside it,
linked — is implemented right now in `santifer/career-ops` (62,886★, pushed today) and
`srbhr/Resume-Matcher` (28,026★, pushed today). Both split a candidate's skills into **"named in the
skills section"** vs **"present only in the prose of a job"** and treat the two differently. Both keep
the raw string. Neither collapses one into the other. That is our (a) and (b) coexisting, which is (c).

Three things move the decision beyond that confirmation:

1. **Do not buy or target a taxonomy.** ESCO/Lightcast/O*NET normalisation is effectively abandoned in
   open practice. In the last 30 days GitHub saw **4,046** repos pushed matching `resume ATS` and
   **1,179** matching `resume parser` — against **11** for `ESCO skills`, **9** for `O*NET skills` and
   **1** for `Lightcast skills`. The best ESCO extractor on GitHub has 27 stars and has not been
   touched since 2025-06-12. Both big live repos deliberately use a **small hand-curated vocabulary**
   instead, and explicitly refuse umbrella aliases. #138's F1@5 = 0.72 is a real number about a
   question nobody in production is asking.

2. **"The machine never adds silently" has a shipped shape — copy it.** Resume-Matcher's
   `verify_skill_target_plan()` lets an LLM *propose* skills, then a **deterministic non-LLM verifier**
   stamps each proposal with a provenance label (`existing` / `jd_added` / `supported_by_resume` /
   `unsupported`) plus a human-readable `reason`, rejects the last class, and shows the rest to the
   user in a diff before save. That is owner decision 9 and Q6, already built, in a 28k-star repo. It
   also answers Q2's hard requirement: the failure is **detectable** because every accepted skill
   carries why it was accepted.

3. **The sharpest finding is a warning, not a pattern.** career-ops' anti-fabrication gate failed
   **three separate times in the last 30 days**, and its failure mode is to report success. On
   2026-08-03 a contributor found the gate was **completely inert in five shipped locales** and still
   printed `pass` — *"which is worse than saying nothing: it manufactures confidence."* If we build a
   fabrication check, the check itself needs a check, and "found nothing" must never render as "nothing
   wrong."

**What this does not resolve:** self-assessed proficiency at 40+ skills has **no supporting evidence
anywhere** — nobody has made it work, and one shipped system actively treats proficiency words as
noise to be stripped. And skill recency (Q5) I could not answer; my search terms were too generic to
produce a trustworthy signal, and I would rather report that than invent one.

---

## Findings by theme

### 1. Q1 — Two-level granularity is shipped, twice, and it is the *same* two levels

`career-ops/jd-skill-gap.mjs` (a zero-LLM, regex-based checker) classifies every job-advert
requirement against the CV into exactly three buckets:

> ```
> existing            — already a named skill in cv.md's Skills section
> supportedByResume   — not a named skill, but appears in prose elsewhere in cv.md
> gap                 — JD requires it, cv.md has no trace of it at all
> (nothing is ever auto-added — this tool only classifies and reports)
> ```

The `existing` vs `supportedByResume` split **is our fork**. It is the difference between Remy's
skills-section `C#` and the `C#` living inside `(C#, XrmToolBox, Git)` on a job bullet. A shipped
system found it necessary to distinguish them — which is evidence for (c) over either (a) or (b)
alone.

Resume-Matcher has the same distinction as its `supported_by_resume` bucket, and career-ops credits it
directly: the three-way split is *"inspired by the skill-verification pattern in srbhr/Resume-Matcher
… specifically their four-way `verify_skill_target_plan()` split."* Two independent codebases,
converging.

**On the display side, the last 30 days moved toward atomic.** Resume-Matcher PR
[#875](https://github.com/srbhr/Resume-Matcher/pull/875) (2026-07-07) replaced comma-joined skill
strings with individual pill tags across its templates, explicitly because *"when items were stored as
a single string … the result was `JavaScript Python React` with no visual separation at all."* Their
storage was already an array; the bug was rendering it as one run of text. That is the (c) failure
mode our issue predicts ("every screen must know which to show") showing up in someone else's product
as a real bug.

**Cost evidence for (c), from the field:** career-ops shipped bug #1851 — a CV writing `k8s` failed to
suppress a job advert's `Kubernetes`, reported as a false gap — because **three parallel copies of the
skill vocabulary had drifted apart**. The fix (#1896) was to extract one shared
`skill-extract.mjs` module and route every call site through it. The two-level design's real cost is
not storage duplication; it is **vocabulary drift between the places that read it.**

### 2. Q2 — Nobody normalises to a taxonomy; they curate ~90 tokens and refuse to guess

`career-ops/skill-extract.mjs` is the whole normalisation layer, and its design notes are the most
useful primary evidence I found:

> Exact-alias canonicalization ONLY (lowercased match → display name). **Deliberately no umbrella
> aliases: "cloud" must never count as knowing AWS/GCP/Azure — a generous map silently suppresses real
> gaps**, and the "cv skill never appears as gap" acceptance test rewards exactly that

And: `canonicalize()` **passes unknown tokens through unchanged**. An unrecognised skill is not
dropped and not guessed at — it survives verbatim. That is ADR-0003 clause 2's pattern (store the
typed words always; add the resolved record when we can; a failed match loses nothing) arrived at
independently by someone with 62k stars.

Two concrete traps they hit that our corpus will hit too:

- `Go` cannot join a case-insensitive token list ("go the extra mile" would register a skill), so it
  gets a separate **case-sensitive** pass, and a trailing hyphen disqualifies it ("Go-to-market",
  "Go-live" are not the language).
- `\b` fails at symbol edges, so `C++`, `C#` and `.NET` **never match standalone** with a naive word
  boundary. They use `(?<!\w)…(?!\w)`.

Remy's CV has `C#` five times. A naive atomiser gets zero of them.

**The asymmetry rule they encode is worth stealing verbatim:** the JD extractor is *"deliberately
conservative: under-extracting (missing a skill) is recoverable by the user reading the JD themselves;
over-extracting noise into 'required skills' is not."*

### 3. Q2/Q6 — The shipped answer to "the machine never adds silently"

Resume-Matcher's flow, in order:

1. `generate_skill_target_plan()` — an **LLM proposes** target skills, each with a `reason`.
2. `verify_skill_target_plan()` — a **deterministic Python verifier** classifies every proposal:

| Bucket | Meaning | Outcome |
|---|---|---|
| `existing` | already in the résumé's skills list | accepted, "low-risk" |
| `jd_added` | required/preferred by the job advert | **accepted as an explicit proposal for user review** |
| `supported_by_resume` | appears in the résumé text but not the skills list | accepted |
| `unsupported` | in neither the résumé nor the advert | **rejected, and returned in a `rejected` list** |

The code comment on `jd_added` is, almost word for word, our owner decision 9:

> JD-required/preferred skills are accepted as targets so the résumé can be tailored to actually pass
> ATS/recruiter screening — **adding relevant JD skills is the product's purpose.** (Truly unsupported
> skills — neither in the JD nor the résumé — are still rejected below.) **The user reviews additions
> in the diff preview before save.**

Three properties we should copy: **provenance is a stored field on the skill, not a rule in a prompt**;
**rejected proposals are returned rather than silently dropped**; and **the human sees a diff**.
career-ops folded the four buckets to three precisely because *"career-ops never auto-adds a claim to
cv.md either way — their `jd_added`/`unsupported` distinction only matters if a tool is allowed to add
something automatically."* We *are* that tool. We need the four.

### 4. The three failures of the anti-fabrication guard, all within 30 days

This is the finding I would put in front of the owner. career-ops enforces the rule *"Keywords get
reformulated, never fabricated. Reorder, reframe, emphasise — but never invent"* — our conservation
principle, near-verbatim — via `verify-cv-facts.mjs`, described in its own docs as *"a hard gate before
PDF rendering."* In the last 30 days it broke three separate ways:

| Date | What | Why it matters to us |
|---|---|---|
| 2026-07-29, [#2279](https://github.com/santifer/career-ops/issues/2279) | Modifier-count asymmetry: the gate **failed truthful CVs**, and could **hide a changed number** | *"The safe reflex (loosen the claim, add an exception) quietly weakens the guard that exists to catch real fabrications."* A noisy gate trains users to disable it. |
| 2026-07-31, [#2395](https://github.com/santifer/career-ops/issues/2395) | The anti-fabrication and authorship RULES were **missing from 16 of 18 localized prompt files** | *"For those languages the rule does not exist at any layer: not in code, not in a test, and not as an instruction the agent reads."* A prompt-level rule is not a control. |
| 2026-08-03, [#2460](https://github.com/santifer/career-ops/pull/2460) (merged 08-04) | Every claim pattern used ASCII `\d`, so the gate was **inert in `ar`, `hi`, `ja`, `zh`, `zh-TW`** and returned a clean pass | *"It says `pass`, which is worse than saying nothing: **it manufactures confidence**."* |

The same lesson appears independently in their hiring-manager audit mode (`modes/pdf/hm-audit.md`),
which refuses to pass empty buckets downstream:

> If it prints a `🚨 LOW CONFIDENCE` diagnosis (`no-requirements-section`, `no-skill-candidates`, or
> `empty-jd`), the check did not run and **an empty `gap` list is not "no gaps."** Treat the
> classification as unavailable … **never hand over empty buckets, which read as fit confirmation the
> check never established.**

**Design rule for us:** a skill check that finds nothing must be distinguishable from a skill check
that did not run. Both of career-ops' independent brushes with this problem produced the same answer.

Issue #2395's proposed fix is also worth stealing: machine-readable guardrail markers
(`<!-- guardrail:no-fabrication -->`) plus a test that enumerates every file and asserts the marker is
present — so a rule cannot go missing silently.

**And the named failure mode is ours.** career-ops' top guardrail rule reads:

> **RULE: NEVER claim the user authored a project, repo, library, tool, framework, or open-source
> artefact unless explicitly attributed to them in cv.md.** **Tool-of-trade conflation (user uses X →
> user built X) is the most common fabrication pattern** and is forbidden.

Atomising `(C#, XrmToolBox, Git)` into three standalone skill records is exactly the operation that
strips the verb. The sentence that said *used* is gone, and the record is one careless render away from
implying *built*. This is the strongest evidence in this report **against (b) alone** and for keeping
the verbatim line permanently attached.

### 5. Q3 — Self-rated proficiency: no evidence for it, and one shipped system strips it

I found **nobody** who collects self-assessed proficiency across a large skill set and reports it
working. What I did find:

- career-ops puts `proficiency`, `fluency`, `expertise`, `demonstrated`, `extensive` on a **stoplist**
  of bullet-openers that *"read as skills but describe the candidate's disposition, not a
  technology."* Proficiency language is treated as **noise to be discarded**, not data to capture.
- The only visible discourse is résumé-advice SEO content (VerifyEd, ResumeGenius, Monster,
  ResumeWorded, Resumemate — all commercial content marketing, **low trust**, and all published or
  refreshed for the 2026 keyword). Even that corpus lands against it: *"hiring managers tend to be wary
  of applicants' assessment of their own skills"* and *"in most cases, you don't need to add skill
  levels to your resume — employers are usually more interested in how you've applied your skills."*

**Treat Q3 as answered in the negative by absence.** #138 found LinkedIn retired skill assessments and
HR Open declines to define a scale; 30 days of movement adds no counter-example. If the owner's
"ask the person once" pattern is applied at 45 skills, we would be the first to try it, with no prior
art to borrow and one shipped system arguing the field is noise.

### 6. Q4 — Mention-sites: no prior art found, and that is a real finding

`supported_by_resume` / `supportedByResume` is the closest thing that exists: both repos record
**that** a skill appears in the prose of the CV. Neither records **which job**. The location is
computed and thrown away.

Our corpus hands us `(Splunk, Control-M, Bash, Linux)` sitting on Amundi Singapore 2023–2025 — the
when and where, for free. I found no shipped system that keeps it. That means no design to copy and no
cautionary tale either; it is genuinely open ground.

### 7. Q5 — Recency: unanswered, honestly

I could not establish whether skill recency is used in practice. My GitHub code searches for
`lastUsedDate` and equivalents returned tens of thousands of hits that are token-noise, not signal, and
I will not launder that into a conclusion. No recent discussion surfaced on any platform. **#138's
finding stands unchallenged and unconfirmed: `lastUsedDate` appears in one standard and I have no
evidence anyone fills it.**

### 8. What shipped or died

- **JSON Resume: confirmed dead, and worse than reported.** `resume-schema` (2,396★) is
  `archived: true`, last push **2026-06-12** — exactly as the prior research found. But the same day
  they also archived **`resume-cli` (4,719★)** and `rust-json-resume`. **27 of the org's 32 repos are
  now archived.** The schema *and* its reference implementation went together. Only the website
  (pushed 2026-07-29), a theme, and a small `mcp` repo (61★, pushed 2026-06-12) remain live. Do not
  cite JSON Resume as a live standard.
- **CareerGraph: the picture moved, in the direction the prior research implied.** Now **37** repos
  named CareerGraph; **two more created in the last 48 hours** (2026-08-04, 2026-08-05). Every single
  one in the last 30 days is at **0 stars**. Nobody is winning this; everybody is starting it.
- **The ESCO tooling shelf is stale.** Top ESCO extractor `KonstantinosPetrakis/esco-skill-extractor`
  27★, last push 2025-06-12. `jensjorisdecorte/Skill-Extraction-benchmark` (the benchmark #138's F1
  numbers come from) 17★, last push **2024-07-18**. `AnasAito/SkillNER`, the best-known skill NER
  library at 214★, last push **2024-01-28**. None archived — just abandoned.
- **Vendors: consolidation, not shutdown, and no 30-day movement.** Lightcast Open Skills is still live
  (35,000+ skills). Lightcast acquired Skill Collective (Dec 2025). SkyHive now sits inside Cornerstone.
  Nothing in the window.
- **The live things are agent-native, not schema-native.** The two repos that matter both run as local
  agent workflows over Markdown/YAML files, not as services over a normalised skills database.

### 9. Skills-based hiring and skill stuffing — weak evidence, consistent direction

**Neither of these has real practitioner discussion in the window.** Everything below is survey PR or
SEO content; weight accordingly.

- Adoption headline numbers are high and self-reported: NACE Job Outlook 2026 says 70% of employers
  use skills-based hiring (up from 65%); other reports claim 85%. But the gap is the story — one
  audit-style piece reports 82% claim adoption while **68% of those same companies have implemented no
  certifications or job-relevant evaluations**, and Forbes (2025-12-15) reports **only 46% plan to
  expand it in 2026, with 53% citing verifying skill claims as the blocker**. Skills assessment happens
  at **interview (87%)**, not at machine-screening.
- **Direct implication for us:** no employer is filtering on a structured skill vocabulary we would
  need to be comparable to. **Our skill records need to be comparable to our own adverts, not to
  anyone else's taxonomy.** That materially lowers the cost of *not* normalising to ESCO.
- On stuffing, the SEO corpus is unanimous that long skill lists now read as a negative signal
  ("stop at 14 skills", "listing 50 vague skills is less effective", "modern ATS penalize keyword
  stuffing"). **I would not act on the specific numbers** — they are content-marketing claims with no
  method behind them. The directional point is still live for us: a 45-skill atomic list, rendered
  naively, is the exact shape being described as a tell.

---

## What each platform yielded

| Platform | Yield | Notes |
|---|---|---|
| **GitHub** | **Everything.** All load-bearing evidence in this report | Issue trackers, PR bodies and source-file design comments are where this subject is actually discussed. PR #2460 and issue #2279 are better primary sources than any article. |
| **Hacker News** | **Nothing on topic.** Treat as a finding | `resume parser` returned 110 hits in 30 days — **all of them people posting their own résumés** in "Who wants to be hired?" threads. `skills-based hiring`: 6 hits in **60** days, none on topic. `ESCO taxonomy`: 1 hit, about the EU AI Act. One adjacent thread only: *"Don't ask an LLM for a confidence score"* (2026-07-28, 92pts, 35cmt) — I could not read it (HN rate-limited, HTTP 429). |
| **Reddit** | **Nothing on topic.** Treat as a finding | The engine's Reddit lane returned 12 threads, all generic-LLM drift (r/LangChain routers, r/LocalLLaMA model releases). Direct Reddit JSON search was blocked (403) from this environment, so I cannot rule out r/recruiting discussion I could not reach — but the engine's targeted pass over r/recruiting, r/recruitinghell, r/humanresources found nothing. |
| **Web** | Low quality, one useful lane | The résumé/skills web corpus is almost entirely SEO content marketing. Only the employer-survey material (NACE, Forbes) is worth citing, and it is 30–60 days older than the window. |
| **X / Twitter** | **Not searched** | No credentials in this environment. A real gap: if practitioner complaint about skill hallucination lives anywhere I did not look, it is here. |
| **YouTube / TikTok / Instagram** | **Not searched** | `yt-dlp` and ScrapeCreators not installed. Judged low-value for this subject. |
| **Polymarket** | Zero relevant markets | Expected. |

**The prior research's finding is strongly confirmed:** "Reddit and HN returned almost nothing on
topic; the discussion lives in issue trackers and papers." Two independent runs, same result. For this
subject, **read code and issue trackers; social platforms are empty.**

---

## Sources

**Primary — live code and issue trackers (all verified 2026-08-05)**

- [santifer/career-ops](https://github.com/santifer/career-ops) — 62,886★, pushed 2026-08-05, not archived
  - [PR #2460](https://github.com/santifer/career-ops/pull/2460) — "the anti-fabrication gate saw nothing in five shipped locales", opened 2026-08-03, merged 2026-08-04
  - [Issue #2279](https://github.com/santifer/career-ops/issues/2279) — "modifier-count asymmetry fails truthful CVs (and can hide changed numbers)", 2026-07-29
  - [Issue #2395](https://github.com/santifer/career-ops/issues/2395) — "the anti-fabrication and authorship RULES are missing from 16 of 18 localized _shared.md", 2026-07-31, still open
  - [PR #2427](https://github.com/santifer/career-ops/pull/2427) — candidate contact redaction for LLM evaluator prompts, 2026-08-02
  - [PR #2516](https://github.com/santifer/career-ops/pull/2516) / [Issue #2515](https://github.com/santifer/career-ops/issues/2515) — empty Skills payload renders a bare header, 2026-08-05
  - `modes/_shared.md` — the authorship + "keywords get reformulated, never fabricated" RULES
  - `jd-skill-gap.mjs` — zero-LLM three-way `existing` / `supportedByResume` / `gap` classifier
  - `skill-extract.mjs` — the shared vocabulary + `canonicalize()`, "no umbrella aliases"
  - `modes/pdf/hm-audit.md` — the `LOW CONFIDENCE` / "an empty gap list is not 'no gaps'" rule
- [srbhr/Resume-Matcher](https://github.com/srbhr/Resume-Matcher) — 28,026★, pushed 2026-08-05, not archived
  - `apps/backend/app/services/improver.py` — `generate_skill_target_plan()` + `verify_skill_target_plan()`, the four-way provenance split
  - [PR #875](https://github.com/srbhr/Resume-Matcher/pull/875) — "render skills/languages/certs/awards as individual tags, not a continuous string", 2026-07-07
  - `docs/superpowers/plans/2026-05-06-resume-tailor-verifier-loop.md` — the verifier-loop design
- [MohamedGassem/jorg](https://github.com/MohamedGassem/jorg) — 4★, pushed 2026-08-04. "Candidates own one structured skill profile; recruiters generate tailored documents." Closest shape to our product; no traction, but a live demo.

**Liveness checks (GitHub API, 2026-08-05)**

- `jsonresume/resume-schema` — 2,396★, **archived**, last push 2026-06-12
- `jsonresume/resume-cli` — 4,719★, **archived**, last push 2026-06-12
- `jsonresume` org — **27 of 32 repos archived**
- `KonstantinosPetrakis/esco-skill-extractor` — 27★, last push 2025-06-12
- `jensjorisdecorte/Skill-Extraction-benchmark` — 17★, last push 2024-07-18
- `AnasAito/SkillNER` — 214★, last push 2024-01-28
- `xitanggg/open-resume` — 8,800★, last push 2024-10-29
- CareerGraph-named repos — 37 total, 2 created in the 48h before this run, all 0★
- Repos pushed 2026-07-06 → 2026-08-05: `resume ATS` 4,046 · `resume parser` 1,179 · `skill extraction` 352 · `skills taxonomy` 61 · `ESCO skills` 11 · `O*NET skills` 9 · `Lightcast skills` 1

**Secondary — surveys and industry (older than the window; cited for direction only)**

- Forbes, "Why Only 46% Of Employers Plan To Expand Skills-Based Hiring In 2026", 2025-12-15 — 53% cite verifying skill claims as the blocker
- NACE, "Employer Use of Skills-Based Hiring Practices Grows" — 70% adoption (from 65%); assessment at interview 87%, screening 65%
- employerbranding.news, "Skills based hiring was supposed to kill pedigree, did it?" — 82% claim adoption, 68% of those implemented nothing
- Lightcast Open Skills (lightcast.io/open-skills) — 35,000+ skills, still live; Lightcast acquired Skill Collective, Dec 2025; SkyHive now inside Cornerstone

**Low-trust (SEO content marketing — cited only to show what the visible discourse contains)**

- VerifyEd, ResumeGenius, Monster, ResumeWorded, Resumemate on proficiency levels; ResumeAdapter,
  ATSVerification, CareerEnlightenment on keyword stuffing and the "stop at 14 skills" claim.
  No method disclosed behind any figure.

**Not searched:** X/Twitter (no credentials), YouTube/TikTok/Instagram (tooling absent).
**Searched and empty:** Hacker News, Reddit, Polymarket.
