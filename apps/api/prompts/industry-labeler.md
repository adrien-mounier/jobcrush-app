<!--
#281 (spec #279, ADR-0014 decision 2 as amended) — places ONE dated job into one or two industries
from the CLOSED published list (#280). Read the spec before changing a word here: the whole point of
a closed vocabulary is that a job's label and an advert's requirement come from the SAME list, so
"the nearest industry" is not a kindness, it is the bug.

NOBODY IS ASKED. There is no clarification outcome and no panel behind it: a person cannot be
expected to know whether her employer meets our definition of an industry, so a job we cannot place
is honestly unplaced and recorded as vocabulary-growth feed. Correction is the only lever.

TWO industries is the ordinary plural case, not an edge case — the employer's own industry, and the
industry the work was served into. The line is held HERE, in the instruction, not by a cap in the
contract: a labeler that starts naming three is a signal our industries are drawn too narrow, and
that has to stay visible rather than be clamped away.

The employer WEB LOOKUP is the next ticket (#282). Today's evidence is the employer name, the job
title, and the person's own CV lines for that job — the lines are what make an unfamiliar employer
placeable at all.

The model chooses ids and a confidence level only. Versions and schemaVersion are OURS to fill in
(industryLabeler.ts assembles the contract answer) — a model must never invent a version number a
person's numbers are pinned to.
-->
You place one job into the industry its employer was in.

An **industry** is what kind of BUSINESS the employer was — what they sold and to whom. It is not
the kind of work the person did, not their seniority, and not their job title. The same work
(managing projects, writing software, keeping books) is done inside a bank, a hospital and a
shipping line, and those are three different industries.

The list below is closed and complete. There is no other industry. If the employer's business is
not one on this list, say so; do NOT reach for the nearest one.

## The published industries

{{INDUSTRIES}}

## The job to place

Employer: {{EMPLOYER}}
Job title: {{TITLE}}

What this person wrote about this job on their CV:
{{LINES}}

## How to decide

Work through this in order. Do not skip to an answer.

**Step 1 — say what this employer SELLS, and to whom.** Use the employer's name if you recognise
the business, and use the person's own lines whichever way they point. The lines are often the
strongest evidence you have: "reconciled trade settlements" places an employer you have never heard
of in banking; "picked and packed customer orders" places one in retail. A job title that names the
work ("analyst", "engineer") tells you nothing about the business on its own.

**Step 2 — find the industry whose scope claims that business.** The scope sentence decides it, and
its second half is as binding as its first: an entry that says where its edge is has already told
you what belongs to its neighbour. A health insurer is insurance, not healthcare. A company selling
learning software to schools is software, not education. Making medicines is healthcare, not
chemicals.

**Step 3 — ask whether the work was SERVED INTO a different industry.** This is the plural case, and
it is ordinary:

- A consultancy, an IT services firm or a staffing agency is its OWN industry, and the industry its
  people were sent into is a SECOND, equally true fact about the same job. Someone at a consultancy
  who spent years on bank programmes is honestly both consulting and banking.
- Name the second industry only when the person's own lines show the work was **substantially and
  repeatedly** done for that industry — a standing part of the job, not one client mentioned once.
  One named client in one line is not a second industry.
- A person employed directly by a bank is banking, once. There is no second industry to find when
  the employer and the served business are the same.

**Never more than two.** If three seem to fit, go back to step 1: you are almost certainly counting
clients rather than industries.

**Step 4 — answer.**

- **one industry fits → confirmed**, naming it.
- **an employer industry and a genuinely served industry → confirmed, naming BOTH.** The person's
  years count in full toward each; nothing is split.
- **none fits → unmapped.** This is a correct, useful, expected answer — say it plainly rather than
  reaching for the closest entry. It is for an employer whose business is genuinely something else
  than every industry listed, and for a job where nothing — not the employer, not the title, not a
  single line — says what the business was. It is NOT for an employer you merely could not verify:
  if the lines place the business, place it.

Never invent an industry id. Never output an id that is not on the list above.

**Step 5 — say how sure you are.** One word, on the placement as a whole:

- **certain** — you know what this employer is, or the lines say it plainly.
- **likely** — the ordinary reading puts it here, but the evidence leaves room for another.
- **possible** — you are placing it on the balance of what the lines suggest, and you can see how
  the business could be something else.

Confidence is about the LABEL, not about the person. It never shrinks anyone's experience — it only
decides how loudly we lean on the label. So do not hedge to be safe: an honest "certain" is what
lets a real match be shown as one, and an honest "possible" is what stops a shaky one being trusted.

## Output

One JSON object, nothing else — no prose, no code fence. Write the `why` FIRST, and make it earn the
answer: name what the employer sells, and the scope words that claim it. If no scope on the list
claims it, the answer you are writing is unmapped.

Placed:
{"why":"<what this employer sells, and the scope words that claim it>","outcome":"confirmed","industryIds":["<id from the list>","<a second id, ONLY if the work was substantially served into it>"],"confidence":"certain|likely|possible"}

Unmapped:
{"why":"<what this employer sells, and why no listed scope claims it>","outcome":"unmapped"}
