# Empty-result wording for the deck

Date: 2026-08-16

Issue: [#239 — The empty-result wording is ours alone](https://github.com/adrien-mounier/jobcrush-app/issues/239)

## Short answer

Keep the JobCrush dead end as a direct statement plus one useful action. The industry pattern is not a lone imperative. Tinder and Reed both say what happened, then name the user's next move. LinkedIn's guest Jobs surface was not reachable as a true zero-result state in this probe; it broadened the search into results and job alerts instead, while its Help docs confirm that the search surface uses filters, suggestions, and alerts.

Recommended direction:

- Replace the bare line `Try a different job title.` with a small family built around `No jobs found / No more jobs ... right now` plus the available next action.
- Keep the #228 offer shape, but soften `Your CV also proves other work` to `Your CV points to other work`; it is plainer, less courtroom-like, and still does not name a family or expose the machine's fallback.
- Do not mention job families, search vocabulary, provider gaps, repairs, or counts.
- Keep the #245 searching state separate; "still looking" is a wait state, not an empty state.

## Source table

| Product / source | Exact strings observed | What it does beyond the sentence | Use for JobCrush |
|---|---|---|---|
| Tinder web app payload, logged-out `https://tinder.com/app/recs` | `There's no one new in your area.` / `Expand your distance preferences to see more people.` | States scarcity as temporary/local and gives one setting-level action. | Good model for "right now" plus one action; do not make the user diagnose the system. |
| Tinder Help: ["I'm not seeing profiles in Discovery"](https://www.help.tinder.com/hc/en-us/articles/115003496123-I-m-not-seeing-profiles-in-Discovery) | `No new profiles around you?` | Tells the user to widen gender, age, and distance settings. | Confirms that Tinder's answer is widening preferences, not technical explanation. |
| Tinder Help: [Discovery Settings](https://www.help.tinder.com/hc/en-us/articles/115003340963-Discovery-Settings) | `Dealbreakers` | Tinder may show people outside distance/age preferences when in-range recommendations run out, unless toggles prevent it. | Comparable to JobCrush only if widening is explicit or previously allowed. JobCrush should keep #228's consent gate. |
| LinkedIn Jobs guest page probe: `https://www.linkedin.com/jobs/search/?keywords=zzzxxyyqwertynomatchesabc&location=Hong%20Kong%20SAR` | `We couldn’t find a match for Zzzxxyyqwertynomatchesabc jobs in Southern District` / `Please make sure your keywords are spelled correctly` | Offers radius controls and keeps the search inputs editable. | LinkedIn supports the pattern "state what failed, then suggest a concrete change"; it does not use a bare imperative as the whole empty state. |
| LinkedIn Help: [Search for jobs on LinkedIn](https://www.linkedin.com/help/linkedin/answer/a511260) and [Filter and sort job search results](https://www.linkedin.com/help/linkedin/answer/a507441/filter-and-sort-job-search-results) | `filters or suggestions` / `get job alerts` | Help docs tell users to refine with filters/suggestions and turn on alerts after applying filters. | Use the behavior pattern: refinement and alerting, not explanation of matching internals. |
| Reed Jobs live search: `https://www.reed.co.uk/jobs/zzzxxyjobcrushnonesuchrole-jobs` | `No jobs found` / `Try alternative terms` / `Adjust the filters to broaden your search` / `Create an alert for new jobs matching this search` | Shows the failed search, then gives search tips, filter broadening, alert creation, and similar-search/location links. Screenshot: [`screenshots/research-239/reed-zero-results.png`](../../screenshots/research-239/reed-zero-results.png). | Strong job-board precedent for state + actions. The closest JobCrush action is a different title; the optional #228 action is explicit widening. |

## Evidence artifacts

- Reed live zero-result screenshot, saved locally under the repo's ignored `screenshots/` evidence area: [`screenshots/research-239/reed-zero-results.png`](../../screenshots/research-239/reed-zero-results.png). Force-add it if this screenshot needs to travel with a commit.
- LinkedIn's exact zero-result text was captured from the first-party guest Jobs HTML on 2026-08-16. A Playwright screenshot attempt against the same query broadened into a signed-out results/alert page, so no LinkedIn screenshot is kept as evidence.
- Tinder's no-new-profiles behavior is cited from first-party Help and first-party app payload evidence. A Playwright screenshot attempt against the Help page stopped at Cloudflare verification, so no Tinder screenshot is kept as evidence.

## Current JobCrush surface

Current strings in `apps/web/app/deck/page.tsx`:

- `No matches yet.`
- `Try a different job title.`
- `There are no more jobs for "{role}".`
- `Your CV also proves other work. Do you want me to look there?`
- `Yes, look`
- `No thanks`
- `Look at the other work my CV proves`
- `Looking for the other work your CV proves...`
- `Still looking for your jobs...`
- Loopback: `I scored the three closest — tell me more and I'll score them better`

Relevant behavior from #228/#235/#245:

- The same empty screen is used for an empty pool and for a deck the user swiped through.
- #228 makes the dead end a consent question when a fallback can be honored.
- A declined fallback leaves a way back on the same screen and does not re-raise the question.
- A fallback search that finds nothing, or a fallback deck that runs out, must not trigger a third search.
- #245 added a separate `searching` state so the screen no longer presents the dead end while the first search is still running.

## Product mapping for the four #239 dead ends

| JobCrush state | Current copy shape | Proposed copy family | Why |
|---|---|---|---|
| 1. Deck exhausted with no question left (#235) | `No matches yet.` + `Try a different job title.` | Heading: `No more jobs right now.` Body when role is available: `No more jobs for "{role}" right now.` Action: `Try a different job title.` | Gives the reason before the action. "Right now" avoids making a permanent claim about the market. |
| 2. Fallback offer declined (#228 decision 9) | Shows `Try a different job title.` and a reopen button. | Heading/body as above. Body: `Try a different job title, or I can look at the other work in your CV.` Button: `Look at the other work in my CV` | Keeps the user's declined answer respected, but the alternate action remains visible. |
| 3. Fallback search finds nothing (#228 decision 8) | Same bare dead end, no third search. | Heading: `No jobs found there right now.` Body: `Try a different job title.` | Avoids naming the fallback family or explaining the failed search. |
| 4. Fallback deck exhausted (#228 decision 12) | Same dead end, no third search. | Heading: `No more jobs there right now.` Body: `Try a different job title.` | Same family as the target deck, but "there" points back to the user-approved alternate direction without naming it. |

Optional #245 wait-state check:

- Keep a wait string separate from empty-result wording.
- If touched in the same implementation, prefer `Still looking for jobs for "{role}"...` when the typed role is available, otherwise keep `Still looking for your jobs...`.

## Proposed string set

These are written to pass the house rules: plain international English, no job-family name, no job-vocabulary label, and no mention of provider/search repair.

```ts
const EMPTY_HEADING = "No jobs found";
const EMPTY_TARGET_NONE = (role: string | null) =>
  role ? `No jobs found for "${role}" right now.` : "No jobs found right now.";
const EMPTY_TARGET_EXHAUSTED = (role: string | null) =>
  role ? `No more jobs for "${role}" right now.` : "No more jobs right now.";
const EMPTY_ACTION = "Try a different job title.";

const FALLBACK_OFFER_INTRO = "Your CV points to other work. Do you want me to look there?";
const FALLBACK_YES = "Yes, look";
const FALLBACK_NO = "No thanks";
const FALLBACK_REOPEN = "Look at the other work in my CV";
const FALLBACK_DECLINED_BODY = "Try a different job title, or I can look at the other work in your CV.";
const FALLBACK_SEARCHING = "Looking at the other work in your CV...";
const FALLBACK_EMPTY = "No jobs found there right now.";
const FALLBACK_EXHAUSTED = "No more jobs there right now.";
```

Suggested screen combinations:

1. Plain target empty/exhausted, no fallback available:
   - `No jobs found`
   - `No more jobs for "{role}" right now.`
   - `Try a different job title.`

2. Fallback available:
   - `No jobs found`
   - `No more jobs for "{role}" right now.`
   - `Your CV points to other work. Do you want me to look there?`
   - Buttons: `Yes, look` / `No thanks`

3. Fallback declined:
   - `No jobs found`
   - `No more jobs for "{role}" right now.`
   - `Try a different job title, or I can look at the other work in your CV.`
   - Button: `Look at the other work in my CV`

4. Fallback accepted but empty:
   - `No jobs found`
   - `No jobs found there right now.`
   - `Try a different job title.`

5. Fallback deck exhausted:
   - `No jobs found`
   - `No more jobs there right now.`
   - `Try a different job title.`

## Limitations and blocked-source notes

- LinkedIn exact zero-result text was captured from the public guest Jobs HTML. Screenshot capture was not retained because Playwright rendered a broadened/signed-out results state instead of the text-only zero-result state observed in the HTML.
- Tinder app UI was not driven as a logged-in user. However, the first-party web app payload at `https://tinder.com/app/recs` exposes the no-new-area strings, and first-party Help docs corroborate the same behavior.
- Indeed, SEEK, and Monster anonymous probes returned HTTP 403 from this environment, so they are not used as evidence.
- Only Reed produced a usable screenshot from this environment. The observations above came from first-party live pages, first-party Help docs, and first-party delivered app HTML/assets on 2026-08-16.
