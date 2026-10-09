# Judging rules — product-management corpus (written 2026-10-10, BEFORE any advert was judged)

## Membership: the draft scope sentence (this decides `occupation`)

**In (`in`):** deciding what a digital or technology product does and why, and steering the team
that builds it: owning the product's vision and roadmap, understanding user and business needs,
setting priorities and owning the backlog the build team works from, and answering for what the
product achieves. The product is software, an app, a platform, a data or AI product, or a
digital service, built by an engineering team. Any title: product owner, product manager,
technical/digital/platform/data/AI product manager, head of product, product lead, and corporate
grades (AVP, VP, Senior Manager) whose body describes this work. Seniority and employer industry
do not matter (a bank's digital product owner is in).

**Out — mark which:**
- `out-commercial` — the "product" is a financial, insurance, consumer-goods or service offering
  managed commercially: designing rates, fees, coverage, features of a loan/card/policy/fund,
  pricing, sales targets, campaigns, brand. No engineering team builds it from a backlog the
  person owns. (A bank PM for the mobile app = in; a bank PM for mortgage products = out.)
- `out-marketing` — product marketing / go-to-market / growth marketing as the core job.
- `out-delivery` — running delivery (project/programme manager, scrum master, delivery lead).
- `out-analyst` — business/systems analyst writing requirements without owning priorities.
- `out-other` — anything else (engineering, design, sales, support, hardware/medical-device product
  engineering, recruiter spam, etc.). Say what in `outNote`.

When an advert mixes, judge the CORE of the job (what most of its duties are). Mark `in` only
when the person owns what gets built (priorities/backlog/roadmap) for a digital/tech product.

## Title kind
`titleKind`: `PO` (title says product owner), `PM` (title says product manager / head of product /
product lead / product director), `both` (title names both), `other`.

## The recognition rule (for every item below)
An item counts for an advert if **the advert names that activity as a duty of the job, or as a
required or preferred skill.** Naming the artefact as something someone else produces does not
count. An advert counts once per item however often it says it. Judge only `in` adverts; for out
adverts set `items` to null.

## Candidate floor items
- `I1 backlog` — owns, manages, refines or prioritises a product backlog / sets sprint or release
  priorities for a delivery team.
- `I2 stories` — writes user stories, acceptance criteria, requirements, PRDs or specifications.
- `I3 roadmap` — defines product vision, strategy or roadmap.
- `I4 discovery` — researches users/customers/market: user research, customer interviews,
  competitor/market analysis, discovery, validating ideas, prototypes or hypotheses.
- `I5 teamwork` — works day to day with engineering (and/or design) in a cross-functional or
  agile team: sprint planning, reviews, refinement, stand-ups, ceremonies.
- `I6 stakeholders` — aligns or manages business stakeholders on priorities, trade-offs, scope;
  communicates the roadmap/progress to them.
- `I7 metrics` — defines or tracks product metrics/KPIs/OKRs, or uses data, analytics or
  experiments (A/B tests) to make product decisions.
- `I8 launch` — plans product launches / go-to-market / rollout and adoption with marketing,
  sales, operations or training.
- `I9 acceptance` — accepts or validates delivered work: UAT, testing, sign-off, sprint
  review/demo of the increment.
- `I10 commercial` — owns the business case, P&L, revenue, pricing or commercial outcome.
- `I11 agile` — Agile/Scrum knowledge or certification (CSPO, PSPO, SAFe) as a required or
  preferred skill.
- `I12 technical` — technical understanding required to work with engineers: APIs, system
  architecture, integrations, data, cloud.
- `I13 ux` — shapes user experience / customer journeys with designers (UX, journey mapping,
  wireframes).
- `I14 regulatory` — ensures the product meets regulatory, risk, security or compliance
  requirements.
- `I15 jira` — Jira / Confluence / Azure DevOps (tool).
- `I16 analyticsTool` — SQL or an analytics tool (Amplitude, Mixpanel, Google Analytics, Tableau,
  Power BI, Looker) (tool).

Years, degrees, languages and locations are never items — do not record them.

## Output, one JSON object per advert, one per line (JSONL)
{"n":12,"occupation":"in","outNote":null,"titleKind":"PO","items":{"I1":1,"I2":1,"I3":0,...,"I16":0},"otherDuties":["short phrase of any recurring duty NOT covered by I1-I16"]}
For out adverts: {"n":13,"occupation":"out-commercial","outNote":"credit card product pricing and campaigns","titleKind":"PM","items":null,"otherDuties":[]}
