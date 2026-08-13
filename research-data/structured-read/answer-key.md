# Answer key — #202 AC3

**Built by:** the Claude agent (`claude-opus-5`), 2026-08-13.
**Effort:** ~35 minutes wall-clock, unattended. **No human has adjudicated it yet.**
**Source:** `cvs.json` — the cached raw PDF text extract, the same bytes every graded reader saw.
**Not used as a source:** any reader output in `out/`, the live `claim-miner.md`, or any LLM pass.
The mechanical half (line split, page-wrap rejoin, exact-duplicate collapse) is `key-draft.mjs`;
the judgement half (ruling-1 semantic merges, job↔bullet assignment) is recorded below and in
`score.mjs`'s `KEY` table.
**Rulings applied:** `decisions.md`, "Settled — 2026-08-13" (count once / capture whole / one bullet).
**Skills:** deliberately not keyed — splitting rule undecided.

---

## Headline

| | Thomas | Giuliana |
|---|---:|---:|
| Bullet lines printed under a job (ruling 3 applied) | **93** | **25** |
| …after exact/normalised duplicate collapse (ruling 1, mechanical) | 71 | 25 |
| **…after semantic merges (ruling 1, judgement) — THE KEY** | **67** | **22** |
| Jobs | **8** | **4** |
| Education entries | **4** | **1** |
| Certifications | **1** (borderline, see below) | **0** |
| Languages | **3** | **2** |

`decisions.md` estimated 93 printed / 73 distinct for Thomas. 93 is confirmed exactly. The distinct
count is **71**, not 73: two pairs the earlier hand count treated as different are the same text once
the rulings are applied — line 50 `Définir le planning prévisionnel de chantier.` carries a trailing
full stop that line 138 does not, and line 55/56 is a page-wrap (`…selon les normes` / `SIA)`) that a
naive split leaves as a fragment.

---

## 2024-Thomas Chauviere CV.pdf

### Jobs (8)

| # | Employer (as written) | Title (as written) | Dates | Bullets printed |
|---|---|---|---|---:|
| 1 | Façade technique, Groupe Gottburg, Mont sur Lausanne, Suisse | Chef de projet - Dessinateur façade ventilée | 01/2024 – Actuellement en poste | 21 |
| 2 | FACETEC, Crissier, Suisse | Technicien - Dessinateur façade ventilée | 06/2021 – 12/2023 | 22 |
| 3 | BTM CONSULTANT, Lyon, France | Dessinateur Projeteur GC | 10/2018 – 05/2021 | 23 |
| 4 | SETEC TPI, Paris, France | Dessinateur Projeteur / SYNTHESE GC | 12/2017 – 08/2018 | 11 |
| 5 | SYSTRA, Paris, France | Dessinateur Projeteur GC | 09/2017 – 10/2017 | 0 |
| 6 | LEGENDRE CONSTRUCTION, Paris, France | Assistant conducteur de travaux | 01/2016 – 03/2016 | 7 |
| 7 | BOUYGUES CONSTRUCTION PRIVEE, Paris, France | Coordinateur et agenceur de projet | 01/2014 – 04/2014 | 5 |
| 8 | CBC VINCI, Paris, France | Assistant conducteur de travaux | 04/2012 – 06/2012 | 4 |

**Total printed: 93.** Job 3 is delivered through two named clients — `TRACTEBEL (client) - 10/2018
-12/2020` and `ASSYTEM (client) - 02/2021 - 05/2021`. They are keyed as one employer with two client
engagements, not as two jobs.

### ⚠️ The job↔bullet assignment is a judgement, and it is the weakest part of this key

The cached text layer for this CV is out of order — a two-column layout read column-first, so bullets
sit before, after, or pages away from their heading. Assignment was done **by content**, not by
position, and the reasoning is recorded so it can be overturned:

| Lines | Assigned to | Why |
|---|---|---|
| 13–20 | Job 2 (FACETEC) | Facade drawing duties; heading follows immediately at 21–23. |
| 36–58 | Job 1 (Gottburg) | Date 01/2024 at line 35 opens the block; heading at 59–60. |
| 137–152 | Job 2 (FACETEC) | Swiss facade site work (`normes SIA`, `contremaîtres`), so it cannot be BTM (Lyon, nuclear/civil drafting). It is the second half of FACETEC's list, spilling onto page 2. |
| 83–109, 129–131, 156–159 | Job 3 (BTM) | Nuclear/submarine/rail drafting under the `Projet:` headings for EPR UK1221, BARRACUDA, LUCIANA (Tractebel) and Fessenheim (Assystem). |
| 165–172 | Job 6 (LEGENDRE) | `deux chantiers` matches "deux bâtiments de logements"; `base vie`, `personnel de maçonnerie` are site-manager duties, not rail drafting. **These bullets are printed above the LEGENDRE heading and below the SYSTRA one** — content decides. |
| 177–183 | Job 7 (BOUYGUES) | Design-fault audits and an Excel tracker: a coordinator's work. |
| 188–191 | Job 8 (CBC VINCI) | Métrés, devis, interior fit-out. |
| 210–222 | Job 4 (SETEC TPI) | L14 Sud / Pont de Rungis station modelling; project heading 223–224 and employer 225–227 follow. |

**Job 5 (SYSTRA, one month) genuinely has no bullets** — only a project line. A reader that assigns
bullets 165–172 to SYSTRA instead of LEGENDRE is making the same judgement in the other direction and
is not scored wrong here, because **the headline recall number does not depend on the assignment** —
only the per-job breakdown does.

### Education (4)

| # | Qualification | School | Dates |
|---|---|---|---|
| 1 | Licence Génie Civil (Equivalent CFC) | Université de Nantes, France (44) | 2015–2017 |
| 2 | Licence Professionnelle chargé d'affaires en contrôle des bâtiments (Equivalent CFC) | Université de Sénart, France (77) | 2013–2015 |
| 3 | BTS Bâtiment | Lycée Saint Lambert, Paris 15ème, France | 2011–2013 |
| 4 | BAC STI Génie Civil | Lycée Saint Lambert, Paris 15ème, France | 2010–2011 |

### Certifications (1 — borderline, flagged not scored)

`Formation Revit Intermediaire Structure`, Lyon, France (44), 11/2020. **It is a training course, and
whether a training course is a certification is not ruled on anywhere.** Keyed as 1 because it is a
dated, named, externally-delivered credential; a reader that returns 0 here is **not** counted wrong.
The CV states no validity or expiry.

### Languages (3)

Français — langue maternelle · Anglais — B2 · Espagnol — B1.

---

## Giuliana_DELRE_Resume V3.pdf

Clean single-column text layer; assignment is unambiguous.

### Jobs (4)

| # | Employer | Title | Dates | Bullets printed |
|---|---|---|---|---:|
| 1 | PROVA ASIA Ltd., Bangkok | Purchasing Manager - Ingredient & Packaging | 2025 – Current | 9 |
| 2 | PROVA ASIA Ltd., Bangkok | Purchasing & Supplier Scheduling Supervisor - Industrial Ramp-Up Phase | 2024 – 2025 | 7 |
| 3 | PROVA ASIA Ltd., Bangkok | Purchasing & Supplier Scheduling Officer – Industrial Start-Up Phase | 2023 – 2024 | 6 |
| 4 | PROVA SAS, Montreuil, France | Junior Purchasing Officer – Direct Raw Materials | 2022 – 2023 | 3 |

**Total printed: 25.** Each of jobs 1–3 prints its bullets in two blocks — unlabelled duty bullets,
then a `Key Achievements:` sub-heading. Job 4 has duty bullets only and no `Key Achievements`.
Job 1: 5 duties + 4 achievements. Job 2: 3 + 4. Job 3: 3 + 3. Job 4: 3 + 0.

**The `36 bullets` figure quoted in `structured-read-cost.md:253` is wrong** and had no provenance,
as the prep note warned. The CV prints **25** bullets under jobs; the other 9 bullets on the page are
7 in the `Professional Skills` block (excluded — skills are not keyed) and 2 under `Education`.

### Education (1)

Master's Degree in Engineering: International Agro-Development, ISTOM, Angers, France, Jan 2022.
Its two bullets (thesis; `Specialization in International Markets, ESA`) are keyed as **detail of
that entry, not as separate entries**. The lean reader returns 3 education entries by promoting both
bullets; that is a defensible alternative reading and is flagged, not scored.

### Certifications (0) · Languages (2)

English (fluent) · French (native). Levels are printed verbatim; no certification appears anywhere.

---

## Appendix — every ruling-1 semantic merge, side by side

Exact and normalised-exact repeats are collapsed mechanically and are **not** listed here (Thomas:
20 texts repeated, one of them three times — `key-draft.mjs` prints the list). Below are the merges
that required judgement. **Each one lowers the key by 1, so each one is worth checking.**

### Thomas — 4 merges (71 → 67)

| Text A | Text B | Why merged |
|---|---|---|
| `Assister à des réunions hebdomadaires d'avancement de projet` (L88, EPR UK1221) | `Participer aux réunions d'avancement du projet` (L104, BARRACUDA) | Same action, same object: attending project progress meetings. Two projects, one employer. |
| `Suivre l'avancement des chantiers` (L172, LEGENDRE) | `Suivre l'avancement du chantier` (L191, CBC VINCI) | Singular/plural apart, the identical sentence. Two employers. |
| `Créer des familles, des filtres et des gabarits` (L96, BARRACUDA) | `Création de familles, de gabarits et filtres` (L213, SETEC) | Verb form and word order apart, the identical sentence. Two employers. |
| `Mettre à jour des éléments structures INSITU en famille sur Revit` (L157, BTM/Fessenheim) | `Mettre à jour des éléments de structure infra et super` (L212, SETEC) | ⚠️ **Weakest merge.** Same action and object — updating structural elements in Revit — but different qualifiers. Reverse it and the key becomes 68; no prompt's rank changes. |

### Giuliana — 3 merges (25 → 22)

| Text A | Text B | Why merged |
|---|---|---|
| `Performance: Developed KPI dashboard and a supplier evaluation framework` (L22, job 1 duty) | `Implemented a purchasing dashboard to improve operational visibility` (L27, job 1 achievement) | One dashboard, built once, printed twice — as a duty and again as an achievement. |
| `Built and developed a performance-driven purchasing team` (L26, job 1 achievement) | `Team: Recruited and trained two purchasing officers` (L35, job 2 duty) | Building the team *is* recruiting and training the two officers. Across two roles at one employer. |
| `Supplier scheduling: Structured stock monitoring, safety stock and PO-tracking tool` (L34, job 2 duty) | `Structured safety stock and shortage management monitoring` (L42, job 2 achievement) | Same action on the same object. |

⚠️ **All three Giuliana merges pair a duty line with an achievement line.** If [#206](https://github.com/adrien-mounier/jobcrush-app/issues/206) decides a
duty and an achievement are different records even when they state the same fact, these three merges
must be reversed and the Giuliana key becomes **25**. Recall percentages shift by ~2 points and **no
prompt's rank changes**, because the rich reader misses all three duty lines either way.

### Considered and deliberately NOT merged

- Thomas L90 `Analyser les données d'entrée et le C.C.T.P` vs L167/178 `Etudier le C.C.T.P` — L90 carries additional content (input data).
- Thomas L165 `Prendre connaissance des deux chantiers…` vs L177 `Prendre connaissance du projet et analyser les normes` — one adds site constraints, the other adds standards analysis.
- Thomas L52/145 `Coordonner l'avancement du chantier` vs L172/191 `Suivre l'avancement du chantier` — coordinating deliveries is not the same as monitoring progress.
- Thomas L171 `Coordonner le personnel de maçonnerie` vs L190 `Coordonner une équipe d'entretien de chantier` — different teams.
- Thomas L158 `Modéliser des elements de structures` vs L210 `Modéliser la superstructure d'une gare : murs, dalles…` — different subject matter.
- Giuliana L19 `Team: managing two purchasing officers` vs L35 `Team: Recruited and trained two purchasing officers` — managing an existing team is not recruiting it.
- Giuliana L32 `formalized supplier approval workflow` vs L53 `Structured the supplier selection and onboarding process for oversea purchasing` — different scope, different role.

---

## How the scoring works (`score.mjs`)

A key fact counts as **captured** when any string anywhere in a reader's parsed output contains ≥60%
of that fact's content words (stopwords and words under 3 characters dropped). Deliberately generous:
recall asks *"is the fact in the output at all"*, not *"is it in the right field"*. Where a fact was
merged, matching **any** of its printed wordings counts.

Spot-checked against rare terms (`plans historiques`, `outillage`, `ligne de tins`, `cabane de
chantier`) to confirm the matcher is not scoring by accident, and the spread it produces (50/67 to
67/67 on the same CV) shows it discriminates.
