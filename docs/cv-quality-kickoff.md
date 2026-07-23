# CV quality — design decisions

_Grilling session 2026-07-22. Locked decisions only; open questions listed at the end._

The trigger: reading a real tailored CV, the sentences felt over-complex, unclear, and
AI-generated. Before S3 ships, the output itself has to get better — this is the core of the
product. The session went wider than sentence style and landed on **how we define and measure CV
quality at all**.

**Order chosen: build the ruler before fixing the symptom.** Every later change to prompts or
rules gets scored against the workbench, not tuned by feel.

---

## 1. What quality means

**Quality = fit to the job.** A CV is good if it says what the hiring company wants to hear.

Every claim stays **grounded in real experience the user confirms they have**. The user is the
truth gate; the accept/deny deck (S2) is the seam. This extends "own your facts" to "surface the
facts you forgot".

Why the shift: users arrive with a CV written in a hurry, half their experience missing, or no CV
at all. A CV is bounded (2 pages, 4-6 bullets per role), so it can never hold everything — the job
offer decides what to surface.

## 2. Enrichment: surface, don't invent

The engine derives a **target checklist** from the job offer (the "perfect CV" for this role),
then grills the user against it:

> "C matters a lot for this offer. Do you have any experience with it — even a school or personal
> project?"

Real experience → a claim, scaled to it. No experience → swipe left, nothing added.

Important: "school or personal project" is one example, not the list. The model should actively
find other framings where the user's real experience can be articulated.

The checklist decides **what we ask about**. The user's answers decide **what goes on the CV**.
Suggestions fire even for non-critical gaps, bounded by what the CV already demonstrates.

## 3. Claim strength and the chips

Claims are written **at full strength** — the confident version, not a hedged one:

> "3+ years writing C, including a personal trading app. Comfortable with memory management,
> performance tuning, and low-level debugging."

The user told us two things (3 years of C at school, a trading app). The model inferred the rest
(memory management, performance tuning, debugging) from what C work normally involves. That
inference is the point — it saves six grill questions, and users under-report.

**The inferred specifics are chips the user can switch off.** They are `suggested` in the claim
graph, so the deck already has the vocabulary. One card, one screen, one tap each.

- UI label: **"Suggested details — tap any you didn't do"**
- Notice on the card: anything kept **becomes part of the profile, and an interviewer may ask
  about it**.
- Kept chips become confirmed claims. Dropped chips never enter the graph. Interview prep only
  ever covers what survived.

**The chips are the intensity control.** An earlier design had two versions (honest / stronger)
with a slider; dropped — one version plus switchable specifics is simpler and does the same job.

Per claim the user also chooses:
- **Keep on my profile** — reused automatically next time a CV needs it.
- **Just this CV** — not reused. *Default taken:* "not reused" ≠ "forgotten". A claim that went
  out on a real application stays attached to that application, so the user knows what they
  claimed. One field on the claim, not a subsystem.

## 4. Two dials: claim big, write plain

Claim size and writing style are **separate dials**. Turning up the claim must not turn up the
density.

Same claim, plain words:

> "3+ years writing C, including a personal trading app. Comfortable with memory management,
> performance tuning, and low-level debugging."

not

> "3+ years building systems-level software in C language, including a personal algorithmic
> trading application. Solid grasp of memory management, performance optimization, and low-level
> debugging."

The second is longer, denser, and carries two documented AI tells — the rule-of-three, and
"solid" (which `research/2026-05-09_ai-writing-tells.md` lists as the *replacement* for the banned
"robust"; the model reached for the safe synonym anyway).

**Keywords:** the top ~5 mandatory keywords from the offer all go in the **skills block** (the ATS
reads the whole page, it does not care where the word is). The top **1-2** also appear inside a
real bullet, so they read as proven rather than merely listed. Not all 5 — density stays low.

## 5. The score: two numbers, never mixed

| Score | What it measures | How |
|---|---|---|
| **Well made** | Is this a good CV at all? | `docs/cv-brain/cv-authoring-rules.md` + `research/*` — bullet caps, section order, forbidden glyphs, banned words, action verbs, rule-of-three, KPIs. **Mechanical.** |
| **Aimed at this job** | Did we surface and target the right things? | Needs the job offer **and** the user's confirmed claims. **Model-judged.** |

They never merge into one total. A beautifully-written CV pointed at the wrong job must not score
a mediocre middle number that hides which half broke. Bad "well made" → fix the writing prompt.
Bad "aimed" → we forgot to ask about something the job wanted.

**The rulebook already is the ruler.** `cv-authoring-rules.md` plus the four research files hold
the categories; most are countable, and part already exists in code (glyph guards in `audit.ts`,
`conservationIssues()` in `preview.ts`). But note: **not one rule in it looks at the job offer** —
a plumber's CV can score full marks and still be sent to a C job. Hence the second number.

## 6. Who grades what

**Anything countable gets counted, never judged.** A model asked "does this sound AI-generated?"
will pass its own slop — it wrote that style because it believes it is good. It cannot smell
itself.

- **Lint** owns everything mechanical: sentence length, banned words, the rule-of-three, glyphs,
  bullet caps, section order, repeated openers. Free, instant, deterministic.
- **A fresh model** (never saw itself write the CV) judges only what counting cannot see: is the
  claim clear, does it match the job, did we miss something.
- **A panel of 4-5 different models** on those judgment calls, for several opinions instead of one
  model's taste.

**The scorer sees the CV *and* the user's confirmed claims.** Without the claims, "C is missing"
looks identical whether we forgot to ask (our bug) or the user genuinely has no C (not our
problem). With them, the score measures **our pipeline's work, never the user's career** — the
same line the S2 gate already draws.

## 7. The workbench (built first)

Not a live per-user meter. A **workbench**: run it on a fixed set of test cases after changing a
prompt, and see whether the change helped.

- **Test cases = real CVs** (messy, non-native, incomplete — that is the hard case). LLM-written
  CVs would poison it: robot input, robot output, and the tell we are hunting never appears.
- **Job offers from LinkedIn**, real where possible, generated as a fallback. Several CVs can
  target the same offer — that is how we see whether every tier converges to the same shape.
- **Start with ~5 cases, not 20.** Detecting a 10% change statistically needs ~100 cases; we will
  never have 100. The early workbench is a magnifying glass, not statistics — run it, read every
  output.

## 8. Job families (this is E5)

Two layers, both needed:

- **Family floor** — what any "project manager" job expects. Slow-changing, researched
  **offline, monthly**, per big job category (all the "IT PM" / "senior PM" variants collapse into
  one). Guarantees we never miss the obvious.
- **This specific ad** — SAP, French, a security clearance. Only ever in the ad itself. **One
  cheap LLM call per job offer**, ranked requirements out.

> ⚠️ **Corrected 2026-07-23** ([#6](https://github.com/adrien-mounier/jobcrush-app/issues/6)). This
> said `tailoring-reasoning.md` §4 already contained a hand-written family floor for PM/PO/PdM.
> **It does not.** §4 is a *discriminator* — it picks which role language the CV adopts — and it
> explicitly ignores the shared baseline as "too generic". A floor is made of exactly that baseline.
> **The family floor does not exist yet; E5 builds it from scratch.** (It is §2's closing note, not
> §4, that says the machinery is role-agnostic.)

**This session gave E5 (the cluster engine, JC-33/34/35) its real shape** — it is the offline family
research plus the per-ad call. What discovery needs that research to hand back — ranked bands, and per
item a question, its answer options, a CV section and whether a "no" is fatal — is specified in
`docs/onboarding-reward-design.md` §6.2.

Its **"shared baseline (ignore — too generic)"** list is load-bearing for the keyword ranker: a
word only counts if it *separates* this family from the others. "Stakeholder management" appears
in every ad and aims nothing.

**Cost tracking is a requirement, not a nice-to-have** — cost per job offer, tracked over time
with real users. The guestbook already logs runs; cost is one more column on the same row.

---

## Open — each needs its own session

- **A. The grill's stopping rule / UX.** Users are lazy and under-report; we cannot interrogate
  them for an hour, and we cannot infer a thin profile from a thin answer. How many questions,
  when do we stop, and how do we make answering not feel like a chore? Ideas to explore:
  gamification, levels, visible progression, effort/reward. Needs real research into how other
  apps do onboarding. **Next session — `/wayfinder`.**
- **B. Feeding and maintaining `cv-authoring-rules.md`.** How rules get in, how they stay current,
  which rules we actually commit to. The concrete readability rule (sentence-length cap, one idea
  per bullet) lands here. **Backlog, after A.**
