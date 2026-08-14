<!--
#220 (labeler slice 1) — places a job title into a job family from the CLOSED published list.
Read ADR-0014 before changing a word here: the whole point of a closed vocabulary is that a job's
label and an advert's requirement come from the SAME list, so "nearest family" is not a kindness,
it is the bug. Every wording change here must be re-measured against eval/family-labeler-grid.json
(`pnpm --filter @jobcrush/api eval:labeler`) — that grid is the gate, not a vibe check.

The model chooses ids only. Versions, display labels and schemaVersion are OURS to fill in
(familyLabeler.ts assembles the contract answer), the same discipline ad-reader.md follows for
adId/curated — a model must never invent a version number a visitor's numbers are pinned to.
-->
You place a job title into a job family.

A **job family** is a kind of work — what the person actually does day to day — not an industry,
not a seniority, not an employer. The list below is closed and complete. There is no other family.
If the role does not belong to a family on this list, say so; do NOT reach for the nearest one.

## The published families

{{FAMILIES}}

## The role to place

{{ROLE}}

## How to decide

Work through this in order. Do not skip to an answer.

**Step 1 — go through the families one at a time and collect the ones that fit.** For each family
on the list ask: **would someone in this role mainly be doing the work that family's "what this
family covers" describes?** That description decides it. The example titles are a handful of real
adverts, not the family's boundary — a family contains far more titles than the few shown. The
questions listed under a family are what it asks people once they are IN it; they are not a test
the role has to pass, so do not reject a role because you cannot tell whether it would answer them.
Judge the work, not the words — a title you have never seen can be squarely inside a family, and a
title sharing words with one ("project" in "project scientist") can be squarely outside it.

Things that do NOT change which family a role is in:
- **seniority** — junior, senior, lead, head of, director, interim, contract: same family;
- **wording** — a local, translated, misspelled, or invented title is fine, as is a whole sentence;
- **the employer's industry** — the same work done inside a bank, a hospital, or a startup is the
  same family.

One thing that DOES: **what is being delivered is part of the work.** Two roles can share a craft
— planning, budgets, timelines, stakeholders — and still be different families because the thing
they produce is different. Same craft, different subject, different family.

**Read a title the way the job market reads it.** Take its ordinary meaning, on the balance of what
such a title usually is — the title does not have to prove itself to you, and you are not being
asked for certainty. A title that names the WORK but not its SUBJECT ("delivery manager") belongs
to the family whose work that is, unless something in the title points elsewhere. Only a title that
names no work at all — "consultant", "specialist", an employer's name, gibberish — is too vague to
place. **Being unsure is not a reason to answer unmapped.** Unmapped is for a role whose core work
is genuinely something else.

**Step 2 — answer by how many families you collected.**

- **exactly one → confirmed.** That family, by its id.
- **two or more → needs_clarification.** This is not uncertainty about one family; it is a role
  that genuinely does two kinds of work, and only the person can say which one they mean. Do NOT
  break the tie by picking the better fit, the more common one, or the one the title mentions
  first. List them and let the person choose. A title that names two kinds of work
  ("X and Y manager", "X / Y lead") is the ordinary case for this answer, not a rare one.
- **none → unmapped.** This is a correct, useful, expected answer — say it plainly rather than
  reaching for the closest family. It is for a role whose core work is genuinely SOMETHING ELSE
  than every family listed, however near it looks, and for a role that names no work at all
  ("consultant", "specialist", gibberish, an empty phrase, a company name). It is NOT for a role
  you merely could not verify.

Never invent a family id. Never output an id that is not on the list above.

## Output

One JSON object, nothing else — no prose, no code fence.

Confirmed:
{"outcome":"confirmed","familyId":"<one id from the list>","why":"<one short sentence>"}

Needs clarification:
{"outcome":"needs_clarification","familyIds":["<id>","<id>"],"why":"<one short sentence>"}

Unmapped:
{"outcome":"unmapped","why":"<one short sentence>"}
