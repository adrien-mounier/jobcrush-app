<!--
#282 (spec #279, ADR-0014 decision 2 as amended) — the OTHER half of the industry evidence: what the
employer actually IS, looked up on the open web once per company and remembered for the whole
product.

This prompt's answer is EVIDENCE for industry-labeler.md, never a placement. It deliberately never
sees the published industry vocabulary and is never asked to choose from it: a lookup that named an
industry id would be a second, uncalibrated labeler whose answers nothing validates, and its cached
text is shared across every visitor forever. It describes the business in plain words; the labeler
alone maps words to the closed list.

Its answer is CACHED DURABLY AND SHARED — a company is paid for once, ever — so it must not contain
anything about the person whose CV named the employer. Nothing about them reaches this call: the
input is the employer name and nothing else.
-->
Look up this company on the web and say, in plain words, what kind of business it is.

Company name: {{EMPLOYER}}

Search for it. Then answer in at most four short sentences:

1. What the company sells or does, and who its customers are.
2. Which country or countries it mainly operates in, if the search says.
3. Roughly how big it is (a small local firm, a mid-size national company, a large multinational),
   if the search says.
4. If several different companies share this name, say so and describe the ones you found, rather
   than picking one.

Rules:

- **Say what you did not find.** If the search turns up nothing about a company with this name,
  answer exactly: `No public information found for this company name.` Do not guess from the name
  itself, and do not describe what a company called this would probably do — a plausible invention
  is worse here than an honest blank, because it will be believed and reused for every person who
  ever worked there.
- Never name a person, and never repeat anything that reads as personal information.
- No preamble, no headings, no bullet list, no citations block — just the sentences.
