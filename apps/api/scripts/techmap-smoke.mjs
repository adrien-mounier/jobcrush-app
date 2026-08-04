// Staging-only smoke test for the real Techmap (jobdatafeeds.com Jobs API v2.6, via RapidAPI)
// provider. NOT wired into `pnpm test` — CI has no funded key and this spends real quota.
//
// Two live calls, both cheap against a 1000/month quota:
//   1. Through the REAL TechmapPostingProvider.fetch() — proves the client itself works end to end:
//      the host/path (§6's lowercase-path landmine), header names, and 429/timeout/retry handling
//      all run through the actual production code path (#100 review S1 — an earlier version hand-
//      rolled its own fetch here and would have missed exactly these).
//   2. A raw fetch, using the SAME exported TECHMAP_HOST/TECHMAP_PATH constants (never re-typed), to
//      keep the untouched jsonLD sub-objects available for a provenance check the client's own
//      already-normalized return value can't give us.
//
// #100 review D2: non-emptiness alone doesn't prove a field-path assumption, because
// providerPostingId/sourceUrl/company/location all have a FALLBACK to a top-level field — a wrong
// jsonLD shape assumption silently falls through to the fallback and still "passes" a bare
// non-empty check. So call 2's items are each fed into the real normalizeTechmapItem AND
// independently re-derived straight off jsonLD with the SAME extraction helpers the normalizer
// itself uses; a mismatch (or a null re-derivation despite a non-empty record field) means the
// fallback fired silently.
//
// #100 review S2/S3: sampled across SEVERAL items (not just the first), and split into two classes —
// fields with a jsonLD path (providerPostingId/sourceUrl/company/location/excerpt) hard-fail on ANY
// sampled item, because those must always resolve to a genuine value; skills/applicantLocationRequirements/
// expiresAt have no fallback and are perfectly ordinary to be genuinely absent on any ONE advert, so
// those only fail if EMPTY ACROSS EVERY sampled item — otherwise they're reported as a ratio.
//
// Requires the API package BUILT first — this imports the compiled driver directly, the same way
// this repo's own manual-run instructions already assume a build (root CLAUDE.md: "node
// apps/api/dist/main.js"), not a live TS toolchain:
//   pnpm --filter @jobcrush/api build
//   TECHMAP_RAPIDAPI_KEY=<key> pnpm --filter @jobcrush/api techmap-smoke
import {
  asNonEmptyString,
  extractIdentifier,
  extractLocation,
  extractOrganizationName,
  normalizeTechmapItem,
  TechmapPostingProvider,
  TECHMAP_HOST,
  TECHMAP_PATH,
} from '../dist/postingProvider.js';

const apiKey = process.env.TECHMAP_RAPIDAPI_KEY;

if (!apiKey) {
  // eslint-disable-next-line no-console
  console.error('SKIP: TECHMAP_RAPIDAPI_KEY not set — nothing to smoke-test against.');
  process.exit(0);
}

// Mirrors the techmap row in data/posting-providers.json as a standalone literal (not an import of
// the JSON) — this script has no dependency on the registry file's exact shape staying aligned.
const policy = {
  schemaVersion: '2',
  providerId: 'techmap',
  regionsServed: ['HK'],
  authorityRank: 1,
  permitsStorage: true,
  permitsMatching: true,
  attributionRequired: false,
  attributionTemplate: null,
  rateLimit: { perSecond: 0.4, perMinute: 24, perDay: null, perMonth: 1000 },
  retry: { maxAttempts: 1, backoffMs: 0 },
  timeoutMs: 10000,
  costModel: { kind: 'perThousandPostings', amountUsd: 1 },
  freshnessTtlHours: 24,
};

const SAMPLE_SIZE = 5;
const REQUEST = { regionCode: 'HK', queryKeywords: ['project', 'manager'], page: 0, size: SAMPLE_SIZE };

async function main() {
  // Call 1: through the REAL client — proves the path/headers/retry/timeout handling itself works.
  const provider = new TechmapPostingProvider({ apiKey, policy });
  const clientResult = await provider.fetch(REQUEST);
  if (!clientResult.ok) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: TechmapPostingProvider.fetch() itself failed: ${clientResult.reason} (retryable=${clientResult.retryable})`);
    process.exit(1);
  }
  if (clientResult.records.length === 0) {
    // eslint-disable-next-line no-console
    console.error('FAIL: the client returned zero records — nothing to sample.');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`client OK: TechmapPostingProvider.fetch() returned ${clientResult.records.length} record(s)`);

  // Call 2: raw, same query, built from the SAME exported host/path constants the client uses —
  // keeps the raw jsonLD sub-objects available for the provenance check below.
  const url = new URL(`https://${TECHMAP_HOST}${TECHMAP_PATH}`);
  url.searchParams.set('countryCode', 'hk');
  url.searchParams.set('page', '0');
  url.searchParams.set('size', String(SAMPLE_SIZE));
  url.searchParams.set('title', 'project manager');
  const res = await fetch(url.toString(), {
    headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': TECHMAP_HOST },
  });
  if (!res.ok) {
    // Never echo request config (the one place the key appears, in a header) into the output.
    // eslint-disable-next-line no-console
    console.error(`FAIL: raw provenance call rejected (${res.status} ${res.statusText})`);
    process.exit(1);
  }
  const body = await res.json();
  const items = Array.isArray(body?.result) ? body.result : [];
  if (items.length === 0) {
    // eslint-disable-next-line no-console
    console.error('FAIL: raw call returned zero items — nothing to check provenance against.');
    process.exit(1);
  }

  const hardFailures = [];
  const optionalCounts = { skills: 0, applicantLocationRequirements: 0, expiresAt: 0 };

  items.forEach((rawItem, i) => {
    const jsonLD = rawItem && typeof rawItem === 'object' ? rawItem.jsonLD ?? {} : {};
    const record = normalizeTechmapItem(rawItem, new Date().toISOString(), policy);
    if (!record) {
      hardFailures.push(`item[${i}]: normalizeTechmapItem returned null — a required field is genuinely missing`);
      return;
    }

    // title's PRIMARY source is the top-level field (§6 confirmed this exists).
    if (record.title !== rawItem.title) {
      hardFailures.push(`item[${i}] title: expected the top-level field ("${rawItem.title}"), record has "${record.title}"`);
    }

    // providerPostingId / sourceUrl / company / location: jsonLD is checked FIRST by the normalizer.
    // Re-derive "what jsonLD alone says" with the SAME helpers — a null here despite a non-empty
    // record field means the top-level fallback silently fired.
    const idFromJsonLD = extractIdentifier(jsonLD.identifier);
    if (idFromJsonLD === null) hardFailures.push(`item[${i}] providerPostingId: jsonLD.identifier did not yield a value — the fallback fired silently`);
    else if (idFromJsonLD !== record.providerPostingId) hardFailures.push(`item[${i}] providerPostingId: jsonLD says "${idFromJsonLD}", record says "${record.providerPostingId}"`);

    const urlFromJsonLD = asNonEmptyString(jsonLD.url);
    if (urlFromJsonLD === null) hardFailures.push(`item[${i}] sourceUrl: jsonLD.url is absent — the fallback fired silently`);
    else if (urlFromJsonLD !== record.sourceUrl) hardFailures.push(`item[${i}] sourceUrl: jsonLD says "${urlFromJsonLD}", record says "${record.sourceUrl}"`);

    const companyFromJsonLD = extractOrganizationName(jsonLD.hiringOrganization);
    if (companyFromJsonLD === null) hardFailures.push(`item[${i}] company: jsonLD.hiringOrganization did not yield a name — the fallback fired silently`);
    else if (companyFromJsonLD !== record.company) hardFailures.push(`item[${i}] company: jsonLD says "${companyFromJsonLD}", record says "${record.company}"`);

    const locationFromJsonLD = extractLocation(jsonLD.jobLocation);
    if (locationFromJsonLD === null) hardFailures.push(`item[${i}] location: jsonLD.jobLocation did not yield a value — the fallback fired silently`);
    else if (locationFromJsonLD !== record.location) hardFailures.push(`item[${i}] location: jsonLD says "${locationFromJsonLD}", record says "${record.location}"`);

    // excerpt has NO fallback (jsonLD.description is the only source) — this should always hold if
    // the item normalized at all; a mismatch would mean the normalizer itself changed underneath us.
    const excerptFromJsonLD = asNonEmptyString(jsonLD.description);
    if (excerptFromJsonLD === null || excerptFromJsonLD !== record.excerpt) {
      hardFailures.push(`item[${i}] excerpt: does not match jsonLD.description`);
    }

    // No top-level fallback exists for these three, and it's ORDINARY for one advert to omit any of
    // them — track how many of the sampled items carry each, don't fail per-item.
    if (record.skills.length > 0) optionalCounts.skills++;
    if (record.applicantLocationRequirements.length > 0) optionalCounts.applicantLocationRequirements++;
    if (record.expiresAt) optionalCounts.expiresAt++;
  });

  // Optional fields only fail if EMPTY ACROSS EVERY sampled item — that's the "shape drifted" signal,
  // distinct from "this particular advert doesn't list skills".
  for (const [field, count] of Object.entries(optionalCounts)) {
    if (count === 0) hardFailures.push(`${field}: empty across all ${items.length} sampled items — likely a response shape change, not ordinary absence`);
  }

  if (hardFailures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: provenance checks failed across ${items.length} sampled items:`);
    for (const f of hardFailures) console.error(`  - ${f}`); // eslint-disable-line no-console
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`PASS: ${items.length} sampled items — required fields all traced to their real jsonLD/top-level source`);
  // eslint-disable-next-line no-console
  console.log(`  skills present on ${optionalCounts.skills}/${items.length} items`);
  // eslint-disable-next-line no-console
  console.log(`  applicantLocationRequirements present on ${optionalCounts.applicantLocationRequirements}/${items.length} items`);
  // eslint-disable-next-line no-console
  console.log(`  expiresAt present on ${optionalCounts.expiresAt}/${items.length} items`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
