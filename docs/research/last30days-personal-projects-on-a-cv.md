# Personal projects on a CV — what the last 30 days actually says

Research leg for [#147](https://github.com/adrien-mounier/jobcrush-app/issues/147) (recent-movement half;
the deep-sources half runs in parallel). Sibling question in
[#148](https://github.com/adrien-mounier/jobcrush-app/issues/148).

**Window:** 2026-07-07 → 2026-08-06. **Run date:** 2026-08-06.

---

## Bottom line

**The section is real, and #146's structural hypothesis is confirmed in production — but the entry is
much thinner than the ticket assumes, and the thing the last 30 days actually changed is not whether
you keep a project. It is what a project is *for*.**

Four findings, in order of how much they should move the decision:

1. **A project is a first-class section in the biggest live product in this space, and it is the only
   element with no organisation slot.** `AmruthPillai/reactive-resume` (**40,041★**, pushed
   **2026-07-31**, not archived) ships `projects` as a top-level section alongside experience,
   education and skills. Its `projectItemSchema` requires a `name` and carries **no company, no
   school, no issuer, no awarder, no publisher, and no location** — every *other* dated item type in
   that schema has one. #146 chose personal projects as the test case for "an element with no
   organisation" and the guess was right; it is not a quirk of one CV.

2. **The shipped entry is four fields, and the *richer* model is the dead one.** Live schema:
   `name` + `period` (free-text string) + optional `website` + one HTML `description`. **No technology
   list. No team size. No outcome-metric field. No role.** The archived JSON Resume project object
   defined all of that and more (`entity`, `roles[]`, `keywords[]`, ISO-8601 `startDate`/`endDate`,
   structured `highlights[]`, `type`) — and JSON Resume is **confirmed dead again this window**
   (`resume-schema` 2,396★ and `resume-cli` 4,719★ both archived, last push 2026-06-12). **The market
   moved from a structured project to a free-text blob, not toward one.** If we build fields, we build
   past everyone shipping.

3. **"Drop projects once you have real experience" is not reversed — it has been overtaken by a
   harsher claim: nobody opens them.** Across a 10-YOE thread on r/ExperiencedDevs (2026-07-29,
   16pts/25cmt) the top reply is *"absolutely no one is going to look at your portfolio site"* (30
   upvotes) and the second is that its real use is **"to keep all the details of your work available
   for you… so you can talk at length about any project that catches a hiring manager's eye from your
   CV"** (13 upvotes). One 20-YOE dissent says his does get read. **This is thin evidence — a
   16-point thread — but it is the only direct read on our owner's exact situation in the window.**

4. **The AI skepticism is real, loud, and pointed somewhere other than where #147 expected.** It
   devalues the **artifact**, not the **fact**. The window's single biggest item on this subject —
   **1,789 upvotes, 272 comments** — is a hiring manager saying he can no longer tell junior
   portfolios apart, and his fix is not to stop reading projects. It is to **open a random file from
   the candidate's own repo and make them walk through it**. 1 of 9 could explain everything.
   **A project stopped being a credential and became a question generator.** That is the same shape
   as ADR-0005's prepared interview narrative, arriving from the outside.

**What contradicts the ticket's framing:** #147 Q7 asks whether the projects section is a
developer convention that does not transfer. **It is, and the numbers are not close.** In 248
project-management posts I pulled this window, `"projects section"` appears **0 times**; in 280
developer-career posts it appears **12 times**. In the PM corpus, *"portfolio"* almost always means a
**PMO book of work**, not a personal-projects section. Our market is IT project management and banking.

**What has no evidence at all:** no ATS or parser shipped anything touching a candidate projects
object in this window. **Beware a false friend:** Ashby's API *does* have `candidate.listProjects` —
but an Ashby "project" is a **recruiter-side sourcing project the candidate was added to**, not
something the candidate built. Reading that as prior art would be a straightforward mistake.

---

## Findings by theme

### 1. Q1 — The section exists, is called `Projects`, and is settled enough that nobody is arguing about it

**Primary evidence is the shipped schema**, not discourse. `packages/schema/src/resume/data.ts` in
`reactive-resume` declares `projects` in the closed section enum next to the sections we already
model:

```ts
export const sectionTypeSchema = z.enum([
  "summary", "profiles", "experience", "education",
  "projects",                                        // ← first-class, not "additional"
  "skills", "languages", "interests", "awards",
  "certifications", "publications", "volunteer", "references", "cover-letter",
]);
```

It is also placeable in either page column via the layout schema, i.e. it is ordinary furniture with
no special handling.

**On Reddit it is treated as assumed, which is the strongest form of "convention".** Nobody in
r/EngineeringResumes this window asked *whether* to have a projects section; they asked where to put
it. The clearest example is a rising sophomore (2026-07-24, 3pts/4cmt) asking *"Should I put my
student club experience above the Projects section if I'm targeting aerospace?"* — the section is the
fixed point in the question. `"projects section"` appears in **12 of 280** developer-career posts,
almost all of them resume-review threads in r/EngineeringResumes.

⚠️ **I could not read the r/EngineeringResumes wiki**, which is the community's formal resume guide
and would have been the best single source for naming and format rules. Reddit's own surfaces (search
JSON, post JSON, old.reddit) all return **403** from this environment, and the two Redlib mirrors that
did respond return *"Wiki not found"*. **Treat naming-convention frequency as unmeasured**, not as
measured-and-absent.

### 2. Q2 — How an entry is written: one prose paragraph, a loose date range, an optional link

The live schema, verbatim, with its own field descriptions:

```ts
export const projectItemSchema = baseItemSchema.extend({
  name:        z.string().min(1).describe("The name of the project."),
  period:      z.string().describe("The period of time the project was worked on."),
  website:     itemWebsiteSchema.describe("The link to the project, if any."),
  description: z.string().describe("The description of the project. This should be a HTML-formatted string."),
});
```

Its own shipped sample data writes all three example projects as **a single `<p>` prose paragraph —
no bullets**:

> `name:` `"Echoes of the Void (Indie Game)"` · `period:` `"2023 - Present"` ·
> `description:` `"<p>Solo developer for a narrative-driven 2D platformer built in Unity. Features
> custom dialogue system, branching story paths, and atmospheric pixel art. Currently in development
> with demo released on itch.io garnering 5K+ downloads…</p>"`

**That is our owner's CV shape almost exactly** — bold title, one paragraph of prose, no bullets, no
organisation. The one difference is dates, and the schema is permissive there (see below).

Three details that bear directly on decided ADRs:

- **`period`, not `date`.** In this schema, `experience` and `education` get `period` (a span);
  `certification`, `award` and `publication` get `date` (a point). **A project is grouped with the
  spans.** That is a small but real vote for treating a project's time as a range, per ADR-0003
  clause 6, rather than as a new kind of thing.
- **Undated is legal but not modelled as a state.** `period` is `z.string()` with **no `.min(1)`**, so
  an empty string validates — but there is no "ongoing" flag, no "undated" marker, and the sample
  always fills it, twice with the free-text `"- Present"`. **Nothing distinguishes "no dates" from
  "dates not entered yet."** If clause 6's three end states matter to us, this schema cannot express
  the difference and does not try.
- **Linkless is a normal shipped state.** The sample's third entry, `"Game Jam Participation"`, ships
  with `url: ""` and `label: ""`. A project entry with no link is not an edge case.

**The one piece of writing advice with real reasoning behind it** came from r/resumes (2026-07-13,
13pts/5cmt) — small numbers, but it is the sharpest formulation I found and it is about the *link*,
which is #148's question:

> Bad version: `- Portfolio: link`
> Better version: `- Portfolio: 3 implementation case studies, including a billing workflow rebuild`
> … The link is support. The resume still has to do the first bit of selling.

The top reply (5 upvotes) frames it as a division of labour we could implement directly:
*"Resume: why should I interview you? github: Can you prove it?"*

### 3. Q3 — Where it sits, and the "drop it when experienced" rule

**No published rule reversed in this window.** The commercial advice corpus still says roughly
*"with 10+ years, projects become supplementary — link to your portfolio or GitHub rather than taking
resume space"* — but this is SEO content marketing with no method behind it (resumly.ai, airesume.guru,
kickresume), and should be weighted as such.

**The practitioner evidence is more interesting and more damaging.** The r/ExperiencedDevs thread
(2026-07-29, 16pts/25cmt) is a 10-YOE dev asking whether to build an "engineering journal" instead of
a portfolio, because *"my resume doesn't capture everything, just the highlights in small bullet
form."* The replies do not say "you're too senior for projects." They say nobody reads the artifact:

- *"absolutely no one is going to look at your portfolio site unless you're pushing for
  hyper-design oriented roles"* — u/Early_Rooster7579, **30 upvotes**
- *"Its best use will be to keep all the details of your work available for you to be fresh in your
  mind, so you can talk at length about any project that catches a hiring managers eye from your
  CV"* — u/Pristinefix, **13 upvotes**
- *"I built one too. Received 0 visits for the 3 interviews that led to a final offer… my manager
  said it was fine to have self-drive but naïve to believe anyone would care."* — u/Previous_Feeling_484
- Dissent, worth keeping: *"Not true. 20 YOE and mine definitely gets looked at and commented on."*
  — u/originalchronoguy, 9 upvotes

⚠️ **Weight this as weak.** A 16-point thread with 25 comments is not a market signal. But it is the
only direct read on "7+ years and still carrying one" in the window, and it points somewhere the
ticket did not anticipate: **the argument against a projects section is now indifference, not
juniority.**

### 4. Q4 — Nobody screens on it structurally; one person got screened *out* by it

**No ATS or parser shipped a structured project object in this window, and none appears to have one.**
Three checks:

- **Ashby is a false friend.** `candidate.listProjects` / `candidate.addProject` /
  `candidate.removeProject` exist in the public API — and an Ashby "project" is a **recruiting
  pipeline the candidate was added to**. It has nothing to do with what the candidate built. This is
  exactly the kind of thing #137 warned about; do not cite it as prior art.
- **The best live resume-quality scorer has no section criteria at all.** `reactive-resume`'s
  `analysis.ts` (34 lines, whole file) is an LLM scorecard whose dimensions are just
  `{ dimension: z.string().min(1), score: 0-100, rationale: string }` — **free-text dimensions chosen
  by the model at runtime**. There is no `projects` criterion, and no criterion for any other section
  either.
- **Parser field lists omit projects.** The commercial description of what parsers extract —
  name, contact, summary, per-job title/company/dates/location/bullets, per-education
  degree/school/major/year, skills, sometimes certifications, languages, publications, volunteer —
  **does not include projects**. Low-trust source (SEO), but consistent with #137's finding that these
  platforms hold no structured skill object either.

**The one concrete screening event in the window ran in the opposite direction.** r/jobs, 2026-07-27
(25pts/10cmt): a finalist had their **candidacy flagged by HR because of their online portfolio** —
a work sample they had failed to anonymise. Top reply, 31 upvotes: *"Admitting a mistake is just as
likely to help you."* **A projects/portfolio artefact is more evidenced as a disqualification surface
than as a qualification one this window.** That is one data point; do not over-read it. But it maps
onto a live question in our own corpus — r/cscareerquestions, 2026-07-24: *"Can I put internal tools
on my Portfolio?"*

### 5. Q5 — A project as evidence for a skill: no prior art found, again

Nothing in this window links a project to the skills it demonstrates, in any schema, parser or tool
I could reach. The live project object has **no `keywords` field at all**; the archived JSON Resume
object did (`keywords[]`, *"Specify special elements involved, e.g. AngularJS"*) — so **the only
structured project-to-technology link available is in a dead standard.**

This matches the prior leg's finding for skills-on-jobs exactly: `supported_by_resume` records
*that* a skill appears in prose, never *where*. **Projects-as-mention-sites remains open ground —
no design to copy, and no cautionary tale either.** Under ADR-0004 clause 1 our owner's project
paragraph naming `Claude`, `Gemini` and `Codex` would compose with skills; nothing external either
supports or contradicts that.

### 6. Q6 — Two shipped definitions of a project, and they disagree sharply

| Field | **reactive-resume** (live, 40,041★, pushed 2026-07-31) | **JSON Resume** (archived 2026-06-12, 2,396★) |
|---|---|---|
| Name | `name` (required) | `name` |
| Organisation | **— none —** | `entity` — *"relevant company/entity affiliations"* |
| Role | **— none —** | `roles[]` — *"e.g. Team Lead, Speaker, Writer"* |
| Dates | `period` — free-text string | `startDate` / `endDate` — **ISO-8601** |
| Link | `website` (url + label) | `url` |
| Prose | `description` — one HTML blob | `description` — *"short summary"* |
| Bullets | *(inside the HTML blob)* | `highlights[]` — separate array |
| Technologies | **— none —** | `keywords[]` |
| Kind | **— none —** | `type` — *"volunteering, presentation, talk, application, conference"* |

**Read this table as the finding.** The dead standard modelled a project richly and precisely. The
live product collapsed all of it into free text. **Whatever we build, we should not assume a richer
project object is the direction of travel — the last decade of evidence says the opposite.**

Also note JSON Resume's `entity` is exactly the *optional* organisation slot ADR-0003 clause 1–4
assumed was universal. So the honest statement is not "projects have no organisation"; it is
**"the live schema has none, and the dead one made it optional."**

**Liveness, checked 2026-08-06:** `jsonresume/resume-schema` archived · `jsonresume/resume-cli`
(4,719★) archived · both last push **2026-06-12** · `amruthpillai/reactive-resume` **not archived**,
pushed 2026-07-31, 109 open issues · `srbhr/Resume-Matcher` **not archived**, 28,039★, pushed
2026-08-05 · `xitanggg/open-resume` 8,802★, **last push 2024-10-29** (stale, not archived).

**Movement in the window: none on projects.** `reactive-resume` landed six commits touching
`packages/schema` between 2026-07-07 and 2026-08-06 — semantic CSS stylesheets, page-margin clamping,
an audit refactor, style-intent filtering, application-timeline history. **Not one touches the project
object.** The shape is settled, not contested.

### 7. Q7 — It does not transfer to project management or banking, and the counts are stark

This is the finding most likely to change what #146 is worth building. I pulled every post I could
from ten career subreddits in the window and counted term frequency in the two comparable blocks:

| | posts pulled | `personal/side project` | `"projects section"` | `portfolio` | `github` |
|---|---|---|---|---|---|
| **Developer** (r/EngineeringResumes, r/cscareerquestions, r/cscareerquestionsEU, r/ExperiencedDevs) | 280 | **33** | **12** | 63 | 34 |
| **Project management** (r/PMCareers, r/projectmanagement) | 248 | **4** | **0** | 14 | 3 |

**In the PM corpus, `portfolio` is a false cognate.** Fourteen hits, and they are PMO usage —
*"PMO, project portfolio governance and reporting"*, *"double the portfolio"*, *"program and
portfolio management"*. None of the 14 is a personal-projects section.

**The one PM resume thread with real engagement never mentions projects at all.** *"Some of the most
disorganized resumes I see come from PM"* (r/PMCareers, 2026-07-26, **99pts/26cmt**) is entirely about
work bullets — environment context, and **ownership**:

> *"I've been a PM for five years and my resume definitely focuses more on project size than what I
> personally controlled… they pushed me to separate 'participated in' from 'owned'."*
> — u/KappaDrive2, 6 upvotes

That `participated in` vs `owned` split is a **provenance distinction on a work fact** — closer to
ADR-0004 clause 1a than anything in the projects discourse. Note also the thread's top reply, 46
upvotes: *"It sounds like you want a resume to replace an interview."*

**Banking: one question in 30 days, and it got no human answer.** r/FinancialCareers, 2026-07-07
(**1pt, 1 comment — and the single comment is AutoModerator**). An FP&A analyst with a **launched SaaS
with real paying customers** asks whether to put it on his resume. His stated fear is not that it
looks weak:

> *"Would hiring manager consider me as using my work time to develop side hustle and not treating my
> current main job properly."*

**That is a different risk model from the developer world entirely** — in finance the side project
reads as a loyalty question, not as evidence. He got no reply. The only other finance mention is a
student CV for 2027 spring weeks (2026-07-16, 2pts/3cmt) noting *"I did a personal project in 1st
year"* — i.e. juniors only, exactly the pattern the ticket suspected.

⚠️ **Honest caveat on this block:** r/FinancialCareers yielded only 9 posts before the archive API
rate-limited me, and two of my four r/FinancialCareers queries failed outright. **Nine posts is not a
corpus.** The PM numbers (248 posts) are solid; the banking conclusion is a directional hint from one
unanswered thread, not a measurement.

**Hong Kong / Singapore specifically: nothing.** No HK or SG discussion of a projects section
surfaced on any platform. r/askSingapore returned 2 posts, r/HongKong was rate-limited out. The
commercial IT-PM resume guides that do mention projects are generic global SEO content
(livecareer, beamjobs, resumeworded) and say only that *"including a personal or academic project can
showcase transferable skills"* — no method, no market specificity. **Treat the HK/SG angle as
unmeasured.**

### 8. The AI-credibility question — real, strong, and aimed at the artefact rather than the CV

**The premise is very strong; the transfer to CVs is weak.** Both halves matter.

**The premise:** `vibe coded` returns **1,248 Hacker News comments in 30 days**. The register is
uniformly dismissive and it is applied to *artefacts*: *"The website smells vibe-coded"* (2026-08-05),
*"why should I use a brand-new vibe-coded tool if I can just vibe-code my own?"* (2026-08-06), *"I do
wish people would use just a few extra prompts to break out of the 'vibe-coded' look"* (2026-08-05).
**A polished thing no longer implies a capable builder.** That belief is now ambient.

**The transfer to résumés:** on Hacker News, **zero**. `personal projects resume`, `projects section
resume`, `portfolio hiring`, `side project hiring`, `AI generated portfolio`, `junior developer
portfolio` — **all return 0 stories in the window.** The connection is made almost entirely in one
Reddit thread.

**That thread is the window's headline** (r/cscareerquestions, 2026-07-16, **1,789 upvotes, 272
comments**), and the mechanism it describes is more useful to us than the sentiment:

> *"every single portfolio is insane. deployed fullstack apps, clean github, nice UIs. half the
> resumes have cursor and claude code and coderabbit on them like its a tech stack. 5 years ago any
> one of these kids is a top candidate; now i genuinely cannot tell them apart…*
> *I asked him why his auth flow used refresh tokens instead of just jwts. his own repo btw… he
> thinks for a bit and goes "i think claude suggested it". and like, he did build the thing. he just
> also accepted every single decision the agent made without ever asking why.*
> *what ive been doing since is just opening a random file from their project and asking them to walk
> me through it. their own code, no leetcode. 1 of the 9 could explain everything, 2 could explain
> most of it."*

He then names his own worry: *"my worry is im just filtering for kids who talk well now."*

**The direct contradiction is in a much quieter thread**, and it is genuine practitioner pushback.
r/cscareerquestions, 2026-07-27 (**0pts, 7 comments**) — an experienced dev asks whether an
AI-polished portfolio is now expected:

- *"99% of the time, nobody's looking at your portfolio page. So the question is kinda moot."*
  — u/CapableHerring, 7 upvotes
- *"nobody's digging into how you coded it, they just care if it's clean, fast, and reflects your
  work. use whatever tools, just highlight the stuff you actually built yourself"*
  — u/my_peen_is_clean, 6 upvotes
- *"Sleek, polished websites existed before AI too. Not using AI at this point is like not using
  Google or intellisense; it's just a tool"* — u/Randromeda2172, 3 upvotes
- *"AI use is expected anywhere you get hired. Why kneecap yourself"* — u/mile-high-guy, 3 upvotes
- Against: *"As an interviewer, I will look at it when I am procrastinating at work. I'd look at the
  code so AI slop would be a negative imo."* — u/kevin074
- And one counter-anecdote worth keeping: *"I just got a message from a recruiter 2 days ago tailored
  to one of my side projects"* — u/Chocolate--Chip

**Synthesis for our product:** the two threads agree more than they look. Nobody thinks the artefact
proves anything any more. **The value that survives is the candidate's ability to explain their own
decisions** — which is a *narrative* attached to a project, not a field on it. We already have the
concept: ADR-0005's per-advert interview narrative. **This is evidence that the narrative is the
valuable half of a project entry and the description is the cheap half.**

⚠️ **Two integrity caveats on the headline thread.** First, a commenter with 5 upvotes says *"You guys
still falling for AI posts? Damn…"* — **I cannot verify the post is genuine**, and a first-person
recruiter anecdote at 1,789 upvotes is exactly the shape that attracts fabrication. Second, my comment
vote counts come from an **archive captured at ingest time**, so they are early-capture lower bounds,
not final scores; Reddit's live surfaces are 403 from this environment and I could not refresh them.
**Treat the quotes as real and the vote numbers as floors.**

---

## What each platform yielded

| Platform | Yield | Notes |
|---|---|---|
| **Reddit** | **Everything on the human side.** ~1,173 posts pulled across 18 subreddits | Reddit's own search JSON, post JSON and old.reddit all return **403** here. The **arctic-shift** archive API (`arctic-shift.photon-reddit.com`) works and was the whole unlock — but it rate-limits hard, and **6 of my 36 second-pass queries failed outright** (noted inline where it affects a conclusion). Comment scores are captured at ingest, so they are floors. |
| **GitHub** | **Everything on the schema side.** All load-bearing structural evidence | Shipped source files and schema definitions, again. The **keyword lane is useless**: `"resume projects section"` returns **21,649** issues/PRs in the window, overwhelmingly dependabot bumps and personal portfolio-site repos. Repo counts pushed since 2026-07-07: `ats resume` **4,114** · `resume parser` **1,205** · `json resume` **250** · `cv parser` **123** · `resume schema` **49**. I did not use those counts for anything — they are token noise, same as the prior leg found. |
| **Hacker News** | **Nothing on topic. Treat as a finding — the second consecutive run to find this.** | `personal projects resume` **0** · `projects section resume` **0** · `portfolio hiring` **0** · `side project hiring` **0** · `AI generated portfolio` **0** · `junior developer portfolio` **0** · `resume parser` **0** stories in 30 days. The 26 `side project resume` comment hits are **all people posting their own résumés** in "Who wants to be hired? (August 2026)" — the identical artefact the prior leg reported. The one live vein is `vibe coded` (**1,248 comments**), which is about artefacts, not CVs. |
| **Web** | Low quality, one usable lane | The résumé-advice corpus is near-entirely SEO content marketing (resumly.ai, airesume.guru, kickresume, livecareer, beamjobs, resumeworded). Cited only for direction, never for a number. No ATS vendor published a changelog touching a projects field in the window. |
| **Blind (teamblind.com)** | Threads exist, not readable | Three on-topic threads surfaced in search (`should i remove projects section on resume`, `projects on resume`, `hiring manager question no to side projects`) — titles alone suggest the "drop it when experienced" debate is live there. **Login-walled; I could not read them or date them.** This is the most likely place the missing hiring-manager discussion lives. |
| **X / Twitter** | **Not searched** | No credentials in this environment (`bird_authenticated: false`, no `XAI_API_KEY`, no browser cookies). Same gap as the prior leg. |
| **YouTube / TikTok / Instagram** | **Not searched** | `yt-dlp` not installed, no ScrapeCreators key. Career-advice YouTube is genuinely large and this is a real gap for Q2 (how an entry is written) — more so than it was for the skills question. |
| **Polymarket** | Zero relevant markets | Expected. 110 events fetched, all filtered as noise. |
| **r/EngineeringResumes wiki** | **Blocked** | The community's formal resume guide — the single best available source on naming and entry format. Reddit 403; both responding Redlib mirrors return "Wiki not found". **Unread, not absent.** |

**The prior leg's platform finding replicates exactly:** *"read code and issue trackers; social
platforms are empty."* With one correction that matters — **for this question Reddit is not empty.**
It is 403-walled, and an archive API gets past it. Hacker News really is empty, twice over.

---

## Sources

**Primary — live code, verified 2026-08-06**

- [AmruthPillai/Reactive-Resume](https://github.com/AmruthPillai/Reactive-Resume) — **40,041★**, pushed 2026-07-31, not archived, 109 open issues
  - `packages/schema/src/resume/data.ts` — `projectItemSchema` (name/period/website/description); `sectionTypeSchema` enum; the contrast with `experienceItemSchema` (`company`), `educationItemSchema` (`school`), `certificationItemSchema` (`issuer`), `awardItemSchema` (`awarder`), `publicationItemSchema` (`publisher`)
  - `packages/schema/src/resume/sample.ts` — three shipped project entries, each a single `<p>` prose paragraph; one with an empty `website.url`
  - `packages/schema/src/resume/analysis.ts` — the whole 34-line scorer; free-text dimensions, no section criteria
  - Schema commits in window (none touching projects): `d2ffbf9` 2026-07-30 · `4ac19f8` 2026-07-29 · `9110e86` 2026-07-27 · `689e7e2` 2026-07-09 · `18d0c14` 2026-07-08 · `90105cb` 2026-07-08
- [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema) — 2,396★, **archived**, last push 2026-06-12; `schema.json` `projects` object (name, description, highlights[], keywords[], startDate, endDate, url, roles[], entity, type)
- [jsonresume/resume-cli](https://github.com/jsonresume/resume-cli) — 4,719★, **archived**, last push 2026-06-12
- [srbhr/Resume-Matcher](https://github.com/srbhr/Resume-Matcher) — 28,039★, pushed 2026-08-05, not archived
- [xitanggg/open-resume](https://github.com/xitanggg/open-resume) — 8,802★, last push **2024-10-29** (stale)
- Ashby API — `candidate.listProjects` / `candidate.addProject` / `candidate.removeProject`: **recruiter-side sourcing projects**, not candidate projects. Not prior art.

**Primary — Reddit, window 2026-07-07 → 2026-08-06 (via arctic-shift archive; scores are ingest-time floors)**

- [every junior portfolio i screen now is incredible and it means nothing](https://reddit.com/r/cscareerquestions/comments/1uy5m4u/every_junior_portfolio_i_screen_now_is_incredible/) — r/cscareerquestions, 2026-07-16, **1,789pts / 272cmt** (authenticity questioned in-thread)
- [Some of the most disorganized resumes I see come from PM](https://reddit.com/r/PMCareers/comments/1v78v72/some_of_the_most_disorganized_resumes_i_see_come/) — r/PMCareers, 2026-07-26, **99pts / 26cmt** — "participated in" vs "owned"
- [Code portfolio truly enough for career?](https://reddit.com/r/sysadmin/comments/1v7icuv/code_portfolio_truly_enough_for_career/) — r/sysadmin, 2026-07-26, 5pts / **56cmt**
- [Portfolio site to talk about projects](https://reddit.com/r/ExperiencedDevs/comments/1v9h8vf/portfolio_site_to_talk_about_projects_in_my/) — r/ExperiencedDevs, 2026-07-29, 16pts / 25cmt — the 10-YOE case
- [Forgot to anonymize work sample. Is it over?](https://reddit.com/r/jobs/comments/1v87u9l/forgot_to_anonymize_work_sample_is_it_over/) — r/jobs, 2026-07-27, 25pts / 10cmt — screened out *by* the portfolio
- [If you could build one portfolio project today, what would it be and why?](https://reddit.com/r/learnprogramming/comments/1utidcg/if_you_could_build_one_portfolio_project_today/) — r/learnprogramming, 2026-07-11, 19pts / 19cmt
- [A portfolio link only helps if the resume gives a reason to click it](https://reddit.com/r/resumes/comments/1uvalz1/a_portfolio_link_only_helps_if_the_resume_gives_a/) — r/resumes, 2026-07-13, 13pts / 5cmt
- [New portfolio page - with or without AI?](https://reddit.com/r/cscareerquestions/comments/1v8d5m8/new_portfolio_page_with_or_without_ai/) — r/cscareerquestions, 2026-07-27, 0pts / 7cmt — the counter-thread
- [Would hiring manager consider side project/self-developed SaaS an add to the resume or no?](https://reddit.com/r/FinancialCareers/comments/1upzayb/would_hiring_manager_consider_side/) — r/FinancialCareers, 2026-07-07, **1pt / 1cmt (AutoModerator only)**
- [Rate CV for 2027 Spring Weeks](https://reddit.com/r/FinancialCareers/comments/1uxyrom/rate_cv_for_2027_spring_weeks/) — r/FinancialCareers, 2026-07-16, 2pts / 3cmt
- [Should I put my student club experience above the Projects section…](https://reddit.com/r/EngineeringResumes/comments/1v53kd4/student_rising_sophomore_trying_to_get_first_ee/) — r/EngineeringResumes, 2026-07-24, 3pts / 4cmt — the section as assumed furniture
- [I have projects but I kept them all on a portfolio website instead](https://reddit.com/r/EngineeringResumes/comments/1uwidn5/student_ee_rising_junior_trying_to_make_a_stacked/) — r/EngineeringResumes, 2026-07-14, 3pts / 4cmt — bears on #148
- [Can I put internal tools on my Portfolio?](https://reddit.com/r/cscareerquestions/comments/1v5ex2d/can_i_put_internal_tools_on_my_portfolio/) — r/cscareerquestions, 2026-07-24, 1pt / 8cmt — project provenance/ownership

**Corpus counts (arctic-shift, window 2026-07-07 → 2026-08-06)**

- Posts pulled per subreddit — pass 1: resumes 194 · EngineeringResumes 182 · PMCareers 148 · projectmanagement 100 · ITCareerQuestions 60 · cscareerquestionsEU 46 · cscareerquestions 26 · ExperiencedDevs 26 · recruiting 4 · askSingapore 2
- Pass 2: webdev 152 · learnprogramming 75 · jobs 51 · recruitinghell 49 · PMCareers +34 · sysadmin 14 · FinancialCareers 9 · datascience 1
- **Failed to search (rate-limited):** FinancialCareers × `projects section`/`portfolio` · recruiting × `personal project`/`portfolio` · datascience × `portfolio` · PMCareers × `projects section`. HongKong and singapore never completed.

**Hacker News (Algolia, 30-day window)** — story hits: `personal projects resume` 0 · `projects section resume` 0 · `portfolio hiring` 0 · `side project hiring` 0 · `AI generated portfolio` 0 · `junior developer portfolio` 0 · `resume parser` 0 · `vibe coding hiring` 0. Comment hits: `side project resume` 26 (all "Who wants to be hired?" self-posts) · `personal projects hiring` 7 (none on topic) · **`vibe coded` 1,248**.

**Low-trust (SEO content marketing — cited only to show what the visible advice corpus contains)**

- resumly.ai, airesume.guru, kickresume, resumeworded on "10+ years → projects become supplementary"
- livecareer, beamjobs, resume.org, thetailorcv on IT/bank project-manager resumes and personal projects as transferable-skill evidence
- resumeoptimizerpro, kula.ai on what ATS parsers extract (projects absent from every field list). No method disclosed behind any figure.

**Not searched:** X/Twitter (no credentials), YouTube/TikTok/Instagram (tooling absent), Blind (login-walled).
**Searched and empty:** Hacker News, Polymarket.
**Blocked:** Reddit live surfaces (403), r/EngineeringResumes wiki (403 + mirrors report "not found").
