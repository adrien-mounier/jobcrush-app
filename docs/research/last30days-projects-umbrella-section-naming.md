# Is there ONE umbrella for projects/portfolio/GitHub/website/side-projects/open-source — and what is it called? (last 30 days)

**Research window:** 2026-07-07 → 2026-08-06
**Compiled:** 2026-08-06
**Ticket:** [#148](https://github.com/adrien-mounier/jobcrush-app/issues/148) — the `/last30days` half. Sibling
half is the deep-sources pass.
**Method:** `/last30days` engine (1 pass) + direct GitHub API repo-counts and **source-code reads of five
shipping resume tools** + HN Algolia in-window + the r/EngineeringResumes canonical wiki + targeted web.
**Purpose:** what people are *shipping and arguing about right now*, weighted toward running code over
published guidance.

---

## 0. Read this first: how good is this evidence?

**Coverage was very uneven, and the unevenness is the headline.**

| Source | Coverage | Why |
|---|---|---|
| **GitHub (repo counts + direct source reads)** | **Strong — this report rests on it** | Five shipping schemas read line-by-line; repo counts run with the calibrated method |
| r/EngineeringResumes wiki | **Strong** | A canonical, prescriptive, community-maintained naming rule — the single best document found |
| Reddit (threads) | **Weak but genuinely on-topic** | 6 threads survived the relevance floor; 99 upvotes and 33 comments **total** |
| Web / career guidance | Moderate, low trust | SEO-shaped listicles; used only where a schema or a practitioner did not already answer |
| **Hacker News** | **NOTHING ON TOPIC** | See §7 — this is a finding, not a gap |
| **X / Twitter** | **NOT SEARCHED** | No credentials configured on this machine |
| **YouTube / TikTok / Instagram** | **NOT SEARCHED** | `yt-dlp` not installed; no ScrapeCreators key |
| Polymarket | 0 markets | Expected — nobody bets on CV section names |

**Stated plainly, per the ticket's constraint:**

- **Hacker News returned nothing.** In-window searches for `resume projects section`, `portfolio resume`
  and `cv schema` returned **0 hits each**. This is the third independent time this map has found HN
  silent on career-data questions.
- **X, YouTube, TikTok and Instagram were not searched at all** — missing credentials and a missing
  binary, not an empty result. I cannot speak to founder chatter or video-format career advice. Given
  the question is about *data models*, this is a smaller loss than it looks, but it is real and it means
  **no claim in this report is supported by X or video evidence**.
- **The engine's Reddit lane dropped 278 + 72 posts as off-topic** to surface 6 threads. The community
  signal here is thin and is labelled thin throughout.

**Where this report is strong, it is strong because of source code, not conversation.** Five independent
teams' schemas agree with each other and with the community wiki. That convergence — not the engagement
numbers, which are tiny — is the finding.

---

## 1. 🚨 The headline: it is TWO kinds, not one, and every shipping tool already knows

**The ticket's Q2 hypothesis — "a link is not a project" — is CONFIRMED, unanimously, by every single
data model I read.** There is no dissenting implementation in the corpus.

Five tools, five independent teams, one shape:

| Tool | Stars | Pushed | The "things you did" array | The "pointers" thing | Same section? |
|---|---|---|---|---|---|
| `amruthpillai/reactive-resume` | **40,041** | 2026-07-31 | `sections.projects` | `sections.profiles` + `basics.website` | **No — two** |
| `rendercv/rendercv` | **17,283** | 2026-05-01 ⚠️ stale | free-form section (example: `"Projects"`) | `social_networks[]` + `custom_connections[]` | **No — two** |
| `yamlresume/yamlresume` | **1,488** | 2026-08-03 | `content.projects` | `content.profiles` | **No — two** |
| `sadanandpai/resume-builder` | **1,216** | 2026-08-05 | `projects: 'Projects'` | (contact block) | **No — two** |
| `olyaiy/resume-lm` | **306** | 2026-08-03 | `projects: Project[]` | `website` / `linkedin_url` / `github_url` **flat on the resume** | **No — two** |
| `sunnypatell/ats-screener` | **114** | 2026-08-02 | `SectionType = 'projects'` | `extractContact()` → `{…, linkedin, github, website}` | **No — two** |

### The three sharpest pieces of proof

**(a) `resume-lm` puts the links on the person and the projects in an array — in the same file.**
Verbatim from `src/lib/types.ts` (306★, pushed 2026-08-03):

```ts
export interface Resume {
  …
  website?: string;
  linkedin_url?: string;
  github_url?: string;
  …
  projects: Project[];
}

export interface Project {
  …
  url?: string;
  github_url?: string;
}
```

Read the second interface carefully. **A project's link is a *field of the project*, not an entry in a
links list.** A GitHub URL appears twice in this model and means two different things: on the resume it
is a contact channel, on a project it is an attribute. That is the whole answer in nine lines of code.

**(b) `rendercv` calls a personal website a "contact method" in its own docstring.** Verbatim from
`custom_connection.py`:

> *"User-defined **contact method** with custom icon and URL. **Why:** Built-in social networks cover
> common platforms, but users need arbitrary **contact methods** (personal websites, custom platforms).
> CustomConnection provides a FontAwesome icon, display text, and optional URL for any **contact
> channel**."*

Three uses of "contact" in four lines, describing a personal website. Not a project. Not a portfolio
entry. A contact channel.

**(c) The ATS simulator splits them across two different files.** `sunnypatell/ats-screener` (114★,
created 2026-02-20, pushed 2026-08-02) simulates Workday, Taleo, iCIMS, Greenhouse, Lever and
SuccessFactors. Its `extractContact()` returns:

```
{ name, email, phone, linkedin, github, website, location }
```

**A GitHub URL and a personal website sit in the same return object as the phone number.** Meanwhile
`section-detector.ts` carries a `projects` section type that never touches them. Its research file
records the field set a typical commercial ATS emits, verbatim:

> `personal: name, email, phone, address, linkedin, websites`

Links are `personal`. Projects are a section. Different stage of the pipeline, different data type.

### What a "profile" actually is, in the schemas' own words

`yamlresume`'s `profiles` section carries this description in the schema metadata itself:

> *"The profiles section contains your **online presence**, including social media and professional
> network profiles."*

**"Online presence" is not a candidate section name — it is the *definition of the profiles section*.**
That is the answer to that part of Q1: the concept exists, it is real, and it is already named
`profiles` everywhere. Nobody ships a section called "Online Presence."

And a profile's `network` field is a **closed enum**, not free text. `yamlresume`'s 24 allowed values:

> Behance, Discord, Dribbble, Facebook, **GitHub**, Gitlab, Instagram, Line, LinkedIn, Medium, Pinterest,
> Reddit, Snapchat, Stack Overflow, Telegram, TikTok, Twitch, Twitter, Vimeo, Weibo, WeChat, WhatsApp,
> YouTube, Zhihu

`rendercv`'s equivalent `Literal` enum: LinkedIn, **GitHub**, GitLab, IMDB, Instagram, ORCID, Mastodon,
StackOverflow, ResearchGate, YouTube, Google Scholar, Telegram, WhatsApp, Leetcode, X, Bluesky, Reddit.

**GitHub is enumerated next to WhatsApp and Instagram.** Not next to a project. Two independent teams
made the same call. A GitHub *URL* is a handle on a platform; a GitHub *contribution* is something else
entirely and lives in `projects`.

---

## 2. The name is `Projects` — and one community has already written the rule down

### The single most decisive document found

**r/EngineeringResumes wiki** (retrieved 2026-08-06; auto-linked by the subreddit bot on every post, so
it is the de-facto reference for that community). Under a heading literally named `Projects`:

> **"This section should be named Projects, not Academic/Engineering/Notable/Personal/Relevant/Selected/
> Technical Projects"**

That is not a preference. It is a prescriptive naming rule that **explicitly enumerates and rejects seven
qualified variants** — including `Personal Projects`, which is exactly what the owner's own CV carries.

The same wiki entry continues:

> *"This section is for personal projects, student design teams, and extracurricular/hobbyist projects,
> **not projects from work**"*
>
> *"For personal projects, roles/positions/locations/dates are **generally unnecessary**. What's more
> important is **including a link to a portfolio page and/or GitHub repo**"*
>
> *"There's no need to disclose 'Personal Project', 'Academic Project', or 'Group Project' beside your
> project title"*

Three things fall out of that one paragraph: the name is `Projects`, dates are optional by design, and
**the link belongs on the project** — which is precisely the `resume-lm` shape from §1.

### The ATS simulator normalises seven names into one

`ats-screener`'s section detector, verbatim:

```
projects: [
  /^(projects|personal\s*projects|academic\s*projects|notable\s*projects|
     selected\s*projects|key\s*projects|side\s*projects)$/i
]
```

Seven aliases, one canonical type: **`projects`**. `Side Projects` and `Personal Projects` are not rival
names — they are already treated as spellings of the same thing by a tool that simulates six commercial
ATS platforms.

**And the negative is as important as the positive.** The full `SectionType` union is:

```
contact | summary | experience | education | skills | projects |
certifications | awards | publications | volunteer | languages | interests | unknown
```

There is **no `portfolio`, no `open source`, no `links`, no `online presence`**. I checked the entire
repo: the string `portfolio` appears only in `security.txt`, `llms.txt`, the CHANGELOG, the privacy
policy, a skills-taxonomy entry (as in "portfolio management", a job skill), and one test. `open source`
appears **zero** times outside licence boilerplate. A heading reading `PORTFOLIO` or `OPEN SOURCE`
classifies as **`unknown`** in this model.

### Every builder's field name agrees

- `reactive-resume` section enum: `summary, profiles, experience, education, **projects**, skills,
  languages, interests, awards, certifications, publications, volunteer, references, cover-letter`
- `yamlresume`: `basics, education` (required) + `awards, certificates, interests, languages, location,
  profiles, **projects**, publications, references, skills, volunteer, work` (optional)
- `sadanandpai/resume-builder` user-facing label map: `projects: 'Projects'`
- `rendercv` — the one tool with **free-form user-named sections** — still uses `"Projects"` in its own
  documented example: `{"Experience": …, "Education": …, "Projects": …, "Skills": …}`

**The tool that lets you call it anything calls it Projects in its own example.** That is a stronger
convention signal than the ones that hard-code it.

---

## 3. The repo counts — with the confound stated up front

GitHub repository search, all queries scoped `pushed:>=2026-07-07`, run 2026-08-06. Method calibrated
against the prior research on this map (`resume ATS` returned 4,046 there, 4,113 here — same method,
consistent drift).

| Query | Repos | Reading |
|---|---|---|
| `resume ATS` *(calibration)* | **4,113** | The topic is alive |
| `Lightcast` *(calibration)* | **5** | The taxonomy vendor is not |
| `resume portfolio` | **3,301** | ⚠️ **CONFOUNDED — see below** |
| `resume projects` | **2,661** | Real, and the largest clean signal |
| `resume "open source"` | **209** | ⚠️ **CONFOUNDED — see below** |
| `resume links` | **136** | Thin |
| `resume "personal projects"` | **25** | **Near-zero** |
| `resume "online presence"` | **8** | **Near-zero** |
| `resume "side projects"` | **4** | **Near-zero** |
| `cv projects` | 1,036 | Consistent with `resume projects` |
| `cv portfolio` | 1,521 | Same confound |
| `curriculum vitae publications` | 3 | Academic CV tooling is absent from GitHub |

### ⚠️ Confound 1: "portfolio" does not mean what the count implies

**`portfolio website` alone returns 44,670 repos pushed in-window.** The `resume portfolio` count is
overwhelmingly measuring *developers building personal websites that display their CV*, not a CV section
called Portfolio. The top ten `resume portfolio` results by stars are, in order:

| Stars | Repo | What it actually is |
|---|---|---|
| 6,257 | `Evavic44/portfolio-ideas` | A curation of **portfolio website** ideas |
| 1,665 | `mldangelo/personal-site` | A personal **website** |
| 1,168 | `ubaimutl/react-portfolio` | A **website** template |
| 612 | `YuheshPandian/ICONIC` | A skill-icon library |
| 229 | `gethugothemes/academia-hugo` | A Hugo **theme** |
| 163 | `happysnaker/Resume` | HTML/CSS **portfolio template** |
| 132 | `Skyflash/skyflash.github.io` | A personal **website** |
| 127 | `anurag3407/career-pilot` | AI career platform |
| 89 | `lowinertia/free-to-engineer-portfolio-template` | A **template** |
| 56 | `jamaljm/snapcv` | Turns resumes **into portfolios** (i.e. into websites) |

**Nine of ten are websites, not CV sections.** This matters for the decision, not just for the arithmetic:
**the word "Portfolio" is already taken.** In the population we would be naming a section for, "portfolio"
denotes *a separate hosted artifact you link to*. Naming a CV section Portfolio collides with a meaning
that 44,670 repos are actively reinforcing.

### ⚠️ Confound 2: "open source" is a licence, not a section

All ten top `resume "open source"` results in-window use the phrase to describe **the tool's own
licence** — "Open-source AI job search", "free open-source resume builder", "Open-source AI resume
builder". Not one uses it as a CV section name. **Treat the 209 as approximately zero for our question.**

### What survives the confounds

Strip the two confounded rows and the picture is unambiguous:

- **`projects` is the only name with volume** (2,661 / 1,036).
- **`personal projects` (25), `online presence` (8) and `side projects` (4) are rounding errors** — at
  the same order of magnitude as `Lightcast` (5), which prior research on this map already classified as
  effectively dead.
- **`links` (136) exists but is thin**, and the schema reads in §1 show why: links do not need a section,
  because they live in the contact block.

**A separate global code-search for the field names `onlinePresence`, `sideProjects`, `socialLinks` and
`openSource` returned large numbers (8K–37K) but is uninformative and I am discarding it** — GitHub code
search cannot be date-scoped, and the hits are dominated by portfolio-website source code. Reporting
those numbers would be inflating thin evidence. The repo counts and the direct schema reads are the real
evidence here.

---

## 4. Where open-source work goes (Q4) — answered by a 4-upvote comment, and it is the cleanest rule in the corpus

The ticket flagged Q4 as "the case most likely to break a single umbrella." The corpus answers it, and
the answer does *not* break the umbrella — it draws the boundary somewhere nobody proposed.

**r/EngineeringResumes, 2026-08-04**, thread *"[3 YoE] How do I format my projects that were done at
work into my work experience section?"* (**4 upvotes, 2 comments** — a tiny thread). Top reply,
u/trentdm99 (**4 upvotes**):

> **"A Projects section is for unpaid personal and school projects. An Experience section is for paid
> work. If the entries you have in your Projects section were actually accomplished at work, you need to
> move them into Experience."**

**The boundary is paid vs unpaid — not employer vs no-employer, not dates vs no-dates.** That is a
different cut than the ticket assumed. Under it:

- Unpaid open-source contribution, even one with an organisation, dates and a role → **`Projects`**.
- Open-source work you were *employed* to do → **`Experience`**, under the employer who paid you.
- A maintainer role with no salary → **`Projects`**, however substantial.

The wiki says the same thing in prescriptive form — *"not projects from work"* — and it also removes the
objection that a project with dates and a role must therefore be work experience: *"roles/positions/
locations/dates are generally unnecessary"* for a project entry.

**Nothing in the corpus supports an `Open Source` section of its own.** Zero of five schemas have one,
the ATS simulator has no pattern for it, the repo count is a confounded 209 that is really zero, and the
wiki does not mention one. **The umbrella survives Q4 intact — it is just smaller on the paid side than
the ticket feared, and larger on the "has dates and an org" side.**

⚠️ **Weight this honestly: this is one comment with four upvotes.** It is the sharpest formulation in the
corpus and it is corroborated by the wiki and by every schema's separation of `work`/`experience` from
`projects` — but it is not consensus measured in engagement.

---

## 5. What people are actually arguing about — and it is not the name

The live in-window argument is **not** "what should the section be called." It is **"is a bare link worth
anything?"** Two threads, both small, both squarely on Q2.

**r/resumes, 2026-07-13** — *"A portfolio link only helps if the resume gives a reason to click it"*
(**13 upvotes, 5 comments**). The OP's framing is the single best description of current practice found
anywhere:

> **"A lot of resumes have links at the top now. Portfolio, GitHub, LinkedIn, case study, personal site.
> The mistake is assuming the link itself creates interest. Most recruiters are not opening extra tabs
> just because a URL exists."**

Note what that sentence does: it lists **five** of the six things from our ticket — portfolio, GitHub,
LinkedIn, case study, personal site — **as one class, in one place, at the top of the page.** A
practitioner describing the wild, unprompted, put them all in the header together.

The OP's proposed fix is the interesting part. Not a section — a **one-line reason** attached to each
link:

> Bad version: `Portfolio: link`
> Better version: `Portfolio: 3 implementation case studies, including a billing workflow rebuild` ·
> `GitHub: small React dashboard with API integration and auth flow`
>
> **"The link is support. The resume still has to do the first bit of selling."**

Top comment, u/Tijot891 (**5 upvotes**) — the clearest statement of the two-kinds relationship in the
whole corpus:

> **"Resume: why should I interview you? github: Can you prove it?"** … *"If your resume says 'Built a
> dashboard that reduced reporting time by 60%', I'm much more likely to click the GitHub or portfolio
> than if it just says 'Portfolio: www…'. The resume should sell the outcome."*

u/No_Nature3505 (1 upvote): *"A link is only useful if the resume gives me a reason to spend time opening
it. … It makes the link feel relevant instead of just taking up space."*

**This is a real design signal and it complicates the clean two-kinds split.** The community's answer is
not "links are contact detail, full stop." It is: **a link is contact-shaped in its placement and
project-shaped in its need for a description.** A pointer with a one-line justification is a third thing —
and no schema in §1 models it. `reactive-resume` gets closest with `basics.customFields[]`
(`{icon, text, link}`), where `text` could carry the reason.

**The r/EngineeringResumes wiki takes the harder line** and is worth setting against the above, because
it disagrees:

> *"Include links to GitHub profiles and portfolio websites **only if they are up-to-date**. If your
> pinned repositories lack READMEs or if your portfolio hasn't been updated in a significant time frame,
> it's advisable to save space and omit them. **Contrary to common belief, these links are not
> obligatory**, especially when their contents do not contribute meaningful value."*

And, bluntly, on the most common link of all:

> **"LinkedIn profiles are unnecessary. Chances are, nobody will ever click on your LinkedIn."**

The wiki's `Contact Information` entry then tells you exactly where the surviving links go:

> *"Write out your email address, GitHub profile, and portfolio website in plain text i.e.
> `name@gmail.com` / `github.com/username` / `myportfolio.com`"*

**Email, GitHub and portfolio website named in a single sentence, in the contact section.** That is the
ticket's Q2 hypothesis, stated by the community's own reference document.

The wiki's prescribed **Section Order** never contains a Portfolio, Links or Online Presence section at
any experience level:

> Graduated + working: `Work Experience > Skills > Education`
> Student/new grad: `Education > Work Experience > Projects (if you don't have sufficient work
> experience) > Skills`
> No technical work experience: `Education > Projects > Work Experience > Skills`
> No work experience at all: `Education > Projects > Volunteer Experience/Extracurriculars > Skills`

---

## 6. Does the umbrella survive outside software? (Q5) — partially, and "Portfolio" means something else there

**The evidence here is weaker and I am labelling it weak.** Three in-window data points, all from
mechanical/design engineering rather than software, all tiny.

**r/EngineeringResumes, 2026-08-02** — *"[STUDENT] Is the formatting between my resume and portfolio
effective?"* (**13 upvotes, 10 comments** — the highest-engagement on-topic thread found). A mech-eng
student with *"my resume and project portfolio"* — two separate documents. The advice given:

- u/graytotoro (2 upvotes), reviewing under a heading he himself labels **Projects**:
  > **"You should just have a project portfolio link somewhere."** … *"Assume people aren't going to read
  > your portfolio."*
- u/Happy-Property1162 (**7 upvotes** — the top comment):
  > *"I would work on reformatting/rewriting your portfolio bit. … turn it into something you can put in
  > a binder and **bring with you to interviews**. I've had decent success bringing something physical to
  > an interview."*
- u/Immediate-Curve-443: *"I personally like a **PPT format** for portfolios since it allows for more
  visuals and less words."*

**Outside software, a portfolio is a physical or visual artifact you carry to an interview — a binder, a
slide deck, a Word document.** It is not a CV section and it is not even necessarily a URL. The CV
section is still called `Projects`; the portfolio is a companion object.

**r/EngineeringResumes, 2026-08-05** (UK integrated-masters mech eng, **1 upvote, 1 comment**) asks
*"would a portfolio be beneficial? will it set me apart?"* — again treating the portfolio as a separate
deliverable to produce or not, never as a section to add.

The wiki itself concedes the discipline split, noting that the guide it recommends *"was written for
industrial design students."*

**For academics**, the evidence is structural rather than conversational: `rendercv` ships a first-class
`publication` **entry type** (alongside education, experience, and generic text types) and puts **ORCID,
Google Scholar and ResearchGate inside the same social-network enum as GitHub**. So an academic's
identity links are *also* contact detail, and their equivalent of a projects section is
`Publications` — a sibling, not a rename.

**Web guidance for designers and marketers** (SEO-shaped, low trust, reported only because nothing better
exists) offers `Portfolio`, `Featured Projects`, `Selected Projects`, `Selected Work` as
interchangeable. **No convergence, and no source with authority.**

**Honest verdict on Q5:** the *shape* survives everywhere — a list of things you did, plus pointers in
the header. **The `Projects` name is well-evidenced in engineering and software and merely plausible
elsewhere.** Anyone claiming a cross-profession convention exists is going beyond this evidence.

---

## 7. Q7 — awards, publications and volunteering are OUT, and the deferral was right

The ticket asked me not to assume the #146 deferral was correct. **The evidence says it was.**

Every schema read makes them **siblings of `projects`, never children:**

| | awards | certifications | publications | volunteer | references |
|---|---|---|---|---|---|
| `reactive-resume` | ✅ own section | ✅ | ✅ | ✅ | ✅ |
| `yamlresume` | ✅ own section | ✅ | ✅ | ✅ | ✅ |
| `ats-screener` (SectionType) | ✅ own type | ✅ | ✅ | ✅ | — |
| `rendercv` | (free-form) | (free-form) | ✅ own **entry type** | (free-form) | — |

Four independent tools, zero of them fold any of these under `projects`. The r/EngineeringResumes wiki
agrees implicitly — its section order lists `Volunteer Experience/Extracurriculars` as a peer of
`Projects`, and separately instructs *"Do not include a references section."*

**Patents:** no evidence either way in-window. Not modelled by any of the five tools. Unknown, not
settled.

**One caveat worth carrying to #146:** `ats-screener` groups `publications | research | papers |
presentations` into one type, and `awards | honors | achievements | recognition | scholarships` into
another. If we shape these later, those are the alias sets the parsers already collapse.

---

## 8. Has anything moved on JSON Resume? (Q3 liveness)

**No. The archive held, and nothing in the org moved except the website.**

| Repo | Stars | Archived | Last push | In-window change |
|---|---|---|---|---|
| `jsonresume/resume-cli` | **4,719** | **YES** | 2026-06-12 | **None** |
| `jsonresume/resume-schema` | **2,396** | **YES** | 2026-06-12 | **None** |
| `jsonresume/jsonresume.org` | 288 | No | **2026-07-29** | The only push |
| `jsonresume/registry-server` | 93 | **YES** | 2019-12-26 | None |

**Exactly one repo in the entire org was pushed in the last 30 days** — the monorepo that builds the
homepage and registry, at 288 stars with 54 open issues. The spec repos remain archived, unchanged since
2026-06-12, one week before this window opened. Prior research (#145) found 27 of 32 org repos dead; that
is unchanged.

### A successor HAS emerged — and it keeps both `projects` and `profiles`

**`yamlresume/yamlresume`** — **1,488 stars**, created 2025-04-09, pushed 2026-08-03, **29 commits in this
window**, 29 open issues. Built by PPResume, MIT-licensed, "Resumes as code in YAML." **It ships a CLI
converter for JSON Resume files**, which is the classic successor move: adopt the incumbent's users via
an import path rather than its spec.

**And it models the split more explicitly than JSON Resume ever did.** Where JSON Resume had `projects`
and `profiles` as two arrays with no stated rationale, `yamlresume` attaches a purpose statement to each
in the schema metadata (§1). It also **tightens the project shape considerably**:

```
ProjectItemSchema:
  required: name, startDate, summary
  optional: description, endDate, keywords, url
```

⚠️ **Note what that means for us: `startDate` and `summary` are REQUIRED.** The owner's own CV carries
three `PERSONAL PROJECTS` entries with **no dates and no links** — that CV would fail `yamlresume`
validation outright. This directly contradicts the r/EngineeringResumes wiki, which says dates are
"generally unnecessary" for a project. **Two live authorities in the same 30-day window disagree about
whether a project entry needs a date.** That is a real, unresolved design question and we should not
inherit either answer by accident.

**The other CV-as-code contender is quiet.** `rendercv/rendercv` has **17,283 stars** — more than ten
times `yamlresume` — but was **last pushed 2026-05-01, three months before this window**. It did not ship
in the last 30 days. Cited throughout this report for its data model, which is excellent evidence about
convention; **not** cited as evidence of current momentum.

---

## 9. What returned nothing, said plainly

Per the ticket's constraint, and because prior research on this map found platform silence to be a
finding three times independently:

**Hacker News: zero in-window discussion of CV section structure.** Algolia, stories created after
2026-07-07:

| Query | In-window hits | What was actually there |
|---|---|---|
| `resume projects section` | **0** | — |
| `portfolio resume` | **0** | — |
| `cv schema` | **0** | — |
| `side projects resume` | 1 | A Git-worktree AI agent tool. False positive. |
| `open source resume` | 6 | Five are Claude Code / agent tools matching on "resume a session". One real: *Show HN: Opensource resume evaluation LLM agents* — **1 point, 0 comments**. |
| `resume builder` | 9 | Mostly the same false positives. Real ones: *ZenResume* (**1pt, 0cmt**), *ApplyAssists* (**1pt, 4cmt**), *"The most capable resume editor I could build"* (**2pts, 0cmt**), *Somebodyhire.me* (**15pts, 10cmt**). |

**The word "resume" now collides with AI agent session-resumption on HN**, which is itself worth knowing
for any future search on this topic. Every genuine resume-tool Show HN in the window died at 1-2 points.
**There is no HN conversation to consult here, and there was not one before either.**

**Not searched at all, and why:**
- **X / Twitter** — no `AUTH_TOKEN`/`CT0`, no `XAI_API_KEY`, no browser cookies on this machine.
- **YouTube** — `yt-dlp` not installed.
- **TikTok / Instagram** — no ScrapeCreators key.
- **Polymarket** — searched, 0 markets (expected).

**Engine Reddit lane:** relevance floor dropped **278 posts** in the first sub-query and **72** in the
second as off-topic, surfacing 6 threads totalling **99 upvotes and 33 comments**. Every claim sourced
from Reddit in this report carries its engagement number inline for exactly this reason.

---

## 10. Where recent movement CONTRADICTS the established view

This half's job. Four places where the last 30 days push back on assumptions in the ticket or in prior
research on this map.

**1. The ticket treats the umbrella name as open. The evidence says it is closed — and that our own CV
uses a rejected variant.** `Projects` is the name in five schemas, in the ATS normaliser, and in an
explicit community rule that names and rejects `Personal Projects` by name. The ticket's framing
("A finding of 'no convention exists' is a real answer") anticipated a null result. **It is not a null
result.** For software and engineering CVs, the convention exists and is unusually well documented.

**2. "Portfolio" is not a weaker synonym — it is a different object, and the word is taken.** 44,670
`portfolio website` repos in-window, plus mech-eng practitioners describing a portfolio as a binder or a
slide deck, plus a wiki that gives `Portfolios` its own entry which is *entirely about links*. Adopting
"Portfolio" as a section name would collide with a meaning the market is actively reinforcing at scale.

**3. The two-kinds split is real, but "links are pure contact detail" is too clean.** The loudest live
thread argues a bare link is worthless and needs a one-line reason attached
(`GitHub: small React dashboard with API integration and auth flow`). **No schema in the corpus models
that** — `reactive-resume`'s `basics.customFields[]` (`{icon, text, link}`) is the only near-miss. If we
build the split as "links go in the header with no description," we will ship exactly the thing 13
upvotes and the top comment called useless. **The link needs a place to carry a sentence.**

**4. Prior research on this map found "zero convergence" in career data models. That does not hold for
this specific question.** Five independent teams — a 40K-star builder, a 17K-star CV compiler, a 1.5K-star
YAML spec, an AI builder, and an ATS simulator — all landed on `projects` + a separate profiles/contact
notion, without a shared standard and with JSON Resume archived. **This is convergence without
coordination**, which is a much stronger signal than convergence via a spec, and it is the opposite of
what the career-data-standards report found for skills and dates. **The umbrella question is settled even
though the surrounding field is not.**

---

## 11. Implications for our design — clearly labelled as interpretation

Everything in this section is **my reading**, not evidence.

1. **Shape two elements, not one — and not six.** `Projects` (things you did) and `Profiles` (pointers to
   you). Five independent implementations and one community wiki agree, with no dissent found. Under
   ADR-0001 rule 1 this is two shapes designed once, not a generic envelope, and the evidence for the
   boundary is as strong as this map has found for anything.

2. **Name the first one `Projects`, unqualified.** It survives the ATS normaliser, it is the field name in
   every schema, and it is the only variant a community has explicitly ruled on. It also passes owner
   decision 8's read-aloud test cleanly: *"today let's do your projects."* Against that, *"today let's do
   your profiles"* is worse than *"…your links"* for a non-technical person — **the internal field name and
   the spoken name may need to differ for the second element**, and that is a decision, not a finding.

3. **Do not build an `Open Source` section.** Zero evidence for it. Unpaid open-source work is a project;
   paid open-source work is experience. The paid/unpaid boundary is cleaner than the boundaries the
   ticket proposed, and it is the one a practitioner actually stated.

4. **A pointer must be able to carry one sentence.** This is the gap between what ships and what
   practitioners are asking for, and it is the cheapest place to be better than the field. A profile
   entry with `{network, username, url}` and nothing else is the exact shape the loudest in-window thread
   called useless.

5. **Decide the date question deliberately — the two live authorities disagree.** `yamlresume` makes
   `startDate` required; the r/EngineeringResumes wiki says dates are generally unnecessary for a
   project. Our own CV has none. Given prior research on this map already identified the date model as
   the highest-value place to be better than everyone else, **a project's date should be optional and
   explicitly so**, not accidentally nullable.

6. **The advert-corpus zero is about our market, not about the section — but it still binds.** No advert
   in our 17-advert corpus mentions any of the six. Nothing in this window contradicts that, and §6
   suggests the `Projects` convention is best-evidenced in software and engineering, which is not the
   IT-PM/banking market we serve. **Strong evidence for the shape; weak evidence that our buyers care.**
   Do not let the strength of the schema convergence smuggle in a conclusion about demand.

---

## 12. Sources

Ordered by evidentiary weight.

**Primary — source code read directly (GitHub API, 2026-08-06)**
- `amruthpillai/reactive-resume` (40,041★, pushed 2026-07-31) —
  `packages/schema/src/resume/data.ts`, `skills/resume-builder/references/schema.md`.
- `rendercv/rendercv` (17,283★, pushed **2026-05-01 — stale**) —
  `src/rendercv/schema/models/cv/{cv.py, section.py, social_network.py, custom_connection.py}`,
  `entries/`.
- `yamlresume/yamlresume` (1,488★, created 2025-04-09, pushed 2026-08-03, 29 in-window commits) —
  `packages/core/src/schema/content/{content,profiles,projects}.ts`,
  `packages/core/src/models/options.ts`.
- `sadanandpai/resume-builder` (1,216★, pushed 2026-08-05) —
  `src/helpers/section-layout/sectionLabels.ts`.
- `olyaiy/resume-lm` (306★, pushed 2026-08-03) — `src/lib/types.ts`.
- `sunnypatell/ats-screener` (114★, created 2026-02-20, pushed 2026-08-02) —
  `src/lib/engine/parser/{section-detector.ts, contact-extractor.ts, types.ts}`,
  `research/ats-parsing-scoring-research.md`. Simulates Workday, Taleo, iCIMS, Greenhouse, Lever,
  SuccessFactors.

**Primary — community reference document**
- **r/EngineeringResumes wiki** (`old.reddit.com/r/EngineeringResumes/wiki/index`, retrieved
  2026-08-06) — `Section Order`, `Contact Information`, `Projects`, `Portfolios`. Auto-linked by the
  subreddit bot on every submission.

**Primary — in-window community threads (engagement stated inline)**
- r/resumes, 2026-07-13 — *"A portfolio link only helps if the resume gives a reason to click it"* —
  **13 upvotes, 5 comments**. Top comment u/Tijot891, 5 upvotes.
  `reddit.com/r/resumes/comments/1uvalz1/`
- r/EngineeringResumes, 2026-08-02 — *"[STUDENT] Is the formatting between my resume and portfolio
  effective?"* — **13 upvotes, 10 comments**. Top comment u/Happy-Property1162, 7 upvotes.
  `reddit.com/r/EngineeringResumes/comments/1vdt1v3/`
- r/EngineeringResumes, 2026-08-04 — *"[3 YoE] How do I format my projects that were done at work into
  my work experience section?"* — **4 upvotes, 2 comments**. u/trentdm99, 4 upvotes.
  `reddit.com/r/EngineeringResumes/comments/1vfctu9/`
- r/EngineeringResumes, 2026-08-05 — *"[STUDENT] UK Resume advice — Are portfolios recommended for UK
  grad positions?"* — **1 upvote, 1 comment**. `reddit.com/r/EngineeringResumes/comments/1vg204l/`
- r/EngineeringResumes, 2026-07-20 — *"[3 YoE] Software engineer — Transformed Resume"* —
  **56 upvotes, 9 comments** (highest-engagement in-window thread in the lane; contextual only).
  `reddit.com/r/EngineeringResumes/comments/1v1qap9/`

**Primary — liveness**
- GitHub org listing + repo metadata for `jsonresume/*` (2026-08-06): `resume-cli` 4,719★ archived,
  `resume-schema` 2,396★ archived (both last pushed 2026-06-12), `jsonresume.org` 288★ pushed
  2026-07-29, `registry-server` 93★ archived 2019-12-26. **One org repo pushed in-window.**

**Negative results**
- HN Algolia (`search_by_date`, `created_at_i > 1783357200`): `resume projects section` **0**,
  `portfolio resume` **0**, `cv schema` **0**, `side projects resume` 1 (false positive),
  `open source resume` 6 (5 false positives), `resume builder` 9 (mostly false positives).
- GitHub repo counts, all `pushed:>=2026-07-07` — table in §3.

**Secondary / low trust (used only where nothing better existed)**
- Career-guidance web content on GitHub-link placement (tealhq, enhancv, resumeworded, hiration,
  cvwizard, foliox, wahresume) — consistent on "GitHub link goes in the header contact block; projects
  go in a Projects section", but SEO-shaped and mutually derivative. Corroborates §1 and §2; proves
  nothing on its own.
- Web guidance on designer/marketer section naming (`Portfolio` / `Featured Projects` /
  `Selected Projects` / `Selected Work`) — **no convergence, no authority**. §6.

---

## Appendix: research run provenance

```
🌐 last30days v3.8.3 · synced 2026-08-06

Topic — "Should a CV have one Projects section or several - personal projects,
         portfolio, GitHub, personal website, side projects, open source"
---
✅ All agents reported back!
├─ 🟠 Reddit: 6 threads │ 99 upvotes │ 33 comments
├─ 🟡 HN: 4 storys │ 13 points │ 1 comments
├─ 🐙 GitHub: 3 items │ 41,817 stars │ 192 comments
├─ 🗣️ Top voices: r/EngineeringResumes, r/resumes
└─ 📎 Raw results saved to ~/Documents/Last30Days/should-a-cv-have-one-projects-
   section-or-several-personal-projects-portfolio-github-personal-website-side-
   projects-open-source-raw-v3.md
---
```

**Research quality: 3/5 core sources.** X/Twitter and YouTube unavailable (no credentials, `yt-dlp` not
installed). The Reddit relevance floor dropped 278 posts in sub-query 1 and 72 in sub-query 2. The HN
lane's prefix filter removed 17 of 21 and 18 of 21 hits as false positives.

**The engine pass contributed the four Reddit threads and confirmed the HN silence. Everything else in
this report came from direct GitHub API queries, source-code reads of five shipping tools, and the
r/EngineeringResumes wiki** — which is the correct outcome for a question whose real answer lives in
running code rather than in conversation.

## WebSearch Supplemental Results

- **Teal / ResumeWorded / Enhancv / Hiration / CVwizard** (tealhq.com, resumeworded.com, enhancv.com,
  hiration.com, cvwizard.com) — All five independently place the GitHub profile URL in the resume header
  contact block alongside email and LinkedIn, and place described projects in a separate Projects or
  Experience section. Corroborates the two-kinds split; SEO-shaped and mutually derivative, so weighted
  low.
- **FolioX** (foliox.me) — "GitHub vs Portfolio: Which Do Developers Need?" Frames them as two distinct
  artifacts serving different purposes, with a portfolio as a curated page of 3-5 projects with context.
- **WahResume** (wahresume.com) — "Portfolio Links on Your Resume: 7 Tips for 2026." Recommends placing
  portfolio links in "a project bullet, a skills section, or the top contact block" with short
  descriptive labels — the same "link needs a reason" pattern the r/resumes thread argued.
- **UConn Career Center / Planeta Formación** (career.uconn.edu, planetaformacion.com) — Non-software
  guidance treating the portfolio as a separate deliverable, with `Portfolio` / `Featured Projects` /
  `Selected Projects` / `Selected Work` offered interchangeably for designers and marketers. No
  convergence.
- **TeamBlind threads** (teamblind.com) — "should i remove projects section on resume", "projects on
  resume", "remove link to repos on github from resume". Practitioner debate on whether a Projects
  section reads as junior once you have several years of experience. Engagement not retrievable; noted
  as a live tension, not cited as evidence.
