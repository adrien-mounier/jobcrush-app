# The CV summary — what the last 30 days actually says

Research leg for [#152](https://github.com/adrien-mounier/jobcrush-app/issues/152) (recent-movement half;
the deep-source half runs in parallel against studies, eye-tracking research and primary guidance).
Serves [#143](https://github.com/adrien-mounier/jobcrush-app/issues/143), which makes the call.

The ticket asks seven questions and forbids a decision. It also names the thing under test: the shipped
**`Summary ≤ 55 words`** cap in `apps/api/prompts/preview-tailor.md` rule 10, which nothing derives, and the
**60–80 words / identity + specialisation + quantified value** shape in
`docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md` §3, which is an LLM's summary of a web search
with no primary citation.

**Windows:** stated per topic, because the layers move at very different speeds.

| Topic | Window used | Why |
|---|---|---|
| Practitioner + jobseeker sentiment (Reddit) | **30 days** (2026-07-07 → 2026-08-06) | Live and dense; the strict window works and is the whole value of this leg |
| Corpus statistics | **30 days** — one item, published 2026-07-31 | Genuinely in-window and genuinely new |
| The "6 seconds" claim | **~14 years** (2012 → 2018 → repeated verbatim in 2026) | The number every 2026 page quotes has not been re-measured; a 30-day window cannot see its origin |
| Market convention (HK · SG · VN · AU) | **~12 months** | Commercial guides refresh annually, not daily; a 30-day window returns nothing |
| ATS treatment | **30 days social + ~12 months vendor content** | No vendor documentation exists at any window length; see finding 5 |

**Run date:** 2026-08-06.

⚠️ **Read the whole file knowing what this leg can and cannot settle.** Almost everything below is
**opinion and convention**, not outcome evidence. **Not one source in this window — practitioner, vendor,
government or corpus — measures whether having a summary, or a summary of any particular length or shape,
changes a callback rate.** That absence is the most important thing this leg found, and it applies equally
to the 55-word cap we ship and to the 60–80 shape we were about to adopt instead.

---

## Bottom line

**The ticket expected to find a sourced basis for a number. There isn't one — not for 55, not for 60–80,
not anywhere. But the far more useful finding is that the loudest in-window practitioner advice does not
argue about the length of the summary at all. It argues about whether to keep it.**

Six findings, in order of how much they should move the decision:

1. 🚨 **The strongest specific advice in the window is to cut the summary or shrink it to one line — and it
   comes from the people reviewing CVs, not from the people writing career-advice pages.** The highest-scoring
   summary-specific comment I found in the window is
   [u/Chemical_Octopus, 9 upvotes](https://reddit.com/r/resumes/comments/1v5mgx4/0_yoe_unemployed_entry_level_help_desk_los_angeles/ozk8ljz/):
   *"You can remove the first sentence of your summary because it would be literally listed below in your
   education section"* and *"Remove the statement about what you're seeking. It's implied by the job that
   you're using your resume to apply to."* A project manager who hires is blunter —
   [u/pop-crackle](https://reddit.com/r/resumes/comments/1vfpy4o/9_yoe_unemployed_senior_project_manager_united/p1w72rs/):
   ⭐ ***"I don't like summaries, if you feel like you need a summary, just get rid of it and include a cover
   letter in your application."*** Two more in the same window:
   [u/dEEE_](https://reddit.com/r/resumes/comments/1vc3aaj/2_yoe_unemployed_dataanalyst_financial_analyst/p16qmwi/)
   — *"Shrink the summary to 2–3 punchy lines (or drop it entirely)"* — and
   [u/Modest_Pebble_6671](https://reddit.com/r/resumes/comments/1utqko4/3_yoe_unemployed_social_media_marketing_manager/p0z1lx6/)
   — *"on the summary: cut it or trim to one line."* **The argument is always the same and it is never about
   words: the summary is competing for the top of page one against bullets that carry evidence.**
   ⚠️ Vote counts are archive-capture floors; see the integrity note.

2. 🚨 **The three-part shape does not appear in practitioner advice, and the part our research names first is
   the part practitioners name as the defect.** *Identity* — *"Product Analyst with 1+ years of experience"* —
   is precisely what gets called generic. [u/avi_choudhary](https://reddit.com/r/resumes/comments/1vfiikc/1_yoe_employed_product_analyst_indian/p1plnzm/):
   *"Your summary is generic, 'Product Analyst with 1+ years of experience...' could describe almost anyone.
   **Lead with your strongest quantified win instead** (e.g. the 60% scope reduction)."* u/Modest_Pebble_6671
   gives the other variant: *"lead with what you specifically **do** (organic social, short-form video, paid
   media) not generic 'cross-platform campaigns.'"* **So the window contains two rival orderings —
   quantified-value-first and specialisation-first — and both work by deleting the identity clause, not by
   ordering it first.** No source in the window proposes identity → specialisation → value as a sequence.
   ✅ **The *quantified value* component survives intact and is the one thing every layer agrees on.**

3. 🚨 **AI detection is real, it is human rather than mechanical, and the summary is named as the single
   biggest tell. This is the finding that bears most directly on the product, because the product writes
   the summary.** The load-bearing item is a 20-year executive-search practitioner in
   [r/resumes, "ATS flagging AI modified CVs"](https://reddit.com/r/resumes/comments/1v0s813/ats_flagging_ai_modified_cvs/)
   (u/Existing_Brief_6476, 4 upvotes), quoted at length because every clause matters:

   > *"Executive search, 20 years, a few hundred CVs a month across my desk. **ATS systems do not run AI
   > detectors. Parsing is their job, not forensics.** The detection happens later and it is human: a
   > recruiter who reads a hundred CVs a week smells sameness in seconds. **What gives it away is never the
   > polish, it is the emptiness.** Every role with exactly four bullets of identical length. Verbs nobody
   > says out loud: spearheaded, synergized, orchestrated, elevated. **A summary that would sit equally well
   > on top of the other 99 CVs in the pile.**"*

   Corroborated in the same thread by a recruiter describing bot-authored applications —
   [u/billfarts2, 6 upvotes](https://reddit.com/r/resumes/comments/1v0s813/ats_flagging_ai_modified_cvs/):
   *"They will bold every important keyword, they will lift a lot of language from the job description."*
   And the distinction stated cleanly by u/One_Fee_2557: *"ATS parsing (structure/keywords, no AI detection
   involved) vs. a human recruiter noticing 'sameness' — these threads always confirm it's almost entirely
   the second one."* ⭐ **The practitioner test is a name test:** *"Cover your name and read the page. If it
   could be anyone's CV, it"* — the quote truncates at capture, but the same test appears independently in
   [Roleframe, 22 Jul 2026](https://www.roleframe.ai/blog/why-ai-resume-sounds-generic): *"cover your name
   and read the top third. **If the summary could belong to any candidate with your title, rewrite it.**"*

4. **Length: every number in the window is an assertion, they disagree with each other, and the only
   *measured* number is descriptive rather than prescriptive.** Nobody anywhere cites 55. Nobody cites
   60–80 either. What the window actually contains: **50 or fewer words** · **50–75 words** · **2–5
   sentences** · **2–3 sentences** · **2–4 lines** · **3–4 lines** · **30–50 words** (Vietnam) ·
   **50–150 words** (Australia). ⭐ **The single measured figure is
   [Simplify, 31 July 2026](https://simplify.jobs/blog/should-a-resume-summary-be-in-first-person): a
   median of 64 words across 23,191 resume summaries edited on their platform in twelve months.** That is a
   real, dated, in-window corpus. It is also **their own product's telemetry**, it measures **what people
   write, not what works**, and the piece **measures no outcome at all**. 🚨 **Our shipped 55 is tighter than
   every market convention in the window except Vietnam's, and tighter than the observed median of what
   people actually write.**

5. 🚨 **The claim that a keyword in the summary scores higher is vendor content with no source, and the
   practitioners flatly contradict the surrounding folklore.** The specific assertion — *"summary sections
   typically receive the highest weight (1.5x in many systems)"* — appears only in SEO resume-tool blogs.
   **No ATS vendor documents section weighting**; Workday, Greenhouse and Lever publish nothing of the kind,
   and the "1.5x" number has no attribution anywhere. Meanwhile
   [u/DorianGraysPassport](https://reddit.com/r/resumes/comments/1vgqmmx/how_do_i_get_past_ats_for_my_first_job_with_no/p215h2w/):
   ⭐ ***"There's also no such thing as an ATS score."*** ⚠️ **What is uncontested is much weaker and much
   duller: `Summary` is a standard section heading that parsers recognise**, which is a *parsing* fact, not
   a *scoring* fact.

6. **Person: the ban on first person is not supported, and third person is effectively extinct.** Simplify's
   23,191-summary corpus: **61% contain no personal pronouns at all · 37% use "I", "my" or "me" somewhere ·
   fewer than 1% are written in third person.** ⭐ **Implied first person — verbs without the pronoun — is the
   convention, and it is a convention rather than a rule: more than a third of real summaries break it.**
   Third person is the genuine error; the piece's own framing is that *"referring to yourself as 'he' or
   'she' on your own resume reads like your resume was written **about** you, not **by** you."*
   ⚠️ **The piece is observational and states plainly that no recruiter discards a CV over the word "I".**

**What contradicts the established picture, in one line each:**

- 🚨 **The 60–80 word / three-part shape our own research proposed is contradicted on both halves** — on
  length by there being no agreed number, and on shape by practitioners naming the identity clause as the
  defect (findings 2 and 4).
- 🚨 **"AI-written is fine as long as it's accurate" is contradicted** — the summary is the *first* thing that
  gets a CV read as machine-written, and the tell is genericness, which is exactly what a generated
  identity clause produces (finding 3).
- **"Recruiters read the summary first" and "recruiters skip the summary" are both live in-window, from
  practitioners, and neither is measured** (see findings by theme, §1).
- **The "career objective was replaced by the professional summary" claim is false in Vietnam**, where a
  goals-stating objective is the top block and is described as indispensable (§4).
- **The "6 seconds" number underpinning every market's advice traces to one 2012/2018 study with 30
  recruiters** (see debunks).

**What has no evidence at all:** ⚠️ **Nothing in this window measures an outcome.** No callback-rate
experiment, no A/B test, no eye-tracking study newer than 2018, no vendor telemetry linking summary
presence, length, shape or person to interviews. **Every number and every shape in this file is somebody's
opinion, a convention, or a description of what people already do.** The deep-source half may find outcome
evidence; this half did not, and the absence is measured rather than assumed.

---

## Findings by theme

### 1. Is it read? Both answers are in the window, from practitioners, and neither is measured

**The "yes" side is asserted, never demonstrated.** Every commercial 2026 guide says the summary is the
first thing read, and several attach a number: *"recruiters spend more time here than anywhere else"*,
*"the top third of your resume is where recruiters focus 80% of their attention"*. **Neither claim carries a
citation.** The 80% figure in particular appears in vendor content with no study behind it.

**The "no" side is where the practitioners are, and their reasoning is about competition for space rather
than about attention.** Finding 1's four comments all say the same structural thing: the summary occupies
the most valuable region of the page and gives back less than bullets would. u/dEEE_ makes it explicit —
*"Right now, these take up half of your first page… so your Education, Projects, and Experience move up"* —
and adds the only attention claim in the window that comes from someone who screens: *"Recruiter attention
drops off fast after page one."*

**A third position exists and is worth recording, because it is the one our product implicitly assumes.**
u/HouseOfBonnets, reviewing a CV, treats a missing summary narrative as a defect: *"The summary does not
paint a clear narrative of your current experience and what you are looking for."* And
[u/FireSheepYinFish](https://reddit.com/r/resumes/comments/1v7nao0/what_to_put_on_my_resume_when_entering_corporate/ozzhdk2/):
*"A summary is an introduction of your general high-level ability to contribute to an organization."*
**So r/resumes in this window contains, simultaneously: cut it · shrink it · keep it and make it specific ·
keep it and state your goal.** ⚠️ **That is not a corpus converging on a rule. Treating any one of these as
"what practitioners say" would be selection, not research.**

**The repo's own prior is consistent with the sceptics.** #137 found only **37% of 176,220 Kickresume
resumes** carried a summary at all. **Absence is already the majority behaviour**, and nothing in this
window suggests that is changing.

### 2. Length — eight different numbers, one measurement, zero outcomes

Side by side, everything the window offers:

| Source | Number | What kind of claim |
|---|---|---|
| **Simplify**, 31 Jul 2026, n=23,191 | **median 64 words** | ⭐ Measured — but their own platform, descriptive, no outcome |
| Jobscan (CPRW-authored) | 2–5 sentences | Assertion; author expertise, no source |
| Letter/word-count SEO pages | ≤50 words, or 50–75 | Assertion, no source |
| Morgan Philips, Hong Kong, 26 May 2026 | **3–4 lines** | Recruitment firm, market convention |
| Singapore commercial guides | 2–4 sentences, or 2–3 | Assertion, no source |
| Australian commercial guides | **50–150 words** | Assertion, no source; widest range found |
| 1Office.vn, Vietnam, 05 Oct 2025 | **30–50 words (3–5 câu)** | Assertion, domestic convention |
| **`preview-tailor.md` rule 10 (ours)** | **≤55 words** | 🚨 No source; not cited by anyone outside this repo |

**Read the spread honestly.** From 30 words to 150 is a five-fold range across markets we serve, and the
numbers are not even in the same units — words, sentences and lines are used interchangeably. **A cap
expressed in words is a choice our repo made, not a convention it inherited.** ⚠️ **And Simplify's 64 is not
a target.** It is the median of what people wrote, in a corpus of people using a resume tool, with no
evidence that 64 outperforms 40 or 90.

### 3. AI-written summaries — the mechanism, and what it means for a product that generates them

**Three separate things are being conflated everywhere, and the window separates them cleanly.**

**(a) ATS do not detect AI.** Stated by the executive-search practitioner in finding 3, and corroborated by
[Jobscan's May 2026 audit of ten major ATS platforms](https://www.jobscan.co/blog/can-ats-detect-ai-resume/),
which found **none of them detect AI-generated resumes**. ✅ **So the mechanical layer is not the risk.**

**(b) Humans detect sameness, and the summary is where they look.** Finding 3's quotes. Reinforced by
[u/OliviaPresteign, 6 upvotes](https://reddit.com/r/resumes/comments/1vfufll/are_they_testing_for_chatgpt_written_bullets/):
*"Just don't let it **sound** like ChatGPT. If it's obviously written by an LLM, then yes, many employers
will throw your resume out."* And by a professional resume writer, u/FinalDraftResumes: *"the issue isn't
that the content **was** written by AI it's that the content **'sounds'** like it was written by AI."*

**(c) Whether anyone objects to AI *in principle* is a different question, and the answer is mostly no.**
u/FinalDraftResumes again: *"Recruiters aren't out there checking to make sure that your resume wasn't
written by AI. That's not what they're looking for… It doesn't matter if your resume was written by AI or
you wrote it yourself. It just matters that it paints you as a credible candidate."*

⭐ **Read (a)+(b)+(c) together and the product implication is sharp, and it is not a warning about honesty.**
Nobody in this window penalises a machine-assisted CV. What gets penalised is **a summary that could top
anyone's CV**. **That is a genericness failure, not an AI failure** — and it is the exact failure mode of
generating an identity clause from a role title. ⚠️ **This does not argue for suppressing the summary; it
argues that a generated summary must carry the candidate's specifics or it actively signals machine
authorship.**

🚨 **One dissent, and it matters because it inverts the advice.**
[u/Won-Ton-Wonton](https://reddit.com/r/resumes/comments/1v0s813/ats_flagging_ai_modified_cvs/):
*"If your resume looks like every other good resume, then it's doing the job right… **The more generic your
resume, the better off you'll be when the ATS** [reads it]."* **He is arguing about the machine layer while
everyone else is arguing about the human layer, and on the machine layer he may well be right.** The
uncomfortable reading is that **the two layers pull in opposite directions**: sameness helps a parser and
kills you with a screener. Nobody in the window resolves this.

**And one item of employer-side reaction worth noting as direction, not evidence.** Two Show HN launches in
the window pitch tools against AI application volume — [*"AI resume spam ruined hiring so I built a tool to
keep the bots out"*](https://news.ycombinator.com/item?id=49008695) (22 Jul, 2pts) and
[*Permanym, "for hiring teams overwhelmed by AI resume spam"*](https://news.ycombinator.com/item?id=49085054)
(28 Jul, 2pts). ⚠️ **Both are 2-point Show HNs with one comment each. This is founders' perception of a
market, not a measurement of one.**

### 4. Markets — three converge, Vietnam diverges, and the divergence is the same shape as #151's

**Hong Kong.** [Morgan Philips, 26 May 2026](https://hk.morganphilips.com/insights-hk/how-to-write-a-cv-for-hong-kong-in-2026)
— a personal statement is recommended, **3 to 4 lines**, *"summarising what you do and the role you are
seeking"*. The same page carries *"a Hong Kong recruiter spends 6 to 8 seconds on your CV at first scan"*
(applied to the experience section). Robert Walters HK's guide is **403-blocked** from this environment and
could not be read.

**Singapore.** Commercial guides converge on **2–4 sentences** and add one market-specific instruction:
**name bilingual capability in the summary**. Singapore's government careers portal has a dedicated
executive-summary page, but its body content did not render on fetch and its listed publication date is
**10 September 2021** — outside any reasonable window, and not usable as recent movement.

**Australia.** Called **"Career Profile"** or **"Executive Summary"** rather than professional summary,
**50–150 words**, and described as *"your 6-second pitch"*. ⚠️ **The widest length range of the four markets
and the one most explicitly anchored to the 6-second claim.**

**Vietnam — the divergence, and it is structural rather than cosmetic.** The top block is
**mục tiêu nghề nghiệp — a career *objective*, not a summary.**
[1Office.vn, 05 Oct 2025](https://1office.vn/muc-tieu-nghe-nghiep): **30–50 words (3–5 sentences)**, placed
*"ngay dưới phần thông tin cá nhân, tại trang đầu tiên"* — immediately below personal details on page one —
and 🚨 **it must state both short-term (1–3 years) and long-term (5–10 years) goals**.
[Vieclam24h](https://vieclam24h.vn/nghe-nghiep/la-ban-su-nghiep/muc-tieu-nghe-nghiep-chia-khoa-cua-moi-cv-thanh-cong)
calls it *"phần không thể thiếu"* — an indispensable part.

🚨 **This directly contradicts the repo's own note that career objectives are "replaced by the Professional
Summary", and it contradicts finding 1's highest-scoring comment** (*"Remove the statement about what you're
seeking"*). **In Vietnam the goal statement is the point of the section.** ⚠️ **Same pattern as
[#151](https://github.com/adrien-mounier/jobcrush-app/issues/151): three markets agree, Vietnam diverges, and
the divergence is only visible in the local language.** Unlike #151's photograph, **this divergence is one we
can act on** — it is text, and the renderer prints text.

### 5. ATS — inert to detection, standard for parsing, undocumented for scoring

Covered in finding 5. Three claims, three different confidence levels:

- ✅ **`Summary` is a recognised section heading** and a single-column reverse-chronological layout parses
  reliably. Uncontested, boring, and the only ATS fact this leg would put weight on.
- ⚠️ **Section-level keyword weighting is asserted by resume-tool vendors and documented by nobody.** The
  "1.5x" figure has no source. Do not build a rule on it.
- 🚨 **"ATS score" as a concept is disputed by practitioners in-window.** Treat any product claim about
  improving one as unfalsifiable.

⚠️ **And the folk-theory layer is loud and wrong in both directions**, exactly as #151 recorded for photos.
The best in-window illustration is a Senior HR Specialist's account in
[r/jobs](https://reddit.com/r/jobs/comments/1vgwvi1/i_am_the_recruiter_who_actually_tests_your_ats/) of the
white-font keyword-stuffing hack: the parser extracted the hidden text into the review screen as *"massive
blocks of unformatted gibberish right at the top of the page"*, pushing real experience to page three — and
the candidate had pasted their ChatGPT prompt in with it, *"Make me sound qualified even though I have zero
management experience."* ⭐ **The line that matters for us:** *"ATS systems are not magical AI overlords;
they are glorified keyword filters."* ⚠️ **Single-author anecdote, 1pt, unverifiable, and the post ends with
a cat photo — cited as colour, not as evidence.**

### 6. 🚨 The advice supply itself is contaminated, and this changes how the next leg should read Reddit

**The one in-window post framed as senior recruiter advice on summaries is a product advertisement, and the
community said so.** [*"After 10+ Years in Recruiting, Here Are the Biggest Resume Mistakes"*](https://reddit.com/r/resumes/comments/1uxdbd3/after_10_years_in_recruiting_here_are_the_biggest/)
sits at **0 points**, ends in a link to the author's own tool, and its top two replies are
*"Another AI slop"* (u/Jkg2116, 3) and *"reddit needs to add an AI content filter who wants to read this slop
bru"* (u/tweever38, 2). ⭐ **Its section on generic summaries reads, verbatim: *"If your summary starts with:
> or >"* — the two example openings are empty blockquotes.** The one piece of in-window recruiter advice
specifically about generic summaries has a hole exactly where its evidence should be.

⚠️ **This is not an isolated post. The vendor layer reaches into the subreddit's own furniture:** r/resumes'
**AutoModerator** greets every poster with a link to a commercial ATS-checking product. Add the tool-authored
blog posts surfaced this run (Roleframe, Simplify, Jobscan, careerspy) and the picture is that **almost every
"practitioner" voice on this topic has something to sell.**

⭐ **The signal survives, but only by source type.** What held up under scrutiny were **unsolicited peer
reviews of a stranger's CV** — u/Chemical_Octopus, u/pop-crackle, u/Modest_Pebble_6671, u/avi_choudhary,
u/Existing_Brief_6476. Nobody is selling anything in a CV-critique reply. **The next leg should weight
critique-thread comments over anything shaped like advice.**

---

## Debunks — three claims that do not survive checking

**1. 🚨 "Recruiters spend 6 seconds on a CV" is one small study, quoted in four markets, never re-measured.**
The number originates in **TheLadders' eye-tracking study — 6 seconds in 2012, revised to
[7.4 seconds in 2018](https://www.theladders.com/static/images/basicSite/pdfs/TheLadders-EyeTracking-StudyC2.pdf)
— with a sample of 30 recruiters.** [ERE's critique](https://www.ere.net/is-the-6-second-resume-scan-a-myth/)
names the problems: sample size, undisclosed recruiter selection, undisclosed roles being screened, and no
stated instructions. ⚠️ **Every market page in §4 rests on it** — Hong Kong's *"6 to 8 seconds"*, Australia's
*"6-second pitch"*, the *"6-second scan"* in the general guides. **Four markets, one 2012 study, thirty
people.** ✅ **It is not necessarily wrong. It is simply the only measurement anyone has, it is fourteen years
old, and repetition has laundered it into a fact.**

**2. 🚨 "Summary keywords score 1.5x" — no vendor documents it and no study supports it.**
The figure circulates only in resume-tool SEO content. **Workday, Greenhouse and Lever publish nothing about
section weighting.** The closest defensible statement is that different platforms search differently — Workday
text-extraction plus a relevance model, Greenhouse boolean field search, Lever full-text and tag-based — and
even that comes from a third-party comparison, not from the vendors. **Cite nothing for this claim, because
there is nothing to cite.**

**3. "Never write a CV in the first person" is a style convention presented as a rule.**
Simplify's corpus puts **37% of real summaries using "I", "my" or "me" somewhere**. A rule broken by more than
a third of the population is a convention. ✅ **What the data does support is the narrower claim: third person
is vanishingly rare (<1%) and reads as though someone else wrote your CV.** ⚠️ **Caveat the corpus: it is one
vendor's platform telemetry, self-published, with no independent replication.**

---

## What each platform yielded

| Platform | Yield | Notes |
|---|---|---|
| **Reddit** | ⭐ **The only source of genuine practitioner voice, and it carried the entire leg.** ~450 posts across 16 subreddits; ~250 comments read across 17 threads | Reddit's live surfaces remain **403-blocked** (WebFetch and the engine's own fetch). **arctic-shift is the unlock again — and this run learned its actual contract, which the prior three legs got wrong.** The posts endpoint takes **`query`**, the comments endpoint takes **`body`**; `q` returns 400. 🚨 **And `422 Unprocessable Entity` is not an invalid query — the body reads `{"error":"Timeout. Maybe slow down a bit"}`.** #151 recorded 422s as failed queries; **they were rate-limit timeouts and were retryable.** ~40% of my calls still 422'd at 1-2s spacing. ⚠️ Scores are ingest-time floors. |
| **Web (native search)** | **Everything on the convention, market and vendor side** | Also the only route to the Vietnamese corpus, which again produced the one real market divergence. Two high-value pages were unreadable: **Robert Walters HK (403)** and **Singapore's MyCareersFuture** (body did not render). |
| **Corpus statistics** | ⭐ **One item, and it is the best number in the file** | Simplify's 23,191 summaries, 31 Jul 2026. **In-window, dated, sized — and vendor-owned with no outcome measure.** |
| **Hacker News** | **Nothing on topic. Fourth consecutive research leg to find this.** | 17 stories via the engine, 29 via direct Algolia across four queries. 🚨 **"resume" on HN is a keyword collision with the verb** — the top in-window hits were *"Quil, a terminal multiplexer that **resumes** AI sessions"* and *"Agentpause… **resumes** cleanly"*. The three genuinely on-topic items were 2-4 point Show HNs. |
| **YouTube** | **Zero in-window items. Recorded as measured-and-empty.** | The engine found 8 videos per query, **0 within the date range**, four times over. My own `yt-dlp` sweep of 18 results returned nothing newer than **2026-01-19**; a date-sorted search returned **zero rows**. ⚠️ **Career-advice video is a large corpus but it is evergreen — it does not refresh on a 30-day cycle.** Do not re-run this lane at a 30-day window. |
| **GitHub** | **Nothing usable, and one thing to avoid repeating** | 16 items, all CV-template repos. The engine's "top community comments" surfaced **five bot comments** (`coderabbitai`, `vercel[bot]`, `claude[bot]`, a Linear linkback) as ranked community voice. **Not evidence of anything.** |
| **Polymarket** | Zero relevant markets | Expected. The engine's domain expansion offered *Saudi Professional League* against the word "professional". |
| **X / Twitter** | **Not searched** | No credentials (`bird_authenticated: false`, no `XAI_API_KEY`, Windows + no Firefox cookies). **Fourth consecutive leg with this gap**, and for *this* question — where recruiter commentary genuinely lives on X and LinkedIn — **it is the largest single hole in the leg.** |
| **LinkedIn** | **Not reachable** | No API, no scraping route, and web search surfaces only SEO pages *about* LinkedIn summaries. ⚠️ **The ticket asked specifically for LinkedIn practitioner commentary and this leg could not deliver it.** State this plainly to #143 rather than substituting blog content for it. |
| **TikTok / Instagram** | **Not searched** | No ScrapeCreators key. |

**The prior legs' platform finding replicates a fourth time, with one addition:** neither code nor prediction
markets is ever the vein. **For this question the vein was Reddit CV-critique threads specifically** — not
Reddit advice posts, which finding 6 shows are vendor-contaminated.

---

## What this means for #143 (not decisions — inputs)

- 🚨 **There is no sourced basis for any word cap, including the one we ship.** #143 can keep 55, move to 64,
  or drop the cap — **but it cannot claim any of the three is evidence-backed**, and the honest record is that
  55 was invented here. If a number is kept, the defensible framing is *a product constraint chosen for
  density*, not *the researched length of a CV summary*.
- 🚨 **The clause #143 is minded to make mandatory — a concrete achievement in the summary — is the one thing
  every layer of this window agrees on.** Practitioners, vendors and the AI-detection discussion all converge
  on it, from three unrelated directions. ⚠️ **It is still not outcome-tested.** It is the best-supported
  clause available, which is not the same as a proven one.
- 🚨 **The three-part shape should not be adopted as written.** Its *quantified value* component is the
  strongest finding in the file; its *identity* component is the thing practitioners point at when they say
  a summary is generic — **and genericness is precisely the AI tell that our generated summaries will
  produce by default.** A shape that leads with specialisation or with the number, and treats the role-title
  identity clause as optional, is closer to what the window supports.
- ⭐ **The corpus finding from #152's brief holds and gets sharper: the shape is the problem, not the length.**
  Three of our five summaries being capability lists is the exact defect the window names. **A 55-word
  capability list and an 80-word capability list fail identically.**
- **Person: implied first person, and stop banning "I".** Third person is the real error and is already
  near-extinct. ⚠️ **If any rule is written, it should forbid third person and be silent on "I"** — a ban on
  first person would be stricter than 37% of real-world practice.
- 🚨 **Vietnam needs its own answer and it is not a length answer.** A Vietnamese CV's top block states career
  goals, short and long term, and our note that objectives were "replaced by the summary" is wrong for that
  market. ⚠️ **This is a content divergence, not a formatting one, and unlike #151's photograph it is
  something the renderer can act on.**
- ⚠️ **Do not build anything on ATS summary weighting.** It is undocumented. The only safe ATS statement is
  that `Summary` parses as a standard heading.
- ⚠️ **Two questions this leg could not answer and #143 should not treat as answered:** whether having a
  summary changes callback rates (**nothing in the window measures any outcome**), and what recruiters are
  saying on **X and LinkedIn**, which were unreachable. **Both belong to the deep-source half or to a future
  leg with X credentials.**

---

## Sources

**Primary — corpus statistics (the only measured item in the window)**

- [Simplify — *Should a Resume Summary Be in First Person? We Checked 23,000 Resumes*](https://simplify.jobs/blog/should-a-resume-summary-be-in-first-person)
  — published **31 July 2026**, updated 1 Aug 2026. **n=23,191** summaries edited on Simplify over twelve
  months. **61% no pronouns · 37% first-person pronoun somewhere · <1% third person · median 64 words.**
  ⚠️ Vendor platform telemetry; descriptive only; **measures no outcome**; author leads Recruiting &
  Employer Branding at Simplify.

**Primary — Reddit, window 2026-07-07 → 2026-08-06 (via arctic-shift; scores are ingest-time floors)**

- [ATS flagging AI modified CVs](https://reddit.com/r/resumes/comments/1v0s813/ats_flagging_ai_modified_cvs/)
  — **r/resumes, 22 comments** — the run's single best thread. u/Existing_Brief_6476 (4, executive search
  20yrs, *"a summary that would sit equally well on top of the other 99 CVs"*) · u/billfarts2 (6, recruiter,
  bot-application tells) · u/FinalDraftResumes (4, resume writer) · u/One_Fee_2557 (parsing vs sameness) ·
  u/Won-Ton-Wonton (2, the generic-is-good dissent) · u/InternetSandman (15, *"Aren't people taught to tailor
  their resumes… Now it's a red flag?"*)
- [Are they testing for ChatGPT written bullets?](https://reddit.com/r/resumes/comments/1vfufll/are_they_testing_for_chatgpt_written_bullets/)
  — **r/resumes, 9 comments** — u/OliviaPresteign (6) · u/Future-Station-8179 (5) · u/FinalDraftResumes (3)
- CV-critique comments naming the summary (r/resumes, all in-window):
  [u/Chemical_Octopus (9)](https://reddit.com/r/resumes/comments/1v5mgx4/0_yoe_unemployed_entry_level_help_desk_los_angeles/ozk8ljz/) ·
  [u/pop-crackle (2)](https://reddit.com/r/resumes/comments/1vfpy4o/9_yoe_unemployed_senior_project_manager_united/p1w72rs/) ·
  [u/Modest_Pebble_6671](https://reddit.com/r/resumes/comments/1utqko4/3_yoe_unemployed_social_media_marketing_manager/p0z1lx6/) ·
  [u/dEEE_](https://reddit.com/r/resumes/comments/1vc3aaj/2_yoe_unemployed_dataanalyst_financial_analyst/p16qmwi/) ·
  [u/avi_choudhary](https://reddit.com/r/resumes/comments/1vfiikc/1_yoe_employed_product_analyst_indian/p1plnzm/) ·
  [u/electricalgirl97](https://reddit.com/r/resumes/comments/1vfgmf6/6_yoe_unemployed_marketing_usa/p1ujsc6/)
  (*"The summary part is outdated these days and invalidates your strong work experience"*; also ⭐ *"A resume
  is not a work documentation but a marketing certificate for your experience and persona"*) ·
  [u/HouseOfBonnets](https://reddit.com/r/resumes/comments/1vfc4xa/4_yoe_quality_assurance_hr_chicago/p1otqw3/) ·
  [u/DorianGraysPassport](https://reddit.com/r/resumes/comments/1vgqmmx/how_do_i_get_past_ats_for_my_first_job_with_no/p215h2w/)
- [I am the recruiter who actually tests your ATS resume hacks…](https://reddit.com/r/jobs/comments/1vgwvi1/i_am_the_recruiter_who_actually_tests_your_ats/)
  — **r/jobs, 2026-08-06** — Senior HR Specialist; white-font hack; *"glorified keyword filters"*.
  ⚠️ Anecdote, unverifiable.
- [After 10+ Years in Recruiting…](https://reddit.com/r/resumes/comments/1uxdbd3/after_10_years_in_recruiting_here_are_the_biggest/)
  — **r/resumes, 0pts** — cited only as evidence of finding 6: product plug, empty example blockquotes,
  top replies *"Another AI slop"* (u/Jkg2116, 3) and u/tweever38 (2).

**Primary — Hacker News, in-window (via Algolia)**

- [Why Your AI Resume Sounds Generic (and How to Fix It)](https://news.ycombinator.com/item?id=49013985) — 22 Jul 2026, 4pts, 0 comments
- [Show HN: AI resume spam ruined hiring so I built a tool to keep the bots out](https://news.ycombinator.com/item?id=49008695) — 22 Jul 2026, 2pts
- [Show HN: Permanym – for hiring teams overwhelmed by AI resume spam](https://news.ycombinator.com/item?id=49085054) — 28 Jul 2026, 2pts

**Secondary — the "6 seconds" chain (read the sample size before quoting)**

- [TheLadders — Eye-Tracking Study 2018 (PDF)](https://www.theladders.com/static/images/basicSite/pdfs/TheLadders-EyeTracking-StudyC2.pdf)
  — **7.4 seconds, n=30 recruiters**; 2012 predecessor gave 6 seconds ·
  [HR Dive coverage](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/)
- [ERE — *Is the 6-Second Resume Scan a Myth?*](https://www.ere.net/is-the-6-second-resume-scan-a-myth/)
  — the methodological critique

**Low-trust (commercial / SEO / vendor — cited to show what the visible advice corpus contains)**

- [Roleframe — *Why Your AI Resume Sounds Generic*](https://www.roleframe.ai/blog/why-ai-resume-sounds-generic)
  — updated **22 Jul 2026**; the *name test*; three named AI tells. ⚠️ **Vendor, assertion-only, no data.**
- [Jobscan — *Can ATS Detect AI Resumes?*](https://www.jobscan.co/blog/can-ats-detect-ai-resume/) — May 2026
  audit of ten ATS platforms, **none detect AI**; ⚠️ vendor-run, methodology not published ·
  [Jobscan — *How to Write a Resume Summary*](https://www.jobscan.co/blog/resume-summary/) — 2–5 sentences,
  **no source cited**
- [Morgan Philips HK — *How to Write a CV for Hong Kong in 2026*](https://hk.morganphilips.com/insights-hk/how-to-write-a-cv-for-hong-kong-in-2026)
  — **26 May 2026**; personal statement **3–4 lines**; *"6 to 8 seconds"*
- [1Office.vn — *Mục tiêu nghề nghiệp*](https://1office.vn/muc-tieu-nghe-nghiep) — **05/10/2025**;
  **30–50 từ (3–5 câu)**; short-term 1–3 yrs + long-term 5–10 yrs; placed *"ngay dưới phần thông tin cá nhân"* ·
  [Vieclam24h](https://vieclam24h.vn/nghe-nghiep/la-ban-su-nghiep/muc-tieu-nghe-nghiep-chia-khoa-cua-moi-cv-thanh-cong)
  — *"phần không thể thiếu"*
- Singapore and Australia commercial guides (visualcv, careerbldr, resumevera, crispresume, resumemate,
  airesume.guru) — 2–4 sentences / 50–150 words; **no method disclosed by any of them**
- resumeoptimizerpro, atsverification, owlapply, atscvchecker, jobloo — ATS scoring and the unsourced
  **"1.5x summary weighting"** claim; see debunk 2

**Not searched:** X/Twitter (no credentials), TikTok/Instagram (no key).
**Searched and empty:** YouTube (0 in-window, measured twice), Polymarket, GitHub, Hacker News (4th leg running).
**Blocked / unreadable:** Reddit live surfaces (403), Robert Walters HK (403), r/EngineeringResumes and
r/resumes wikis (403 on every route tried), MyCareersFuture executive-summary page (body did not render).
**Corrected from prior legs:** arctic-shift `422` is a **retryable timeout**, not an invalid query; the posts
endpoint parameter is **`query`** and the comments endpoint parameter is **`body`**.
