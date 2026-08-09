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
   `apps/web/prototypes/` — round-2 work continues in `profile-desktop.prototype.html` (created
   R2-c; the round-1 `profile-desktop-options.prototype.html` is the frozen shape-A record).
   **Screenshot prototypes (Playwright) before showing them.**
3. When a part closes: post the decisions on **#176** · update this doc (mark the ledger row
   `done`, fold decisions into the part's section, prune resolved hazards) · session-log entry ·
   commit and push when green.

### Status ledger

| Session | Parts | Status |
|---|---|---|
| R2-a | 2 + 3 — colour/count semantics, category table, stretch word | **done — 2026-08-09** |
| R2-b | 4 — CV-section regroup audit → its own ticket | **done — 2026-08-09 (#178)** |
| R2-c | 5 — list view + constellation restructure | **done — 2026-08-09** |
| R2-d | 1 — rail: Location + eligibility, Job Family | **open — next** |

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
- **Job family data: does it exist?** ✅ **Prefetched during R2-b:** a family → sibling-titles
  mapping exists today only as a **hardcoded one-family stub** (`KIN_TITLES` in
  `apps/api/src/discovery.ts`: IT project manager → programme manager, delivery manager, project
  lead, …). Real data for the rail needs its own small backend ticket — write it in R2-d.
  (Concept elsewhere in the model: posting family fit — E5/#86; family floor — CONTEXT.md; family
  authority in retrieval — #101. The cv-brain role taxonomy remains a candidate source.)
- What is the family section *for*, product-wise? Display only ("your search covers these"), or a
  control ("also search these")? The answer changes the design entirely. **Owner to decide in the
  session.**

**Deliverable:** rail design in the round-2 prototype; a backend ticket if the family mapping
doesn't exist.

---

## Part 2 — Kill the "waiting for a job that asks" framing? ✅ DECIDED (R2-a, 2026-08-09)

**Decisions (owner, session R2-a):**

- The owner's objection was to the **sentence, not the split** — the two piles stay visible; the
  queue story ("waiting for a job that asks") dies everywhere.
- The second hero line **survives, reframed about the CV**. Final copy:
  > **24** things you've told me
  > **18** make your CV right now — your strongest selection. The rest are kept for when a job
  > needs them.
- Copy never names a colour ("the greys" rejected — colour-blind bridge + machinery through the
  back door); "the rest" carries it. Grey-fact detail caption: *"Kept for when a job needs it."*
- Prototype copy updated (`profile-desktop-options.prototype.html`: hero, detail captions, legend
  "kept for later", dnotes).

---

## Part 3 — What the constellation's colours mean ✅ DECIDED (R2-a, 2026-08-09)

**Colour law v2 (owner, session R2-a), one sentence:** **gold = on the root CV's default render ·
grey = held on the profile, not on that render · anything per-application never draws.** Gold
describes the **root CV**, never the latest tailored one — applying to a job never recolours the
profile (same reasoning that kept stretches off it).

**Category table — every row decided by the law, no special cases:**

| Category | Verdict | Why |
|---|---|---|
| Fact on the root CV's default render | **gold** | The law. |
| Fact held, not on the render | **grey** | The law; caption per Part 2. |
| A "no" (ruled out) | **hidden** | 2026-07-23 decision, not reopened. |
| Approved / proposed stretch | **off the profile** | Closed, session 102 (ADR-0005 structural). |
| Withheld fact (per-market strip, ADR-0007) | **not shown as withheld** | Withholding is per-application; the fact still draws gold/grey by the law. Accepted edge: a stripped fact (e.g. DOB in a market that strips it) shows gold on the profile yet won't print in applications — the withholding pass explains itself per-application. |
| Superseded / corrected value | **not drawn** | Current value draws; old value lives in the fact's detail (origin chain, ADR-0004). |
| Unclassified `additional` (ADR-0010) | **no special rule** | Prints on the root render by default → gold; left off → grey. Falls out of the law. |
| Worked-out values (ADR-0008) | **draw by the law, never editable** | Display-only stands. |
| Muted things | **rail list, not dots** | Not facts; decided shape stands. |

**The user-facing word for a stretch is "boost"** (owner, R2-a). Internal term unchanged
(*stretch* through ADR-0005/#171 and code). Appears only on **tailor/proposal surfaces** — never
the profile. Chosen over *angle/pitch* (idioms, fail #169) and *suggested/proposed line*
(flavourless, doesn't distinguish from ordinary rewrites); "boost" is plain international English
and pure offer — no moralising. The defensibility story is the proposal card's **content**, not
the label's caveat.

---

## Part 4 — Restructure the groups: CV sections instead of domains ✅ DECIDED (R2-b, 2026-08-09)

**Audit + decision record: [#178](https://github.com/adrien-mounier/jobcrush-app/issues/178)** —
the normative home for the five audit answers. The short version:

- **Headline finding:** the invented domains (DELIVERY / SECTORS / SCALE / TOOLS…) were prototype
  demo fiction — the shipped profile route already groups by the root-CV sections server-side
  (`kindTag()` → `SECTIONS`). Part 4 is a **ratification + gap-fix, not a migration**.
- **No authoritative section list existed** — the tailored Draft, the root-CV renderer, and the
  cv-brain rules disagree three ways (languages placement, certifications placement, stale
  "Personal Projects"). #178 records the disagreement so the cv-brain gets reconciled, not
  rediscovered.

**Decisions (owner, R2-b):**

1. **Ratified — CV sections are the profile's structure:** PROFESSIONAL EXPERIENCE · PROJECTS ·
   SKILLS · CERTIFICATIONS · EDUCATION · LANGUAGES · ADDITIONAL (Projects + Additional
   decided-not-built, ADR-0006/0010). The §8.1 distance is **stated, not structural**: the profile
   shows the greys, shows origins, and is **never an editor** — R2-c must keep that visible.
2. **Orphan (no-job) facts get an "About you" group, first in the list** — the one stated
   exception to the section list. The "Professional Summary" heading dies on the profile.
3. **Languages: the profile LANGUAGES section is the single editing door** (#120 mechanism
   unchanged); the Part 1 rail shows a read-only summary that links there.

**Carried into R2-c:** job sub-clusters are supported (every experience claim carries its job;
#161 makes it durable) but the profile payload doesn't pass job attribution through yet — small
contract addition. The scale test must re-run with a **lopsided** distribution (one huge
experience cluster + five small ones), at 6 facts and at 200 — the flat 24-fact demo data hid this.

---

## Part 5 — The list view, rebuilt vertically on the CV sections ✅ DECIDED (R2-c, 2026-08-09)

**Decisions (owner, session R2-c)** — prototype evidence:
`apps/web/prototypes/profile-desktop.prototype.html` (round-2 file, shape A only; the round-1
options file stays untouched as the shape-A decision record). Style + scale switchers built in;
screenshots in `screenshots/r2c-*.png`.

- **Style B — hybrid — is the list.** Sentence facts (About you, experience, projects, education)
  are full rows; word facts (skills, certifications, languages, additional) are chips. A (all
  rows) spends a line per word; C (the shipped lead-sentence + chips, applied naively) squashes
  sentences into truncated chips and erases the jobs — judged on screenshots, not asserted. A and
  C stay switchable in the prototype as the comparison record.
- **Gold-top/grey-under applies per job, not per section** — pulling gold bullets out of their
  jobs to the top of the section would undo the job sub-clusters #178 carried in. Each job block
  reads: on the CV now, then kept.
- **The constellation groups by section with space by size** (angular slices weighted by count);
  jobs are sub-constellations with employer labels (labels drop above 40 facts, return on hover).
  The dark ring centre at 200 facts is accepted as night-sky atmosphere.
- **The lopsided scale test passed** (#178's order): at 6 facts only three sections exist and
  nothing empty is drawn — §7 proven visibly; at 200 (one huge experience cluster) the list stays
  navigable because job headers anchor the scroll.
- Grey experience detail caption: *"Left out for space — it swaps in when a job needs it."* —
  Part 2's reframe stating **who chose**. Other greys keep *"Kept for when a job needs it."*

**Build notes carried out of the session:** the profile payload must pass job attribution through
(small contract addition, #178 Q4) · the rail in the round-2 prototype is the round-1 placeholder
(detail · searching · stopped list) — its real design is Part 1, session R2-d · impeccable
dark-glow exception registered file-scoped for the round-2 prototype (owner-confirmed
constellation language).

---

## Session plan (the owner's "one part per session", ordered)

Meaning → structure → views → chrome. Each session ends with: decisions posted on #176, the
prototype updated, this plan's section marked done.

| Session | Covers | Why this order |
|---|---|---|
| **R2-a** | Parts 2 + 3 together (they are one decision: what the colours and counts *mean*, incl. the stretch word + category table) | Everything downstream renders these semantics; deciding them first prevents redesigning twice. No build dependency. |
| **R2-b** | Part 4 **audit** → new ticket, decision | Structure next; the audit is reading + mapping work and can start any time, but its *decision* gates R2-c. |
| **R2-c** | Part 5 (list view) + constellation restructure | Pure design once a + b are decided. The big visual session. |
| **R2-d** | Part 1 (rail: Location + eligibility move, Job family) | Independent of colours/structure except the languages question; doing it last means the eligibility/languages surface decision is made with Part 4's sections already fixed. Family-mapping answer prefetched in R2-b (one-family stub only — backend ticket to write in R2-d); the languages surface decision also closed in R2-b (profile section edits). |

**Hazards register (carry into every session):**

- ✅ ~~ADR-0005 vs stretches-in-the-sky~~ — closed session 102: stretches stay off the profile
  entirely (see "Decisions already taken"). Consequence for Part 5: the grey layer is *held-out
  facts only*; the stretch word (Part 3) is still needed, but for the tailor/proposal surfaces,
  not the profile.
- ✅ ~~Languages: one editing surface~~ — closed R2-b: the profile LANGUAGES section is the single
  editing door; the rail summary is read-only and links there.
- ✅ ~~"Root CV" vs "current CV"~~ — closed R2-a: gold describes the **root CV**; applying never
  recolours the profile.
- ✅ ~~§8.1 profile-vs-CV distance~~ — closed R2-b: narrowed on purpose (ratified); the remaining
  distance is stated, not structural — greys, origins, never an editor.
- The hidden-"no" decision and the Mei rule are not reopened by anything above; if a session
  drifts into them, stop and say so.
