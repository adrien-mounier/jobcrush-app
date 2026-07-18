# Research Notes — ATS Resume Parsing Pitfalls (2026)

**Date compiled:** 2026-07-10
**Purpose:** Ground the ATS-compliance rules referenced in `rules/cv-authoring.md` and the DOCX/PDF
builders (`_docx_build/build_pdf.mjs`).
**Source method:** NotebookLM "CV Best Practices Research" notebook — 10 web sources (fast research
mode) plus this project's existing `it-pm-cv-best-practices.md` and `rules/cv-authoring.md` as seed
context.
**Caveat:** Research outputs inform framing and formatting rules only. They are not a source of facts
about the candidate. Inline `[N]` markers are the notebook's citation numbers into its own source set,
not resolvable outside that notebook.

---

In 2026, over 97% of Fortune 500 companies and a growing number of mid-sized firms use Applicant
Tracking Systems (ATS) to filter candidates [1, 2]. The primary hurdle for any applicant is the
**parser**, a software layer that strips formatting to extract raw text into a structured candidate
database [3, 4]. If a resume fails this structural extraction — regardless of the candidate's
qualifications — it often results in a blank or scrambled profile that is automatically filtered out
before a recruiter ever sees it [3, 5, 6].

## Summary of Top ATS Parsing Pitfalls

- **Two-Column Layouts** — the most frequent cause of critical failure [7, 8]. Parsers read
  left-to-right across the entire page, interleaving sidebar text with main body text, producing a
  nonsensical mix of job titles and unrelated skills [9, 10].
- **Tables and Text Boxes** — many "modern" templates use tables for alignment, but parsers often
  strip table structures entirely, leaving a sequence of disconnected cell contents that separate dates
  from job titles [11, 12].
- **Header and Footer Regions** — most ATS engines treat these as "page furniture" and ignore them
  entirely [13, 14]. Placing contact information here can result in a candidate profile with no name,
  phone, or email [7, 13].
- **Decorative or Modern Fonts** — fonts like Avenir or Montserrat often aren't installed on ATS
  servers, leading to character substitution errors where ligatures (like "fi") render as question
  marks [15, 16].
- **Non-Standard Section Headings** — parsers use keyword anchors to map content [17]. Creative titles
  like "Where I've Been" rather than "Work Experience" can prevent the system from identifying career
  history [15, 18, 19].

## 2026 ATS Formatting Rules

| Rule | Correct (Safe) | Avoid (Risky) |
|---|---|---|
| Layout | Single-column, top-to-bottom linear structure [9, 20, 21] | Two-column layouts, sidebars, complex grids [22-24] |
| Containers | Simple paragraph and bullet text [11, 20] | Tables, text boxes, floating elements [12, 25, 26] |
| Fonts | Calibri (11pt), Arial (10.5-11pt), or Times New Roman [27-29] | Script, condensed, or modern fonts (Poppins, Montserrat) [15, 30, 31] |
| Contact info | Placed in the main document body on page one [18, 32, 33] | Trapped in header/footer bands or rendered as icons [13, 14, 19] |
| Section headings | Standard labels: "Professional Experience", "Education", "Skills" [15, 17, 26] | Creative titles like "My Journey", "Knowledge Base", "Toolbox" [5, 18, 34] |
| Dates | Consistent MM/YYYY or "Month YYYY" (e.g., March 2023) [17, 20, 35] | Shortened years ('23), "Now" instead of "Present", mixed styles [36-38] |
| Separators | Simple dashes (-), commas, standard horizontal rules [20, 39, 40] | Pipe characters (\|), arrows (→), custom emoji symbols [37, 39, 41] |
| Graphics | None — list all skills and contact info as text [27, 42] | Skill bars, progress circles, logos, headshots [40, 42-44] |
| File format | Text-selectable PDF or DOCX (safest for legacy systems) [45-47] | Image-based PDFs (scanned), image files (JPG/PNG), zipped files [43, 48, 49] |

**Pro tip:** to verify a resume's "machine readability", copy all content and paste it into a plain
notepad [50-52]. If name, job titles, and dates do not appear in a logical, chronological order, the ATS
parser will experience similar failures [45, 53].

## Alignment with this project's rules

Matches `rules/cv-authoring.md`'s existing hard rules (single-column, no pipe separators, standard
fonts, MM/YYYY dates, standard section headings) — no changes needed there. This file exists to give
those rules a grounded, citable source rather than leaving the reference dangling.
