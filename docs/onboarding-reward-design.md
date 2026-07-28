# First-run onboarding reward design

_Decision-complete design, 2026-07-28. This is the current product account of the journey from the
opening invitation through entry into Tailor. It replaces the earlier chronological decision log._

## Product promise

JobCrush turns what a person already knows and has done into credible job matches, then helps them
tailor a truthful CV for one job.

The first-run journey optimizes for the **least necessary effort before credible value**:

1. credible matches before volume;
2. only questions that materially improve matching or CV accuracy;
3. clear progress and recoverable waits;
4. no invented evidence and no fake certainty.

The primary reward is not a generic CV preview. It is the first set of relevant, scored jobs and the
knowledge of why they fit. The evolving root CV is the immediate feedback that makes the work toward
that reward visible.

## The resolved journey

```text
Invitation
  → optional source assistance
  → import proof, when a CV was provided
  → recover target role and search area
  → place the role in a job family
      → known or clarified family: adaptive discovery
      → unmapped role: save research candidate, offer account, pause
  → confirm the essential family floor has been covered
  → retrieve at least one credible live job
      → none available: broaden search or wait for matches
      → matches available: reveal the match count
  → inline signup
  → highest-ranked job card
  → Tailor
```

This is one common onboarding process. A CV is a shortcut that answers questions; it does not create
a separate flow. LinkedIn can later become another source in the same source-assistance step, but it
does not create a second journey.

## 1. Invitation

Keep the existing centered opening:

- a restrained, static JobCrush wordmark;
- the fixed-width, no-jitter, letter-by-letter **“Answer questions. Collect jobs.”** animation;
- **Ready?** as the transition;
- tap to finish the animation and a reduced-motion fallback.

Remove the old CV footnote. Do not ask a question or create an account on this screen.

The invitation makes a compact promise. It does not explain the whole product or preview job cards
that are not yet credible.

## 2. Optional source assistance

After **Ready?**, ask one calm question: whether an existing CV or LinkedIn profile can help.

- **Yes** progressively reveals source choices.
- **No** exposes **Start questions instead**.
- **CV** is active.
- **LinkedIn** is disabled and labelled **Coming soon** until JobCrush has a permitted,
  member-provided acquisition method. Do not collect a profile URL, request unrelated permissions,
  or imply that a disabled input will be processed.

All choices use the same card geometry and compact icon language. **Start questions instead** is a
quieter fallback, with a muted outlined `Q` tile, so it remains first-class without looking like the
expected choice after **Yes**. Put the temporary-data notice outside the action stack, anchored near
the bottom.

No account is required. Anonymous onboarding data is temporary.

## 3. CV import proves saved effort

Treat explicit statements in a user-provided CV, including defensible semantic equivalents, as
**source-supported facts**. They can receive full first-match credit. This means “supported by
information you provided,” not “independently certified by JobCrush.”

After a useful import, show a compact proof:

- useful facts found;
- questions skipped;
- three or four representative facts labelled **From your CV**;
- any material ambiguity or conflict JobCrush still needs to ask about;
- **Ask me what’s missing** as the continuation.

Do not recreate the old confirmation deck here.

Evidence rules:

- equivalent facts from multiple sources merge and score once;
- a JobCrush inference can choose a follow-up question but cannot score independently;
- conflicts remain local to the disputed field;
- a user correction overrides imported values and cannot be silently overwritten by re-import;
- readable facts survive a partial import, and discovery asks only for missing material information;
- total failure returns to the source step with **Try again** and **Continue with questions**;
- before certified or exportable output, the assembled profile receives an aggregate review and
  material conflicts are resolved individually.

## 4. Recover job-search intent

Before family discovery, establish both:

- **Target role** — what kind of work the person wants next;
- **Search area** — where JobCrush should look.

A past role or home address may suggest an answer but cannot establish future intent. If both are
missing, ask one wide prompt such as:

> What kind of job are you going for, and where?

If a source explicitly establishes one, ask only for the other. Accept free text; do not force a
closed job-title list. Suggestions may expose related roles in the same family, but must be labelled
as the **same kind of job**, not exact title corrections.

The answer should immediately write supported information into the root CV and enable an honest
local-market promise once role and area are known. Never fabricate a live-job count while retrieval
is pending.

## 5. Place the target role without forcing it

Classify the target role against reviewed job-family profiles. Retrieval may nominate candidates,
but nearest-neighbour similarity alone never proves that a role belongs to the closest family.

Use a calibrated three-way outcome:

1. **Auto-place** only at high confidence.
2. **Clarify** plausible ambiguity with a one-tap choice among a small number of families.
3. **Mark unmapped** when support is below threshold.

Related titles can share a family only when they share the same essential requirement floor.
Project Manager, Program Manager, Delivery Manager, and IT Project Manager may share one family;
Product Owner and Product Manager remain neighbouring but separate families.

### Unmapped target role

An unmapped role stays in the common journey but pauses before job reveal:

1. preserve the person’s inputs;
2. retain a privacy-minimized **Family research candidate** even if they do not create an account;
3. screen abuse, non-job intent, duplicates, and already-covered semantic equivalents;
4. offer the normal Google or magic-link account mechanism with:

   > Create an account and we’ll notify you when your first matches are ready.

Do not promise a completion time until operational evidence supports one.

Retain only the original role wording, normalized interpretation, search country or area, screening
rationale, timestamp, and duplicate or abuse indicators for anonymous learning. Exclude CV content,
work history, contact details, and unrelated attributes.

Publish a reusable family only after validation against real postings and held-out evaluation.
Resume signed-up users automatically, but notify them only after at least one credible matching job
exists. If research rejects or cannot validate the family, return the user to the target-role
question with their previous answer preserved and explain that confident matches are not ready.

## 6. Adaptive discovery

For a known family, discovery asks the smallest set of questions needed to cover its ranked
essential floor.

An item is covered by:

- a source-supported fact;
- a user-resolved fact;
- an explicit negative;
- a defensible semantic equivalent.

“No” is a complete answer. Store it as a first-class, non-renderable negative so JobCrush does not
ask again or imply the missing capability on a CV.

Question order:

1. resolve only imported conflicts or ambiguities that affect matching or CV accuracy;
2. ask the highest-ranked unanswered essential family item;
3. ask triggered context only when an answer requires it;
4. leave non-essential or job-specific open points for the relevant job card and Tailor.

Use tappable options when the answer can be enumerated; use free text when it cannot. Each answer
must produce immediate, truthful feedback by writing or updating a root-CV line and its section.
Keep the CV as warm paper and the brightest object in the discovery interface; surrounding chrome
recedes. Do not use fake completion percentages, recurring card drops, or an endless reward meter.

There is no **Show me jobs now** escape that trades a weak reveal for less discovery. The essential
floor must be short and ranked enough to finish without coercion.

## 7. The credible reveal

Discovery can reveal jobs only when all of these are true:

- target role and search area are explicit;
- the role has a known, confirmed family;
- the ranked essential family floor has been covered, including explicit negatives;
- at least one relevant, real posting exists.

Then show:

> **N jobs just matched you.**

and **See them**.

This is the first rare reward. It is a plain statement backed by the current posting pool, not a
locked or blurred teaser.

If no relevant posting exists, do not show a zero-job reveal. Offer two honest paths:

- broaden the search area or adjust the target;
- create an account to be notified when a credible match appears.

Preserve all completed discovery work in either path.

## 8. Late signup

After **See them**, require signup before disclosing job detail. Keep the earned match count visible
through the inline Google or magic-link wall; do not replace it with a blurred card.

Successful authentication opens the highest-ranked real job directly. Signup claims the anonymous
session and its evidence; it must not restart import or discovery.

The unmapped-role and no-vacancy waits use the same account mechanism, with copy adapted to the
specific promise. They are not separate onboarding systems.

## 9. Ranked deck

The first job card establishes value in this order:

1. title, company, location, and match score;
2. expandable **Read job description** using the source advert;
3. compact match summary: requirements covered and a plain-language fit statement;
4. a distinct **Why this match?** review layer;
5. the highest-impact **Important gap**, when present;
6. **Review all open points** for the remaining actionable ledger.

An Important gap is concrete evidence the job appears to require but the person has not supplied.
It does not make the application impossible and does not lock Tailor. The interface must make three
things understandable:

- what evidence is missing;
- applying remains the user’s choice;
- Tailor will strengthen supported evidence but will not invent the missing experience.

Do not mix the full requirement ledger into the card header or hide the source job description
behind JobCrush’s interpretation.

## 10. Entry into Tailor

Swiping right or choosing Tailor opens the selected job with its evidence state intact.

The card’s weak fits and open points become Tailor’s most useful questions. Each answer may turn a
grey open point into supported evidence and update the tailored CV. Keep an always-present exit such
as **I’m done — use this CV** because tailoring has no discovery gate.

Tailor may rephrase, reorder, select, and moderately strengthen presentation where the evidence
supports it. It must not invent a fact, hide an Important gap, or imply that an unmet requirement is
met.

The journey covered by this document ends when the user has entered Tailor for a selected job.

## 11. Waiting, failure, and resumption

Every background operation shows an immediate, honest loop and a specific status such as
**Reading your CV…** or **Looking for matching jobs…**. Never show a fake percentage.

- After 10 seconds, say that processing is taking longer.
- After 60 seconds, allow the user to leave safely and return later while work continues where
  possible.
- A retry never forces a repeated upload or discards completed answers.
- A failure explains the problem and offers both **Try again** and a safe alternative.
- Closing and reopening restores the last durable checkpoint.
- Users can explicitly start over and delete temporary onboarding information.

Ordinary anonymous, unfinished onboarding data expires after seven days. Consenting pilot data may
be retained for up to one year for testing and model improvement; leaving the pilot stops
experimental access but does not itself delete previously collected data. A deletion request
removes identifiable data.

## 12. Pilot release gates

The first release is an invitation-only pilot. Pilot users knowingly test unfinished behavior and
can report problems easily. Inspection of their CVs, answers, matches, and generated CVs requires
clear consent.

Hard pre-pilot gates:

- privacy and retention behavior match the promises above;
- every checkpoint resumes without lost work;
- waits and failures are truthful and recoverable;
- source provenance and explicit negatives survive the full journey;
- generated CVs contain no unsupported factual substance.

Measured pilot gates:

| Outcome | Gate |
|---|---|
| First-job relevance | Inspect the first 3 journeys; then at least 80% of 10 additional testers judge the first reveal genuinely relevant. |
| Family auto-placement | At least 95% correct on comparable examples; otherwise clarify or mark unmapped. |
| Novelty detection | Catch at least 90% of genuinely unfamiliar roles with no more than 5% familiar roles falsely marked unfamiliar. |
| Necessary questions | Zero exact repeats; at least 90% gather new, materially necessary information. |
| Source-assisted effort | A useful CV import reduces necessary questions by at least 30% versus starting from scratch. |
| Time to value | At least 80% of 10 additional testers reach a first relevant reveal within 5 minutes of active interaction, excluding background wait. |
| Important-gap comprehension | At least 90% understand the missing evidence, their agency to apply, and Tailor’s no-invention boundary. |

Manually review every generated CV against its supporting evidence for the first three or four pilot
users. Investigate any absurd or misleading match immediately.

Formal keyboard-only, screen-reader, and reduced-motion validation beyond the invitation animation
is deferred from this pilot milestone. Do not deliberately break ordinary browser or assistive
behavior, but those formal gates belong to a later accessibility effort.

## 13. State and implementation handoff

The specification should model durable checkpoints rather than screens:

```text
invited
source_selected
source_processed
intent_known
family_confirmed | family_unmapped
essential_floor_covered
credible_matches_found | no_matches
reward_revealed
account_claimed
job_opened
tailor_entered
```

For each transition, the implementation spec must define:

- required evidence and server-side gate;
- durable data written;
- pending, success, partial-failure, total-failure, retry, and resume behavior;
- analytics needed for the pilot gates;
- exact user-facing promise and retention consequence.

The family-floor contract must provide, in ranked order, each item’s importance band, fast question,
answer options, destination CV section, and whether a negative is fatal or acceptable. The job card
contract must preserve source-advert access, coverage, Important gaps, and the complete open-point
ledger.

## Out of scope

- implementing this design;
- enabling LinkedIn acquisition before a permitted source exists;
- defining the E5 clustering model or producing the family catalogue;
- building the family-research operations console;
- post-Tailor application submission;
- formal accessibility certification for the pilot.

Those are implementation or later-milestone concerns. This document supplies the coherent product
decisions they must follow.
