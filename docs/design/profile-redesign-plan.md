# Profile screen redesign — the plan

**Owner brief, 2026-08-09 (session 102), on ticket #176.** The owner wants to re-think the profile
screen completely, in five parts, each tackled in its own dedicated session. This document is the
plan of record: what each part is, what decided ground it touches, what must be audited before
designing, and the session order.

## How to run a session from this document

A fresh session opened with *"let's work on `docs/design/profile-redesign-plan.md`"* should:

1. Read this document whole, then the **status ledger** below — the next `open` session in R2
   order is the work, unless the owner names another.
2. Work as the **senior UX/UI designer persona** with the owner interactively (creative proposals,
   challenge his direction, then build his call). Prototype evidence lives in
   `apps/web/prototypes/` — round-2 work continues in `profile-desktop-options.prototype.html` or
   a new `profile-desktop.prototype.html` once the redesign converges. **Screenshot prototypes
   (Playwright) before showing them.**
3. When a part closes: post the decisions on **#176** · update this doc (mark the ledger row
   `done`, fold decisions into the part's section, prune resolved hazards) · session-log entry ·
   commit and push when green.

### Status ledger

| Session | Parts | Status |
|---|---|---|
| R2-a | 2 + 3 — colour/count semantics, category table, stretch word | **open — next** |
| R2-b | 4 — CV-section regroup audit → its own ticket | open |
| R2-c | 5 — list view + constellation restructure | open (gated on a + b) |
| R2-d | 1 — rail: Location + eligibility, Job Family | open |

### Decisions already taken (do not reopen)

- Desktop shape **A — field + right rail** (owner, session 102).
- The profile is the **home of the search-area change** (#173, recorded there).
- ⭐ **Stretches stay off the profile entirely** (owner, session 102, closing the brief's open
  question): *"a stretch is a fact about one application, never about you."* Neither sky nor list
  draws them — ADR-0005 kept structural, not visual. Part 3's category table row is decided;
  the R2-a session inherits this closed.

**Standing context:** desktop shape **A (field + right rail)** is chosen (owner, session 102, from
`apps/web/prototypes/profile-desktop-options.prototype.html`). The Sorted / Constellation toggle
survives (owner, #176). The hidden-"no" decision (a profile never lists your gaps, 2026-07-23) was
not reopened and stands unless a session below explicitly reopens it.

---

## Part 1 — The right rail: Location and Job Family sections

**What the owner wants**

- Two distinct rail sections, each with a dedicated icon:
  1. **Location** — where you're searching. **Eligibility moves here** (out of the
     constellation/list), editable in place — e.g. work rights ("can you work in X without
     sponsorship") lives with the location it is about.
  2. **Job family** — the role searched (e.g. *IT project manager*) plus, in a nice design, the
     **related roles of the same family** (*project manager, delivery manager, …*).

**Decided ground it touches**

- #173: the search-area change was decided onto the profile this session — the Location section is
  its home. #173's validation, coverage message and "fetching new market" waiting state apply.
- #120 (owner ruling): **no per-case eligibility editor** — the general mechanism is "listed, shows
  where it came from, correctable by re-opening the original question with the answer kept."
  Moving eligibility into the Location section must stay that mechanism, only re-homed.

**To audit / open questions**

- **Which eligibility facts move?** Work rights → Location is natural. **Languages are both** an
  eligibility answer *and* a CV section (Part 4's LANGUAGES). Decide the single editing surface —
  two doors to the same answer is how contradictions ship. Years-experience is worked out, never
  edited anywhere (ADR-0008, the Mei rule) — it must not appear as editable here.
- **Job family data: does it exist?** The concept exists in the model (posting family fit — E5/#86;
  the family floor / ranked essential floor — CONTEXT.md; family authority in retrieval — #101).
  What the rail needs is different: **sibling role titles of the searched family**. Candidate
  source: the role taxonomy in `docs/cv-brain/tailoring-reasoning.md`. Audit whether a
  family → sibling-titles mapping exists anywhere today, or whether this section needs its own
  small backend ticket.
- What is the family section *for*, product-wise? Display only ("your search covers these"), or a
  control ("also search these")? The answer changes the design entirely. **Owner to decide in the
  session.**

**Deliverable:** rail design in the round-2 prototype; a backend ticket if the family mapping
doesn't exist.

---

## Part 2 — Kill the "waiting for a job that asks" framing?

**What the owner thinks** — the line "*N are waiting for a job that asks for them*" (and the whole
"reserve" framing) adds confusion, not information: those facts will be pulled in when a job asks,
and not before, so announcing them beforehand buys nothing.

**Designer's position going into the session (to be argued, not assumed):** mostly agree on the
*sentence*, disagree on losing the *distinction*. The gold/grey split earns its place because it
answers a question users really ask — "I told you X, why isn't it on my CV?" — with "space, not
rejection." But the *"waiting for a job that asks"* phrasing makes the machine sound like it's
holding things back. Part 5's reframe already contains the fix: **"your CV shows the strongest
selection right now; the rest is kept and used when an offer needs it"** — same truth, told about
the CV instead of about a queue. Proposal: the count line dies, the colour distinction stays,
re-captioned.

**Decided ground it touches**

- The colour axis "gold = on your CV now" (owner decision 2026-07-24) — *kept* under this proposal;
  only the copy layer changes.
- §8.1's "honest line" (the profile outgrows the two-page CV; both counts only grow) — the
  progression story loses its counter. Check in the session: does the hero count ("24 things
  you've told me") carry the progression feeling alone? (Position: yes.)

**Deliverable:** decision on #176; copy updated in the prototype. Merges naturally into Part 3/5's
session — see session plan.

---

## Part 3 — What the constellation's colours mean (and the categories inventory)

**What the owner wants** — if the reserve framing dies: **gold = in the root CV** (the audited base
CV) vs **grey = not kept on the CV for now** (until an offer needs it), plus the stretched things,
plus anything not yet thought of. Also: **a different user-facing word for "stretch."**

**Categories inventory — the full list of things the model can hold, so nothing is missed** (this
is the checklist the owner asked for; each needs a decision: shown? where? what colour?):

| Category | Today | Note |
|---|---|---|
| Fact on the root CV's default render | gold | The owner's proposed gold. "Root CV" vs "current tailored CV" must be pinned — they differ after tailoring. |
| Fact held, not on the default render | grey | The "left out by priority / space" set (Part 5). |
| A "no" (ruled out) | hidden | Decided 2026-07-23; **stands unless reopened.** |
| An approved stretch | not shown | ✅ **DECIDED (owner, session 102): stays off the profile entirely** — "a stretch is a fact about one application, never about you." ADR-0005 kept structural. |
| A proposed, not-yet-approved stretch | not shown | ✅ Same decision — off the profile. |
| A withheld fact (per-market strip, ADR-0007) | not shown | Withholding is per *application*, never touches the profile — arguably invisible here by design. |
| A superseded/corrected value | not shown | The current value shows; the superseded one lives in the fact's detail (origin chain, ADR-0004). |
| Unclassified / `additional` content (ADR-0010) | not shown yet | Will exist; Part 4's ADDITIONAL section is its natural home. |
| Worked-out values (years total, ADR-0008) | shown as fact | Display-only, never editable, regenerates. |
| Muted things ("asked me to stop") | rail list | Not facts; stay in the rail (decided shape). |

**The word for "stretch"** — user-facing only. Recommendation: **do not rename the internal term**
(it is written through ADR-0005/#171 and the codebase); decide the *on-screen* word. Candidates to
bring to the session: *boost* · *angle* · *pitch* · *suggested line* · *proposed line*. Test each
against #169 (plain international English) and the marketing-document philosophy (never moralise —
the word must sound like an offer, not a warning or a confession).

**Deliverable:** the colour law v2 + category table with a decision per row, posted on #176; the
user-facing stretch word decided.

---

## Part 4 — Restructure the groups: CV sections instead of domains ⚠️ audit first

**What the owner wants** — replace the invented domains (DELIVERY / SECTORS / SCALE / TOOLS…) with
**the agreed CV sections**: PROFESSIONAL EXPERIENCE · LANGUAGES · SKILLS · CERTIFICATIONS ·
EDUCATION · ADDITIONAL · (+ any section decided that this list forgot — the audit's first job is
the authoritative list from the Draft schema in `apps/api/src/preview.ts` and the cv-brain rules,
including PROJECTS, decided by ADR-0006). Expectation: PROFESSIONAL EXPERIENCE will "match
perfectly with the data model we designed" (#161's job record: jobs as containers of sentences —
so in the sky, each job could be its own sub-cluster).

**The owner asked for a real audit, and suspects it deserves its own ticket. Agreed — it does.**

**Audit questions (the ticket's body):**

1. The authoritative section list, from the Draft schema + cv-brain + ADR-0006 (PROJECTS) +
   ADR-0010 (`additional`) — not from memory.
2. Mapping: every fact kind the claim graph holds → exactly one section. Where does a grill answer
   with no CV line live (e.g. "ran three projects at once")? SKILLS? Its job's container? The
   mapping must be total or the sky drops facts silently.
3. **The philosophical shift, named honestly:** §8.1 decided "the profile and the CV are different
   objects." Making the profile's structure mirror the CV's sections narrows that distance — is
   that intended? (It has real upside: one structure to learn, and the profile *explains* the CV.
   It has a cost: the profile starts to look like a CV editor, which it is not.)
4. Does #161's job record support job-level sub-clusters (a job = a named cluster of its
   sentences)? What happens to facts not attached to any job?
5. Scale check: PROFESSIONAL EXPERIENCE will dominate (most facts live there). Does one huge
   cluster + five small ones still read, in both views, at 6 facts and at 200? (The mobile
   prototype's scale test, re-run against the new grouping.)

**Deliverable:** a new GitHub ticket (audit + decision), then the restructure designed in its own
session on the audit's answer.

---

## Part 5 — The list view, rebuilt vertically on the CV sections

**What the owner wants** — a vertical list: one block per CV section (per Part 4); inside each
block, **the facts on the CV now, in gold, on top**; under them, in grey, the ones not on the CV
for now — the stretched things (word per Part 3) and the ones **left out by priority** (N
experience facts can't all fit; a top-N is shown by default until tailoring swaps them per offer).

**Decided ground it touches**

- "Nothing empty is ever drawn" (§7 — an empty section is a capacity, and a capacity grades the
  person). An empty EDUCATION block must not render as an empty slot.
- The lead-sentence + chips pattern (mobile Sorted) — does it survive, or does the vertical list
  become rows? Design call for the session.
- The "top-N by priority" story must be honest about *who chose*: the default render's selection is
  the machine's priority call — the detail of a grey fact should say "left out for space, swaps in
  when an offer needs it," which is Part 2's reframe doing its work.

**Depends on Parts 3 and 4** (colours + sections). Cannot be designed before them.

---

## Session plan (the owner's "one part per session", ordered)

Meaning → structure → views → chrome. Each session ends with: decisions posted on #176, the
prototype updated, this plan's section marked done.

| Session | Covers | Why this order |
|---|---|---|
| **R2-a** | Parts 2 + 3 together (they are one decision: what the colours and counts *mean*, incl. the stretch word + category table) | Everything downstream renders these semantics; deciding them first prevents redesigning twice. No build dependency. |
| **R2-b** | Part 4 **audit** → new ticket, decision | Structure next; the audit is reading + mapping work and can start any time, but its *decision* gates R2-c. |
| **R2-c** | Part 5 (list view) + constellation restructure | Pure design once a + b are decided. The big visual session. |
| **R2-d** | Part 1 (rail: Location + eligibility move, Job family) | Independent of colours/structure except the languages question; doing it last means the eligibility/languages surface decision is made with Part 4's sections already fixed. Needs the family-mapping audit answer (small, can be prefetched during R2-b). |

**Hazards register (carry into every session):**

- ✅ ~~ADR-0005 vs stretches-in-the-sky~~ — closed session 102: stretches stay off the profile
  entirely (see "Decisions already taken"). Consequence for Part 5: the grey layer is *held-out
  facts only*; the stretch word (Part 3) is still needed, but for the tailor/proposal surfaces,
  not the profile.
- ⚠️ Languages: one editing surface, chosen deliberately (Parts 1 vs 4).
- ⚠️ "Root CV" vs "current CV" — pin which document gold describes (Part 3).
- ⚠️ §8.1 profile-vs-CV distance (Part 4) — narrow it on purpose or not at all.
- The hidden-"no" decision and the Mei rule are not reopened by anything above; if a session
  drifts into them, stop and say so.
