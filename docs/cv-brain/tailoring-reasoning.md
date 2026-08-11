# CV tailoring — reasoning framework

> **Provenance.** Copied from the JobCrush repo's `CLAUDE.md` (§2 Target Roles, §3 Content
> Classification, §7 Decision Rules, §8 Gap Handling) on **2026-07-18**, the day the CV brain
> was forked (see `README.md`). This is the durable reasoning the tailoring pipeline rests on —
> the *why* behind the schema, the miner prompt, and the tailor prompt. JobCrush-internal plumbing
> (file conventions, agent/command wiring) was intentionally left out; only the transferable
> reasoning is here. From here on this file evolves with **the product**, independently of JobCrush.

## 1. What tailoring produces

Every tailoring run produces two things that must never be mixed without labelling:

1. A tailored CV draft — the best honest positioning of the candidate for one role.
2. A verification record — every claim not directly supported by the source CV, surfaced for the
   candidate to confirm before the CV reaches an employer.

Never present proposed content as unquestionably true. Anti-fabrication governs what reaches
**employers**, not what the candidate may see on their own screen (a watermarked, non-exportable
preview of unconfirmed content is fine; a submitted CV of unconfirmed content is not).

## 2. Target roles (the role taxonomy the tailor reasons over)

**Core:** IT Project Manager, Project Manager, IT Product Owner, Product Owner, IT Product Manager,
Product Manager.

**Adjacent:** Program Manager, Delivery Manager, Scrum Master, Technical Project Manager, Digital
Project Manager, Digital Product Manager, Technical Product Owner, Technical Product Manager.

When the posting's title is hybrid, note the blend rather than forcing one label.

_(This taxonomy is the initial coverage. A multi-tenant product will extend it as users bring roles
outside PM/PO/PdM; the classification and decision machinery below is role-agnostic and carries over.)_

## 3. Content classification (the 5 levels)

Classify every piece of CV content consistently across the evidence map, the draft, and the audit.

| Class | Definition |
|---|---|
| `Verified` | Directly supported by the source CV or a grounding file. No review needed. |
| `Derived` | Stronger phrasing, reordered bullets, or synthesis not materially beyond the source. No review needed; note it. |
| `Partially Supported` | Adjacent or indirectly evidenced — a related skill, a similar tool, a comparable scope. Must appear in the verification record. |
| `Unsupported but Plausible` | Not in the source, but a reasonable addition given the candidate's trajectory and the role. Must appear in the verification record with risk level and recommended action. |
| `Unsupported` | No evidence and not safe to assume. Do not include in the draft. Flag as a gap. |

The boundary that matters most: **asserting is not evidencing.** A fluffy self-description the CV
merely states ("experienced in stakeholder management", with no supporting role or outcome) is
`Partially Supported`, never `Verified`.

## 4. Decision rules (which role language the CV adopts)

> **This is a discriminator, not a family floor** — _clarified 2026-07-23, after it was read as one
> and a design was built on top of that reading
> ([#6](https://github.com/adrien-mounier/jobcrush-app/issues/6))._
>
> The signals below decide **which role's language** the CV adopts. They are the words that
> *separate* PM from PO from PdM. A **family floor** is the opposite material: what *every* job in a
> family expects — largely the shared baseline this section deliberately throws away. **Budget is
> dropped here precisely because every PM ad asks for it, and that is exactly why a PM CV cannot be
> missing it.**
>
> So do not read the clusters below as a checklist of what a CV must cover. A discriminator is a tally
> you compare; a floor is a checklist you tick off. The floor is **E5's offline family research and
> does not exist yet**; the shape it has to take is written down in
> `docs/onboarding-reward-design.md` §6.2.

Signals are additive. Tally per cluster; the dominant cluster sets the CV's language. Note secondary
clusters.

**Shared baseline (ignore — too generic to discriminate):** budget, user stories as a format,
stakeholder management, requirements gathering, agile familiarity.

**Project Manager:** delivery accountability, RAID log, milestone/schedule planning, WBS, steering
committee, change control, resource/capacity planning, programme governance, budget governance
(spend, not P&L).

**Product Owner:** sprint ceremonies, backlog ownership, acceptance criteria, definition of done,
velocity tracking, squad collaboration.

**Product Manager:** roadmap ownership, discovery/user research, KPIs/OKRs, P&L ownership,
go-to-market, product lifecycle, competitive analysis.

**Technical framing (add on top of any of the above):** architecture decisions, build-vs-buy,
engineering collaboration at design level.

When two clusters score similarly, name both and lean to the stronger. If genuinely ambiguous, use
closest-fit and note the alternative.

## 5. Gap handling

`Unsupported`: exclude from the draft; record as a gap; generate a candidate follow-up question. If
confirmed, reclassify as `Verified`, persist to the grounding source, and list under "confirmed
additions". If unconfirmed, note the gap and prepare an interview-answer strategy.

`Unsupported but Plausible`: include only if it materially improves fit and can be defended at
interview. Always surface it in the verification record. Default for High-risk items: ask the user.

## 6. The conservation principle (product-specific, added at the fork)

The tailor may rephrase, reorder, merge, and select for the posting. It may **not** silently delete a
class of facts the source CV had — certifications, languages, or the density of the current role.
"Tailor by emphasis, not amputation." Skills are the one deliberate exception: they are *curated* to a
focused 8-12, not exhaustively conserved. This principle is enforced mechanically by the conservation
lint in `apps/api/src/preview.ts` (`conservationIssues`) and is the direct lesson of the JC-2 rating
failure that prompted this fork.

## 7. Reading a dated block (#161, added at the durable-record build)

Before #161, a dated entry (a job, a school, a client engagement) was read as four loose strings and
discarded after one use. The durable job record decomposes each dated block into five independent
machine decisions — employer, title, start, end, kind — and two reading rules from that ticket belong
here because they are CV-reading judgement, not storage plumbing:

- **Precision is never invented.** "2021 – 2023" is read at year precision; a month is only recorded
  when the CV states one ("Jan 2019 – Mar 2022" is month precision). The record must print no more
  than it knows — the same conservatism `cv-authoring-rules.md` asks of writing applies to reading.
- **A client line nested under an employer is never a job.** `ASSYTEM (client) - 02/2021 - 05/2021`
  sitting inside a consulting role is a name plus a date range, byte-for-byte the shape of an
  employment block — but it is read as `kind: client`, never `kind: job`, so it can never fabricate a
  second employer the candidate never worked for (ADR-0009). The miner is told to look for the parent
  employer around an ambiguous name+date block before deciding.

The full mining contract lives in `apps/api/prompts/job-block-miner.md` and
`packages/contracts/src/jobBlock.ts`; this section records only the reading judgement behind it, per
the repo rule that a change to the reading rules is recorded here, not left implicit in the prompt.
