<!--
#303 (spec #301, #294 clause 4) — the FIRST half of reading an advert somebody pasted.

A job the app fetched arrives already split into title / company / location by the provider's own
feed; the reader (ad-reader.md) is handed those three and reads the requirements out of the body.
A pasted advert arrives as one block of text with nothing split out, so this prompt does the split
the provider would have done — and nothing else. It never reads requirements, never classifies a
family or an industry, and never scores anything: that is ad-reader.md's job, unchanged, running
immediately after this one on the posting this answer builds.

Kept deliberately small for that reason. Widening it would fork the reading of an advert into two
prompts that each know a little about requirements, and the fetched and pasted paths would drift.

The one extra field is the closing date (#294 clause 4): an employer-stated "applications close on
…" is the ONLY genuine liveness signal a pasted advert can ever carry — nobody can re-fetch it to
check — and it is free in text this call already reads. It lands in the posting's existing
provider-stated-expiry field and must never be invented.
-->
Below is the text of a job advert, exactly as somebody copied it from wherever they found it. It may
carry page furniture: navigation, cookie banners, "apply now" buttons, related jobs, recruiter
boilerplate. Ignore all of it.

Answer with ONE JSON object and nothing else — no preamble, no code fence, no explanation:

```
{
  "title": "the job title, as the advert words it",
  "company": "the employer's name",
  "location": "where the job is, as the advert words it",
  "closingDate": "YYYY-MM-DD, or null"
}
```

Rules:

- **Copy, do not compose.** Use the advert's own wording for the title and the location. Do not
  tidy a title into a standard one, do not expand an abbreviation, do not translate.
- **The company is the employer, not the recruiter.** When an agency advertises on behalf of a
  client it does not name, answer `"Company not named"` — never the agency's name, which would put
  the wrong employer on the card and in the application email.
- **Location.** Use the most specific place the advert states (city, or city and country). If it
  says the role is remote, say so in the advert's own words ("Remote", "Remote — Australia"). If
  the advert states no location at all, answer `"Location not stated"`.
- **Title.** If the advert states no job title at all, answer `"Title not stated"`. Do not infer one
  from the duties.
- **closingDate is the date the EMPLOYER said applications close** — "applications close 15 October",
  "closing date: 2026-10-15", "apply by 15/10/2026". Convert it to `YYYY-MM-DD`.
  - A date with no year means the next occurrence of that date from today, {{TODAY}}.
  - A start date, an interview date, a posting date, or "we review applications on a rolling basis"
    is **not** a closing date. Answer `null`.
  - If there is no stated closing date, answer `null`. Never estimate one: this date is shown to the
    person as a fact the employer stated, and a guess would read as one.
- Every one of the four keys must be present. Three are non-empty strings; `closingDate` is a string
  or `null`.

The advert:

{{ADVERT}}
