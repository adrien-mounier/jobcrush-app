# CV Authoring Rules

Canonical rules for writing or modifying any CV content in this repo. These were extracted from
CLAUDE.md §4 (Output Rules), §6 (Writing Style), and §10 (Quality Checklist) so that the
always-loaded CLAUDE.md stays lean while these rules are enforced on **every** CV edit — including
ad-hoc edits made without invoking `/tailoring` or `/cv-to-docx`.

Enforcement is automatic, not optional:
- A **PreToolUse** hook (`.claude/hooks/cv-rules-inject.mjs`) injects the digest below next to every
  `Edit`/`Write` on a CV file, so these rules are in context the moment a CV is touched.
- A **PostToolUse** hook (`.claude/hooks/cv-lint.mjs`) lints the file after the edit and blocks on
  mechanical violations (forbidden glyphs, run-on skills block, section order).

A "CV file" is any `root_cv/**/*.md`, any `**/tailored_cv/**/*.md`, or any `cv_mounier_*.md`.

<!-- DIGEST:START -->
## Hard rules (auto-injected on every CV edit)

- **Length / density:** 2 pages max, single column. Per role 4-6 bullets (current/most recent role
  may reach 8 only if every bullet earns it; roles older than ~8 years: 3-4). Count ALL bullet
  blocks under a role together; do not evade the cap by splitting into "Achievements" / "Key
  Deliveries" / etc. At most one sub-grouping per role and it counts toward the cap. One to two
  lines per bullet (three absolute max).
- **Forbidden glyphs:** no em-dash (—), en-dash (–), ellipsis (…), pipe (|) outside markdown
  tables, or semicolons as list separators. Use plain commas, full stops, or line breaks.
- **Section order is fixed** (from the root CV): Summary, Professional Experience, Personal
  Projects, Skills, Education, Additional Information. Never move Skills above Professional
  Experience.
- **Skills block:** 2-4 bold-labeled categorized groups (bold category label on its own line, comma
  list on the next line, no blank line between). 8-12 skills total. Never a run-on comma paragraph.
  One skills block only — no duplicate Core Competencies run-on.
- **Bold only:** name, section headings, employer, job title, skills category labels, education
  institutions, additional-info labels. Never bold whole sentences or bullet bodies.
- **Education / Additional Information:** bold the key info. Education: `**Institution - Location**,
  year` then the degree (plain) on the next line. Additional Info: `**Nationality:** value`,
  `**Languages:** ...`, `**Certifications:** ...` (bold label, plain value).
- **Sub-groups** ("Key Deliveries" is the standard term): standalone italic line (`*Key
  Deliveries*`), never inline, never plain text. Use only when there are 2+ achievements; a single
  achievement is a normal bullet.
- **Dates:** `Month YYYY` or `MM/YYYY`, month-first, and the SAME one of those two forms across the
  whole CV including Education and Certifications. `Present` (capitalised) for a current role.
  Never year-only (`2021 - 2024`), never year-first (`2024/03`), never two-digit years (`'24`),
  never seasons (`Summer 2023`), never `Now` or `Current`. If the source CV states only years,
  keep them exactly and raise a fix-this item asking for the months. Never infer a month.
- **Outcome-led bullets:** action verb + scope + outcome (when the source supports it). No
  responsibility-only or attendance bullets.
- **No invented facts:** never invent dates, employers, titles, certifications, or metrics. Non-
  Verified / non-Derived claims must appear in the verification audit.
- Full detail, ATS pitfalls, formatting standards, and the banned-word list are below.
<!-- DIGEST:END -->

---

## Output Rules (full — was CLAUDE.md §4)

Every tailored CV must prioritize relevance, concise recruiter-friendly language, and outcomes. No buzzword filler.

**ATS compliance** — read `/research_result/2026-05-03_ats-parsing-pitfalls.md` before any CV write. Hard constraints:
- Single-column layout. No contact info in headers or footers. No pipe `|` separators (use dash or comma).
- Standard fonts (Arial, Calibri, Roboto). Standard bullets (`•` or `-`). Dates per the Dates rule below.
- Conventional section headings ("Work Experience", "Education", "Skills"). DOCX preferred; PDF must be text-based.

**Dates** — full reference: `research/2026-05-03_ats-parsing-pitfalls.md`. Month granularity is not a
style preference; it is what makes a CV parseable and what stops a recruiter reading concealment into
the timeline.

- **Two accepted forms, month-first:** `Month YYYY` (March 2021) or `MM/YYYY` (03/2021). Abbreviated
  month names (`Mar 2021`) are acceptable inside the first form. Pick one form and apply it to every
  role, certification, and education entry. Mixing the two within a document is itself a parse hazard,
  and it is the single most common date defect.
- **`Present`, capitalised,** for a current role. Not `Now`, `Current`, `Today`, or an open-ended dash.
- **Never year-only** (`2021 - 2024`). Recruiters read year-only ranges as gap-concealment whether or
  not a gap exists, and the range still leaves the missing months visible. It also defeats tenure
  calculation and cannot order overlapping roles correctly.
- **Never year-first** (`2024/03`, `2024-03`). No mainstream parser or reader expects that ordering on
  a CV, whatever its merits as a sort key.
- **Never two-digit years** (`'24`) — they break experience calculators — and never seasons
  (`Summer 2023`), which the strictest parsers reject outright.
- **When the source CV states only years, keep them exactly and raise a fix-this item** asking the
  candidate for the months. Anti-fabrication outranks format compliance: a plausible month is still
  an invented fact. Reformatting is always allowed; supplying missing precision never is.

**Length and bullet density** — hard limits (source: `/context/research_notes/2026-05-03_it-pm-cv-best-practices.md`). These apply to every CV write AND every later edit:
- Two pages maximum, single column.
- Per role: **4 to 6 bullets**. The current/most recent role may reach **8** only if every bullet earns its place. Roles older than ~8 years: **3 to 4 bullets**.
- **Count all bullets under a role together.** Do not evade the cap by splitting one role into several bullet blocks ("Achievements", "Key Deliveries", "AI Operations", etc.). At most one short sub-grouping per role, and it counts toward the cap.
- One to two lines per bullet, three absolute maximum. Merge related points; quality over completeness.
- Outcome-led: action verb + scope + outcome where the source supports it. No responsibility-only or attendance bullets.
- When editing an existing CV, re-check these limits before saving the new version.

**Visual formatting and section design** — full reference: `/research_result/2026-06-09_cv-formatting-design-standards.md`. Apply on every CV write:
- **Section order is fixed by the root CV** (Summary, Professional Experience, Personal Projects, Skills, Education, Additional Information). Never move Skills above Professional Experience (council-validated 2026-06-11).
- **Never write a skills/competencies block as a run-on comma paragraph.** Use 2-4 categorized groups, each a bold category label on its own line followed by a comma-separated list. 8-12 skills total. (Markdown: a line wrapped entirely in `**...**` renders as a bold sub-label; put the comma list on the next line with no blank line between.)
- **Do not run two near-identical Skills and Core Competencies blocks.** Default to one categorized Skills section; only keep a separate Core Competencies snapshot if it genuinely differs (and is itself categorized, never a run-on).
- **Bold the key info in EDUCATION and ADDITIONAL INFORMATION.** Education: `**Institution - Location**, year` then the degree (plain) on the next line. Additional Information: `**Nationality:** value`, `**Languages:** ...`, `**Certifications:** ...` — bold label, plain value.
- Employer line bold; date line and italic role title (`*Role*`) each on their own line. First `##` is the centered role headline (the builder injects the "Professional Summary" heading after it).
- **Project-achievement sub-groups** ("Key Deliveries" is the standard term, recruiter-recognized): write the label as a standalone italic line (`*Key Deliveries*`) so it renders as a muted-gray, indented italic sub-label that sits clearly below the employer and role title in the visual hierarchy. Never inline (`*Key delivery:* text...`) and never plain text — both render as ordinary body. Use a sub-group only when there are **2 or more** achievements; a single achievement is a normal bullet (no sub-group). The sub-group counts toward the role's bullet cap (density limits above).
- Bold only: name, section headings, employer, job title, skills category labels, education institutions, additional-info labels. Never bold whole sentences or bullet bodies.

---

## Writing Style (full — was CLAUDE.md §6)

**Before writing or modifying CV content for PM roles, read** `/context/research_notes/2026-05-03_it-pm-cv-best-practices.md`. It covers CV length, bullet formula, and 2026 trends; it takes precedence over generic CV conventions, EXCEPT its section-order advice, which is superseded by the root-CV order rule above (Skills after Professional Experience).

- Professional, direct, modern, concise. Optimized for IT recruiters and hiring managers.
- **Strong action verbs**: led, delivered, coordinated, prioritized, owned, defined, scaled, automated, aligned, translated, facilitated, negotiated, mitigated.
- **Outcome-oriented** bullets: action + scope + outcome (when outcome is in source).
- No first-person pronouns, no exaggerated claims, no decorative fluff, no emojis.
- Bullet length: one to two lines. Numbers as figures (e.g. "12 stakeholders", "€2M budget").
- **No AI-typographic artifacts**: no em dashes (—), en dashes (–), pipe characters outside tables, ellipses (…), semicolons as list separators. Use plain commas, full stops, or line breaks.
- **No AI-language tells**: read `/research_result/2026-05-09_ai-writing-tells.md` for the full banned-word and banned-opener lists. Vary sentence length. Do not close paragraphs by restating the opener.

---

## Quality Checklist (full — was CLAUDE.md §10)

Apply before finalizing any tailored CV:

- [ ] No dates, employers, titles, certifications, or metrics were invented.
- [ ] Every non-Verified/non-Derived item appears in the audit with risk level and recommended action.
- [ ] All High-risk audit items reviewed by the candidate before submission.
- [ ] ATS compliance verified per `/research_result/2026-05-03_ats-parsing-pitfalls.md`.
- [ ] One date form (`Month YYYY` or `MM/YYYY`) used across every role, certification, and education
      entry; no year-only, year-first, or two-digit years; `Present` for the current role. Year-only
      dates inherited from the source are preserved and raised as a fix-this item, never filled in.
- [ ] Bullet caps respected (4-6 per role, max 8 for the current role, 3-4 for roles older than ~8 years), counting all bullet blocks under a role together; CV fits two pages.
- [ ] Output filenames follow CLAUDE.md §9 conventions; no prior version overwritten.
- [ ] Tailoring report saved with all decisions (kept/edited/removed/confirmed) recorded.
- [ ] User-confirmed additions persisted to `/context/`.
