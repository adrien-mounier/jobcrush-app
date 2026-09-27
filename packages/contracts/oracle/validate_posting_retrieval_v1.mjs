// validate_posting_retrieval_v1.mjs — the spec for the live-posting retrieval contract (#99, §2 of
// docs/research/live-posting-retrieval-contract.md). Four shapes, four exported validators. The zod
// port (packages/contracts/src/postingRetrieval.ts) must agree with every function here on every
// input — golden-tested in packages/contracts/test/golden.test.ts. This file is authoritative on any
// future disagreement.
import { createHash } from "node:crypto";
import {
  Errors,
  isArray,
  isBool,
  isCliMain,
  isNonEmptyString,
  isNonEmptyStringOrNull,
  isNumber,
  isObject,
  isString,
  isStringArray,
  oneOf,
  printResult,
  readJsonArg,
  result,
} from "./_lib.mjs";

// canonicalKey derivation, reimplemented independently from postingRetrieval.ts's normalize/
// canonicalKeyOf — that independence is what makes this file an oracle rather than a copy.
// `|` is stripped too — it's the triple's own field delimiter, so leaving it in field content
// could forge a fake field boundary and collide two genuinely different jobs onto one key.
function normalize(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[,.()|]/g, "")
    .replace(/\s+/g, " ");
}

function canonicalKeyOf(company, location, title) {
  const input = `${normalize(company)}|${normalize(location)}|${normalize(title)}`;
  return createHash("sha256").update(input).digest("hex");
}

const COST_MODEL_KINDS = ["perThousandPostings", "flatMonthlyTier", "operatorHours"];
const INVALID_REQUEST_CODES = [
  "missing_intent",
  "family_not_published",
  "floor_not_covered",
  "search_area_not_covered",
];
const OUTCOMES = [
  "relevant_postings",
  "empty_pool",
  "provider_unavailable",
  "stale_data",
  "invalid_request",
];

function exactKeys(e, value, keys, at) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) e.require(keys.includes(key), `${at}.${key} is not allowed`);
}

// `nullable`: true for the single-attribution call sites (ProviderPostingRecordV1.attribution,
// PostingProviderPolicyV1.attributionTemplate), false for each entry of PostingV1's attribution
// array (an array element is never itself null). One shape check either way, so a future field
// added to attribution gets enforced everywhere it appears, not just on records.
function validateAttribution(e, value, at, nullable = true) {
  if (nullable && value === null) return;
  if (!e.require(isObject(value), `${at} must be an object${nullable ? " or null" : ""}`)) return;
  exactKeys(e, value, ["label", "url"], at);
  e.require(isNonEmptyString(value.label), `${at}.label must be a non-empty string`);
  e.require(isNonEmptyString(value.url), `${at}.url must be a non-empty string`);
}

function validateAttributionArray(e, value, at) {
  if (!e.require(isArray(value), `${at} must be an array`)) return;
  value.forEach((entry, index) => validateAttribution(e, entry, `${at}[${index}]`, false));
}

function validateSources(e, value, at) {
  if (!e.require(isArray(value) && value.length >= 1, `${at} must be a non-empty array`)) return;
  value.forEach((source, index) => {
    const sourceAt = `${at}[${index}]`;
    if (!e.require(isObject(source), `${sourceAt} must be an object`)) return;
    exactKeys(e, source, ["providerId", "providerPostingId"], sourceAt);
    e.require(isNonEmptyString(source.providerId), `${sourceAt}.providerId must be a non-empty string`);
    e.require(
      isNonEmptyString(source.providerPostingId),
      `${sourceAt}.providerPostingId must be a non-empty string`,
    );
  });
}

export function validateProviderPostingRecordV1(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "posting record must be an object")) return result(e);
  exactKeys(
    e,
    value,
    [
      "schemaVersion",
      "providerId",
      "providerPostingId",
      "title",
      "company",
      "location",
      "sourceUrl",
      "applicationUrl",
      "excerpt",
      "postedAt",
      "capturedAt",
      "verifiedLiveAt",
      "expiresAt",
      "attribution",
      "skills",
      "language",
    ],
    "record",
  );
  // #302 bumped 3->4: `verifiedLiveAt` became nullable and `applicationUrl` was added.
  e.require(value.schemaVersion === "4", 'schemaVersion must be "4"');
  e.require(isNonEmptyString(value.providerId), "providerId must be a non-empty string");
  e.require(isNonEmptyString(value.providerPostingId), "providerPostingId must be a non-empty string");
  e.require(isNonEmptyString(value.title), "title must be a non-empty string");
  e.require(isNonEmptyString(value.company), "company must be a non-empty string");
  e.require(isNonEmptyString(value.location), "location must be a non-empty string");
  e.require(isNonEmptyString(value.sourceUrl), "sourceUrl must be a non-empty string");
  // #302 (#291, #293): where to APPLY, when this source knows it — null when it does not. Never
  // absent: the key is required, the value may be null, same as postedAt/expiresAt.
  e.require(
    isNonEmptyStringOrNull(value.applicationUrl),
    "applicationUrl must be a non-empty string or null",
  );
  e.require(isString(value.excerpt), "excerpt must be a string");
  e.require(isNonEmptyStringOrNull(value.postedAt), "postedAt must be a non-empty string or null");
  e.require(isNonEmptyString(value.capturedAt), "capturedAt must be a non-empty string");
  // #302 (#294 clause 5): null when nobody ever confirmed this record live and nobody ever will —
  // a source that fetches nothing has no liveness signal, and a fetch is what stamps this field.
  // An EMPTY STRING is still rejected: absence is null, never a blank date.
  e.require(
    isNonEmptyStringOrNull(value.verifiedLiveAt),
    "verifiedLiveAt must be a non-empty string or null",
  );
  e.require(isNonEmptyStringOrNull(value.expiresAt), "expiresAt must be a non-empty string or null");
  validateAttribution(e, value.attribution, "attribution");
  e.require(isStringArray(value.skills), "skills must be a string[]");
  e.require(isNonEmptyString(value.language), "language must be a non-empty string");
  return result(e);
}

export function validatePostingV1(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "posting must be an object")) return result(e);
  exactKeys(
    e,
    value,
    [
      "schemaVersion",
      "id",
      "canonicalKey",
      "title",
      "company",
      "location",
      "sourceUrl",
      "applicationUrl",
      "excerpt",
      "postedAt",
      "capturedAt",
      "verifiedLiveAt",
      "expiresAt",
      "attribution",
      "sources",
      "skills",
      "language",
    ],
    "posting",
  );
  // #302 bumped 4->5 in step with the provider record's own 3->4 — same two changes.
  e.require(value.schemaVersion === "5", 'schemaVersion must be "5"');
  e.require(isNonEmptyString(value.id), "id must be a non-empty string");
  e.require(isNonEmptyString(value.canonicalKey), "canonicalKey must be a non-empty string");
  if (isNonEmptyString(value.id) && isNonEmptyString(value.canonicalKey)) {
    e.require(
      value.id === `posting:${value.canonicalKey}`,
      'id must equal "posting:" + canonicalKey',
    );
  }
  e.require(isNonEmptyString(value.title), "title must be a non-empty string");
  e.require(isNonEmptyString(value.company), "company must be a non-empty string");
  e.require(isNonEmptyString(value.location), "location must be a non-empty string");
  // canonicalKey isn't just typed as a string — it must actually BE the derived hash. Sound because
  // every contributing record's company/location/title normalizes to the same triple (that's what
  // made them merge in the first place), so the winner's own fields recompute it correctly.
  if (
    isNonEmptyString(value.canonicalKey) &&
    isNonEmptyString(value.company) &&
    isNonEmptyString(value.location) &&
    isNonEmptyString(value.title)
  ) {
    e.require(
      value.canonicalKey === canonicalKeyOf(value.company, value.location, value.title),
      'canonicalKey must equal sha256(normalize(company) + "|" + normalize(location) + "|" + normalize(title))',
    );
  }
  e.require(isNonEmptyString(value.sourceUrl), "sourceUrl must be a non-empty string");
  // #302: the highest-authority contributing record that HAS an application link, or null when no
  // contributing record had one — NOT plain winner-take-all, which would discard a pasted advert's
  // link the moment it merged onto a fetched record that has none.
  e.require(
    isNonEmptyStringOrNull(value.applicationUrl),
    "applicationUrl must be a non-empty string or null",
  );
  e.require(isString(value.excerpt), "excerpt must be a string");
  e.require(isNonEmptyStringOrNull(value.postedAt), "postedAt must be a non-empty string or null");
  e.require(isNonEmptyString(value.capturedAt), "capturedAt must be a non-empty string");
  // #302: null only when NO contributing record was ever confirmed live.
  e.require(
    isNonEmptyStringOrNull(value.verifiedLiveAt),
    "verifiedLiveAt must be a non-empty string or null",
  );
  e.require(isNonEmptyStringOrNull(value.expiresAt), "expiresAt must be a non-empty string or null");
  validateAttributionArray(e, value.attribution, "attribution");
  validateSources(e, value.sources, "sources");
  e.require(isStringArray(value.skills), "skills must be a string[]");
  e.require(isNonEmptyString(value.language), "language must be a non-empty string");
  return result(e);
}

function validateCostModel(e, value, at) {
  if (!e.require(isObject(value), `${at} must be an object`)) return;
  e.require(oneOf(value.kind, COST_MODEL_KINDS), `${at}.kind is invalid`);
  if (value.kind === "perThousandPostings") {
    exactKeys(e, value, ["kind", "amountUsd"], at);
    e.require(isNumber(value.amountUsd), `${at}.amountUsd must be a number`);
  } else if (value.kind === "flatMonthlyTier") {
    exactKeys(e, value, ["kind", "amountUsd", "includedUnits"], at);
    e.require(isNumber(value.amountUsd), `${at}.amountUsd must be a number`);
    e.require(isNumber(value.includedUnits), `${at}.includedUnits must be a number`);
  } else if (value.kind === "operatorHours") {
    exactKeys(e, value, ["kind"], at);
  }
}

function validateRateLimit(e, value, at) {
  if (!e.require(isObject(value), `${at} must be an object`)) return;
  exactKeys(e, value, ["perSecond", "perMinute", "perDay", "perMonth"], at);
  for (const field of ["perSecond", "perMinute", "perDay", "perMonth"]) {
    const v = value[field];
    e.require(v === null || isNumber(v), `${at}.${field} must be a number or null`);
  }
}

function validateRetryPolicy(e, value, at) {
  if (!e.require(isObject(value), `${at} must be an object`)) return;
  exactKeys(e, value, ["maxAttempts", "backoffMs"], at);
  e.require(
    isNumber(value.maxAttempts) && Number.isInteger(value.maxAttempts) &&
      value.maxAttempts >= 1 && value.maxAttempts <= 2,
    `${at}.maxAttempts must be an integer, 1 or 2`,
  );
  e.require(
    isNumber(value.backoffMs) && value.backoffMs >= 0,
    `${at}.backoffMs must be a non-negative number`,
  );
}

export function validatePostingProviderPolicyV1(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "provider policy must be an object")) return result(e);
  exactKeys(
    e,
    value,
    [
      "schemaVersion",
      "providerId",
      "regionsServed",
      "authorityRank",
      "permitsStorage",
      "permitsMatching",
      "attributionRequired",
      "attributionTemplate",
      "rateLimit",
      "retry",
      "timeoutMs",
      "costModel",
      "freshnessTtlHours",
      "livenessCheckable",
    ],
    "policy",
  );
  // #302 bumped 2->3: added `livenessCheckable`.
  e.require(value.schemaVersion === "3", 'schemaVersion must be "3"');
  e.require(isNonEmptyString(value.providerId), "providerId must be a non-empty string");
  e.require(
    isArray(value.regionsServed) &&
      value.regionsServed.length >= 1 &&
      value.regionsServed.every(isNonEmptyString),
    "regionsServed must be a non-empty string[]",
  );
  e.require(isNumber(value.authorityRank), "authorityRank must be a number");
  // permitsStorage/permitsMatching default to false when absent — silence in a provider's ToS is
  // never read as permission.
  const permitsStorage = value.permitsStorage === undefined ? false : value.permitsStorage;
  const permitsMatching = value.permitsMatching === undefined ? false : value.permitsMatching;
  e.require(isBool(permitsStorage), "permitsStorage must be a boolean");
  e.require(isBool(permitsMatching), "permitsMatching must be a boolean");
  e.require(isBool(value.attributionRequired), "attributionRequired must be a boolean");
  validateAttribution(e, value.attributionTemplate, "attributionTemplate");
  validateRateLimit(e, value.rateLimit, "rateLimit");
  validateRetryPolicy(e, value.retry, "retry");
  e.require(
    isNumber(value.timeoutMs) && value.timeoutMs > 0,
    "timeoutMs must be a positive number",
  );
  validateCostModel(e, value.costModel, "costModel");
  e.require(isNumber(value.freshnessTtlHours), "freshnessTtlHours must be a number");
  // #302 (#294 clause 6): can a posting from this source ever be re-confirmed live? Required, with
  // no default — unlike permitsStorage/permitsMatching above, silence here is an operator error,
  // not a fail-closed permission question.
  e.require(isBool(value.livenessCheckable), "livenessCheckable must be a boolean");
  return result(e);
}

function validateCoverage(e, value, at) {
  if (!e.require(isObject(value), `${at} must be an object`)) return;
  exactKeys(e, value, ["providersQueried", "providersUnavailable", "complete"], at);
  e.require(isStringArray(value.providersQueried), `${at}.providersQueried must be a string[]`);
  e.require(
    isStringArray(value.providersUnavailable),
    `${at}.providersUnavailable must be a string[]`,
  );
  e.require(isBool(value.complete), `${at}.complete must be a boolean`);
  if (isStringArray(value.providersUnavailable) && isBool(value.complete)) {
    e.require(
      value.complete === (value.providersUnavailable.length === 0),
      `${at}.complete must equal (providersUnavailable.length === 0)`,
    );
  }
}

export function validatePostingRetrievalResultV1(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "retrieval result must be an object")) return result(e);
  // #302 bumped 4->5 in step with PostingV1's own 4->5, the same rule #133 followed.
  e.require(value.schemaVersion === "5", 'schemaVersion must be "5"');
  e.require(oneOf(value.outcome, OUTCOMES), "outcome is invalid");

  if (value.outcome === "relevant_postings") {
    exactKeys(e, value, ["schemaVersion", "outcome", "postings", "coverage", "retrievedAt"], "result");
    if (e.require(isArray(value.postings) && value.postings.length >= 1, "postings must be non-empty")) {
      value.postings.forEach((posting, index) => {
        const sub = validatePostingV1(posting);
        for (const msg of sub.errors) e.add(`postings[${index}].${msg}`);
      });
    }
    validateCoverage(e, value.coverage, "coverage");
    e.require(isNonEmptyString(value.retrievedAt), "retrievedAt must be a non-empty string");
  } else if (value.outcome === "empty_pool") {
    exactKeys(e, value, ["schemaVersion", "outcome", "coverage", "retrievedAt"], "result");
    validateCoverage(e, value.coverage, "coverage");
    // empty_pool is only constructible with coverage.complete === true — an empty result while a
    // provider was unavailable is not an empty pool, it's provider_unavailable (§2.7 rule 4/5).
    if (isObject(value.coverage)) {
      e.require(value.coverage.complete === true, "empty_pool requires coverage.complete === true");
      // An empty pool means every eligible provider was asked and had nothing — so at least one
      // must have been asked. This lives ONLY on this arm: provider_unavailable legitimately has
      // zero queried and many unavailable.
      e.require(
        isArray(value.coverage.providersQueried) && value.coverage.providersQueried.length >= 1,
        "empty_pool requires at least one provider to have been queried",
      );
    }
    e.require(isNonEmptyString(value.retrievedAt), "retrievedAt must be a non-empty string");
  } else if (value.outcome === "provider_unavailable") {
    exactKeys(
      e,
      value,
      ["schemaVersion", "outcome", "coverage", "reason", "retryable"],
      "result",
    );
    validateCoverage(e, value.coverage, "coverage");
    e.require(isNonEmptyString(value.reason), "reason must be a non-empty string");
    e.require(isBool(value.retryable), "retryable must be a boolean");
  } else if (value.outcome === "stale_data") {
    exactKeys(e, value, ["schemaVersion", "outcome", "lastKnownFreshAt", "retrievedAt"], "result");
    e.require(isNonEmptyString(value.lastKnownFreshAt), "lastKnownFreshAt must be a non-empty string");
    e.require(isNonEmptyString(value.retrievedAt), "retrievedAt must be a non-empty string");
  } else if (value.outcome === "invalid_request") {
    exactKeys(e, value, ["schemaVersion", "outcome", "code"], "result");
    e.require(
      oneOf(value.code, INVALID_REQUEST_CODES),
      "code must be missing_intent, family_not_published, floor_not_covered, or search_area_not_covered",
    );
  }
  return result(e);
}

if (isCliMain(import.meta.url)) {
  process.exitCode = printResult(
    "posting-retrieval-v1",
    validatePostingRetrievalResultV1(readJsonArg()),
  );
}
