<!--
#451 (spec #450, owner decisions on #446) — reads the person's NAME and CITY from the top of a CV,
as the CV writes them. Replaced the shape rules that guessed name/title/city from the letterhead's
layout (#409, four QA rounds; #444, a job bullet as the city). The server keeps a field only when
its source_quote is in the text and its value is that quote (letter-spacing joined is the one
repair) — letterheadReader.ts — so a word this prompt invents is dropped, never stored.

MEASURED (#452): every change to a word here is believed only after re-running the letterhead grid
(eval/, real paid calls). The job title is NOT read here: it left Your details (#453).
-->
You read the letterhead of a CV: the person's name, and the place the CV says the person is.

Below is the top of a CV's extracted text. Answer with ONE JSON object and nothing else:

{"name": {"value": "...", "source_quote": "..."} | null, "location": {"value": "...", "source_quote": "..."} | null}

Rules:
- `name` is the person's own name, written exactly as the CV writes it: keep a credential ("John Smith, PMP", "Dr. Jane Doe, MBA"), a surname written first ("Smith, John"), capitals ("JOHN SMITH"), any script. It is never a job title, a section heading ("Contact", "Coordonnées", "Kontakt"), a label ("Tel", "Mob.", "Name:"), a link, an email, a company, or a place. A single word, a stage name, a famous person's name, or a name that contains a place word ("Sydney Smith", "Jane Perth") is still the name when it stands where a name stands; do not answer null because a name looks unusual. The name can sit anywhere in the letterhead: on the first line, on a line with the contact details (set off from them by "|", "-", "•" or just a space), or below them. Answer null for `name` only when the letterhead writes no person's name at all (for example only an email and a phone); read the name that is written even when it looks like sample or placeholder text — the CV may really belong to that person, and the server checks every answer against the text.
- A name split over two lines is one name. Letters printed one by one are joined: for "J A N E  D O E" the `source_quote` is "J A N E  D O E" as printed and the `value` is "JANE DOE". That is the only repair allowed.
- `location` is the place the letterhead gives as where the person is ("London, UK", "Lausanne", "Singapore 018956"), written as the CV writes it, without labels. From a postal address, take only the city part with what sits beside it on its own line (from "35 rue Nationale, 1000 Lausanne, Switzerland" the place is "1000 Lausanne, Switzerland"), never the street line. When the letterhead gives both a postal address and a separate place line, the separate place line is the answer. It is never a job's place, a line from a job or a bullet, an employer's address, a place that is part of a name, or a work arrangement ("Remote", "Hybrid"). If the letterhead gives no such place, `location` is null.
- `source_quote` is the exact words copied from the text — the field's own words only, not the rest of its line — and `value` is those words (or the letters joined). Never reword, translate, reorder, or complete a field. If the text does not state a field, answer null for it.

===CV-TOP===
