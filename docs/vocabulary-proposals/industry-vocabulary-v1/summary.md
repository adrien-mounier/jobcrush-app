# Vocabulary proposal: the industry axis (v1)

**Kind**: the first publication of the closed **industry** vocabulary — 15 industries in 7 groups
**Ticket**: #280 (spec #279, parent #217, ADR-0014 decision 2 / amendment 2)
**Published as**: `apps/api/research/industry-vocabulary-v1.json`, read by
`apps/api/src/industryVocabulary.ts`

## What this list is for

The second axis of a job. Every industry belongs to exactly one group, and closeness is read off
the groups: the same industry is `exact`, a different industry in the same group is `near`,
anything else is `far`. Banking against a finance bar reads near; banking against chemicals reads
far. The judgement is made here, once, and is arithmetic ever after — nothing asks a model how
close two industries are at scoring time.

Nothing a visitor sees changes at v1. This publishes the words the next five tickets speak.

## Where the evidence came from

**One honest correction first.** #280 names "the employers already present in uploaded CVs" as an
evidence source. There are none. The three files in `apps/api/data/uploads` are **generated dev
fixtures** (`apps/api/test/fixtures/generate.mjs`) — an invented person at Nordic Retail Group and
Baltic Software House. The product is pre-launch and no real CV has been uploaded to it, so that
half of the ticket's evidence does not exist yet. The industries those fixtures would have
contributed (retail, IT services, education) are all carried independently by the sources below, so
the list does not lean on invented employers; but the claim had to be corrected rather than dressed
up.

What the list was actually drafted from, both real:

- **Employers in the advert corpus the product has actually retrieved from its served markets**
  (`apps/api/data/sample-postings.json`, plus the posting evidence behind the two published
  families) — DBS Bank, BNP Paribas ×2 (banking) · Manulife (insurance) · OKX, TransUnion,
  Computershare, Synpulse (finance: exchange, credit data, share registry, wealth) · Datadog,
  Cloudflare, Asana, Scale AI, MRI Software (software) · Endava Vietnam, 华信科技有限公司, altech
  (IT services) · PwC Australia, ABeam Consulting (consulting) · Hays, TEKsystems, Charterhouse
  Partnership, luvo Talent, Sanderson-iKas (staffing) · Schneider Electric (manufacturing).
- **The markets the product serves** — Hong Kong, Singapore, Vietnam, Australia
  (`coveredRegionCodes()`, off the provider registry). These add the industries the corpus is too
  small to have caught yet but the markets are built on: logistics and ports (HK/SG), manufacturing
  (VN), hospitality and travel (HK/VN), energy and utilities, healthcare, chemicals.

## The proposed list

Each group is followed by its industries. Full scope sentences are in the JSON.

| Group | Industries | Why the group is tight enough for `near` |
|---|---|---|
| **Financial services** | banking · finance · insurance | Money, credit and risk. Moving between them is a real career move people make; none of them is a business that merely *uses* finance. |
| **Technology** | software · it-services | Both build and run software. The split is what the buyer buys — a product, or a team. |
| **Professional services** | consulting · staffing-and-recruitment | Both sell people's time per engagement to other organisations. |
| **Industrial** | manufacturing · chemicals · energy-and-utilities | Plants, processes and physical output at scale; plant operations, HSE and industrial supply chains carry across. |
| **Consumer** | retail-and-consumer · hospitality-and-travel | Selling to the public, at a counter or at a front desk. |
| **Transport and logistics** | logistics-and-transport | *One member today* — see the open points. |
| **Public and social** | healthcare · education | Care and teaching; public funding, regulation and accreditation carry across. |

Closeness this produces, on the cases the ticket names: banking→banking `exact` · banking→finance
`near` · banking→chemicals `far` · software→logistics-and-transport `far`.

## Deliberate choices worth the owner's attention

1. **`finance` exists as an industry alongside `banking`.** Adverts say "finance" constantly and
   mean the whole sector loosely. Rather than force the advert reader to guess which specific
   entry it meant, `finance` is a real entry ("financial services other than banking and
   insurance"), and a banker answering a finance bar reads `near` — full years, card attenuated
   ×0.9. That is exactly the behaviour #279 designed.
2. **No `fintech`.** A payments or crypto business sells a financial service and is `finance`; the
   vendor selling software to it is `software`. A consultancy building a bank's app is `consulting`
   plus `banking` — the two-industry case, not a third word.
3. **Consulting and staffing carry the *employer's* industry only.** The industry the work was
   served into is the second fact on the same job (#282), never a replacement for the first.
4. **`transport-and-logistics` has one member.** Nothing reads `near` to logistics until a sibling
   is published — honest, and cheaper than inventing a sibling to make the group look full.
   Candidate siblings when evidence arrives: aviation services, maritime and ports.
5. **Known gaps, left for the growth process rather than guessed at now**: mining and resources (a
   signature Australian industry with no evidence in our corpus yet), government and public sector,
   media and entertainment, property and construction, agriculture, telecommunications, legal
   services as its own entry. Each enters through #218/#251's approval path; the only new question
   is which group.

## Spend receipt

- **Calls: 0 · Dollars: USD 0.00.** No provider or model call was made: the evidence was already in
  the repo (uploaded CVs, the retrieved advert corpus, the provider registry). Neither the call cap
  nor the dollar cap was approached.

## Decision

- [x] **Approved** — owner, 2026-08-23 (#280). **Nothing changed, nothing rejected**: the list was
  approved as drafted, all 15 industries in all 7 groups, with the four choices above (the `finance`
  entry beside `banking`, no `fintech`, the single-member transport group, and the six deferred
  industries) put to the owner explicitly and accepted as drafted. Published as
  `apps/api/research/industry-vocabulary-v1.json`; this folder keeps the summary as the decision
  record.
