# Target-location selection in real job products

Research for issue #124 ("Where do you want to work? Let the visitor choose target locations").
Date: 2026-08-13. Focus: APAC-relevant products. Primary sources (products' own help centres,
developer docs, privacy policies) wherever reachable; secondary sources are flagged as such.
Anything not confirmed from a source is marked **UNVERIFIED**.

## Summary table

| Product | Multi-location saved preference? | Cap | Granularity | Remote/hybrid | Right-to-work tie-in |
|---|---|---|---|---|---|
| LinkedIn | Yes — Open to Work saves multiple "Locations" | 5 (secondary sources; no cap in LinkedIn's own help) | City → country; continents/multi-country regions not supported | Separate "Location types" field: On-site / Hybrid / Remote | Not tied to locations (employer screening qs exist, not per-location) — UNVERIFIED beyond that |
| SEEK (AU/NZ) | Yes — profile "preferred locations", plural, auto-grows on apply | No cap documented | Suburb → area → state → country hierarchy | Separate work-arrangement code (`Remote`); a location is still required | Yes — library screening question "right to work in Australia" with visa-level options, per-market libraries |
| JobsDB / JobStreet | Same SEEK platform: plural preferred locations, auto-add on apply | No cap documented | Same SEEK hierarchy (granular in HK, ID, MY, PH, SG, TH) | Same SEEK model | Same questionnaire system, tailored per job-ad location / market |
| Indeed | No — one location per search/alert; multiple alerts instead | n/a (many alerts allowed) | City, state/province, ZIP/postcode, country | "Remote" typed as a location value; profile also stores a remote/hybrid preference | Not location-tied — UNVERIFIED |
| 104 (Taiwan) | Yes — 希望工作地 multi-select in job-seeking conditions | 5 locations (3 job categories) — secondary source | City (市/縣) and district (區); both selectable | Not a location value (remote work 遠端 is a separate ad attribute) — partially UNVERIFIED | No evidence of per-location work-auth questions |
| VietnamWorks | Search filter by location exists; saved multi-location preference UNVERIFIED | UNVERIFIED | City/province filter | "Working type" is a separate filter axis | No evidence found |
| Glassdoor | No — one location per alert | Up to 10 alerts | City, state, ZIP | Remote is NOT accepted as a location in alerts | No evidence found |

## Q1 — One location at a time vs several at once

- **LinkedIn**: a *search* takes one location, but the saved **Open to Work job preferences**
  include a plural "Locations" field alongside job titles, start date, and location types
  ([LinkedIn Help — Open to Work](https://www.linkedin.com/help/linkedin/answer/a507508/let-recruiters-know-you-re-open-to-work?lang=en)).
- **SEEK**: the profile's "About your next role" section saves plural preferred locations, and —
  notably — **applying to a job outside your list auto-adds that location to your preferences**:
  "If you apply for a job advertisement where the job location is not listed in your preferred
  locations, the new location will automatically be added to your list of preferred locations"
  ([SEEK privacy policy, §13(c)](https://nz.seek.com/privacy)).
- **JobsDB/JobStreet**: identical sentence in the [JobStreet privacy policy](https://my.jobstreet.com/privacy) —
  both brands run on the unified SEEK platform
  ([SEEK Developer — Jobstreet and Jobsdb uplift](https://developer.seek.com/migration-guides/jobstreet-and-jobsdb-uplift/phase-2-job-posting)).
- **Indeed**: one location per search; job alerts are saved searches, so **one location per
  alert, many alerts** ("You must delete each job alert separately if you have multiple alerts")
  ([Indeed Help — job alerts](https://www.indeed.com/help/job-seekers/articles/204488890-starting-stopping-and-managing-job-alerts?hl=en&co=US)).
- **104**: the resume's 求職條件 (job-seeking conditions) include a multi-select 希望工作地
  (desired work locations) that recruiters filter on
  ([recruiter-side walkthrough, secondary](https://medium.com/@hankliu0923/104-vip-1e68c0ba9802)).
- **VietnamWorks**: search results "can filter … by specific criteria (Location, Job function,
  Industry, Levels, Working type…)" ([VietnamWorks FAQ](https://faq.vietnamworks.com/en/job/search-jobs-on-vietnamworks));
  whether a saved profile preference takes multiple locations is **UNVERIFIED** (help centre does not document it).
- **Glassdoor**: one location per alert, up to 10 alerts
  ([Glassdoor Help — job alerts](https://help.glassdoor.com/s/article/Job-Alerts-on-Glassdoor?language=en_US)).

**Pattern:** live search = one location at a time; the *saved preference* is where multi-select
lives (LinkedIn, SEEK-family, 104). Indeed/Glassdoor get multi-location via multiple alerts instead.

## Q2 — How many

- **LinkedIn Open to Work: 5 locations** — consistently reported by multiple secondary sources
  ([The Interview Guys](https://blog.theinterviewguys.com/linkedin-open-to-work-guide/),
  [resume.co](https://resume.co/blog/how-to-enable-open-to-work-on-linkedin)); LinkedIn's own
  help page lists the fields but states **no numeric cap** — treat "5" as well-attested but not
  primary-confirmed. Secondary advice converges on picking 2–3 deliberate locations.
- **104: 5 work locations, 3 job categories** — "希望工作地可選最多5種"
  ([secondary, recruiter-side walkthrough](https://medium.com/@hankliu0923/104-vip-1e68c0ba9802)); no 104 primary page found — **cap is secondary-sourced**.
- **SEEK/JobStreet/JobsDB**: no cap documented anywhere; the auto-add-on-apply behaviour implies
  the list is open-ended.
- **Glassdoor**: cap on *alerts* (10/day), not on locations per alert (always 1).
- **Indeed**: no cap found; multiple alerts is the mechanism.

**Pattern:** where a hard cap exists it is small and single-digit — 5 twice. No product exposes
an unbounded multi-select in the seeker-facing UI with a documented cap above 5.

## Q3 — Granularity

- **SEEK family (primary, developer docs)**: locations are "a hierarchy from a larger parent
  location to smaller child locations", down to **individual suburb** in the core APAC markets
  (AU, HK, ID, MY, NZ, PH, SG, TH); elsewhere "the hierarchy only extends to the country level
  (e.g. Fiji)" ([SEEK Developer — Locations](https://developer.seek.com/use-cases/job-posting/locations)).
  Coarse and fine nodes are both selectable; matching a coarse selection is containment in the tree.
- **LinkedIn (primary, job-post rules)**: city up to country is valid; "Continents or
  multinational regions larger than countries aren't supported"; only the city-level address is
  displayed on the posting
  ([LinkedIn Help — valid locations](https://www.linkedin.com/help/linkedin/answer/a593832/valid-locations-and-workplace-types-for-job-posts?lang=en)).
  LinkedIn also has metro-area geo entities ("Greater Sydney Area") in its location typeahead — **UNVERIFIED from a primary doc**.
- **Indeed**: free-text city / state / ZIP / "remote" in the where box
  ([Indeed Help](https://www.indeed.com/help/job-seekers/articles/204488890-starting-stopping-and-managing-job-alerts?hl=en&co=US)).
- **104**: both city (台北市全區) and district (信義區, 大安區…) are selectable in 希望工作地;
  the cited walkthrough recommends picking the whole city because district-level narrowing kills
  visibility ([secondary](https://medium.com/@hankliu0923/104-vip-1e68c0ba9802)).
- **VietnamWorks**: city/province-level location filter; finer granularity **UNVERIFIED**.

**Pattern:** hierarchies with mixed granularity are the norm in APAC products; nobody supports
regions bigger than a country. Coarse-vs-fine matching is done by tree containment, and products
nudge seekers toward the *coarser* node.

## Q4 — Remote/hybrid

Two distinct models exist:

- **Separate axis (workplace-type field)** — LinkedIn: On-site / Hybrid / Remote is its own
  field on postings, its own search filter, and its own Open to Work preference ("Location
  types"), independent of the Locations list
  ([job-post rules](https://www.linkedin.com/help/linkedin/answer/a593832/valid-locations-and-workplace-types-for-job-posts?lang=en),
  [find remote jobs](https://www.linkedin.com/help/linkedin/answer/a508610/),
  [Open to Work fields](https://www.linkedin.com/help/linkedin/answer/a507508/let-recruiters-know-you-re-open-to-work?lang=en)).
  SEEK family likewise: `seekWorkArrangementCodes: Remote`, and "A location is still required for
  a remote position" ([SEEK Developer — Locations](https://developer.seek.com/use-cases/job-posting/locations)).
  VietnamWorks' "Working type" filter is also a separate axis
  ([FAQ](https://faq.vietnamworks.com/en/job/search-jobs-on-vietnamworks)).
- **Remote as a location value** — Indeed accepts literally typing "remote" into the where box
  ([Indeed Help](https://www.indeed.com/help/job-seekers/articles/204488890-starting-stopping-and-managing-job-alerts?hl=en&co=US)),
  though the Indeed profile separately stores a remote/hybrid preference
  ([Indeed career advice](https://www.indeed.com/career-advice/finding-a-job/how-indeed-job-alerts-help-job-seekers)).
  Glassdoor rejects it: "Remote/Work From Home is not an applicable location for job alerts"
  ([Glassdoor Help](https://help.glassdoor.com/s/article/Job-Alerts-on-Glassdoor?language=en_US)).

**Pattern:** the modern, converged design is a **separate workplace-type axis, with remote jobs
still anchored to a geography** (LinkedIn and the whole SEEK/APAC family). Remote-as-location is
the legacy hack.

## Q5 — Right-to-work interaction

- **SEEK family (primary)**: the questionnaire library includes "Which of the following
  statements best describes your right to work in **Australia**?" with ~11 visa-level answer
  options; the Questionnaire Panel recommends questions "based on job ad location, hirer account
  domicile, job category and title" — i.e. **right-to-work is asked per application, phrased for
  the job's country**, not stored per preferred location on the seeker side. Hirers pick up to 8
  library + 3 custom questions
  ([SEEK Developer — Questionnaires](https://developer.seek.com/migration-guides/jobstreet-and-jobsdb-uplift/phase-2-job-posting/questionnaires)).
  SEEK also runs verified right-to-work credentials
  ([SEEK Pass](https://help.seekpass.co/hc/en-us/articles/360000440275-How-does-verified-Right-to-Work-help-employers),
  [seeker help](https://help.au.seek.com/article/Why-am-I-being-asked-to-verify-my-right-to-work-when-applying-for-a-job-AU)),
  and the profile can optionally carry right-to-work info as background data
  ([JobStreet privacy](https://my.jobstreet.com/privacy)).
- **LinkedIn / Indeed / 104 / VietnamWorks**: no product ties work-authorization to the *saved
  preferred locations*; where it appears, it is an employer screening question on the individual
  application. Absence of a tie-in on these four is **UNVERIFIED** (no primary doc states it
  either way).

**Pattern:** no product asks "for each of your target locations, can you work there?" up front.
Work authorization lives at apply time, scoped to the job's country, driven by the employer.

## What this implies for a 3-location multi-select

A 3-location multi-select saved preference is squarely inside industry practice, on the
conservative end: the two documented caps are both 5 (LinkedIn Open to Work, 104), SEEK's list is
uncapped but its own guidance ecosystem pushes toward a handful, and the products with *no*
multi-select (Indeed, Glassdoor) force seekers to simulate it with parallel alerts — evidence the
need is real. Three design choices follow from the evidence: (1) make each entry a node in a
location hierarchy so "Sydney" and "Australia" are both valid answers and matching is tree
containment, but do not offer anything broader than a country; (2) keep remote/hybrid as a
separate workplace-type toggle, never a fourth "location" — every APAC-relevant product that
modernised landed there, and SEEK explicitly still anchors remote jobs to a geography; (3) do not
attach right-to-work questions to the location picker — no product does; authorization belongs at
apply time, phrased for the specific job's country. SEEK's auto-add-on-apply is the one
behavioural nicety worth stealing: treat an application outside the saved locations as a signal
to update the preference rather than an error.
