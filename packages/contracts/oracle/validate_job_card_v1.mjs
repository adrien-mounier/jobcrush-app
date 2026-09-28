import {
  Errors,
  result,
  isArray,
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  isStringOrNull,
  oneOf,
} from "./_lib.mjs";

// #102: unified with AdRequirementV1.band and FloorItem.rankBand — one band vocabulary, no
// hand-written translation at this contract boundary.
const REQUIREMENT_BANDS = ["essential", "standard", "nice-to-have"];

// #117's provenance discriminator. 2026-08-12 (architecture pass candidate 2): the oracle catches up
// to the shape schemaVersion "1" has ALREADY meant on the wire since #117 shipped — same version on
// purpose, the wire did not change today. On "pending"/"unscored" a card claims NO number at all
// (AC5): matchPct/breakdown/bubble null, dontYet empty.
const SCORE_PROVENANCES = ["judged", "pending", "unscored", "estimated"];

export function validateJobCardV1(card) {
  const e = new Errors();
  if (!isObject(card)) {
    e.add("job card must be an object");
    return result(e);
  }
  e.require(card.schemaVersion === "1", 'schemaVersion must be "1"');
  e.require(isNonEmptyString(card.adId), "adId must be a non-empty string");
  for (const field of ["title", "company", "place", "adExcerpt"]) {
    e.require(isString(card[field]), `${field} must be a string`);
  }
  for (const field of ["salary", "pattern"]) {
    e.require(isStringOrNull(card[field]), `${field} must be a string or null`);
  }
  e.require(
    oneOf(card.scored, SCORE_PROVENANCES),
    "scored must be judged, pending, unscored, or estimated",
  );
  if (card.scored === "pending" || card.scored === "unscored") {
    e.require(card.matchPct === null, "matchPct must be null on a pending/unscored card");
    e.require(card.breakdown === null, "breakdown must be null on a pending/unscored card");
    e.require(card.bubble === null, "bubble must be null on a pending/unscored card");
    e.require(
      isArray(card.dontYet) && card.dontYet.length === 0,
      "dontYet must be empty on a pending/unscored card",
    );
  } else {
    e.require(
      isNumber(card.matchPct) && card.matchPct >= 0 && card.matchPct <= 100,
      "matchPct must be a number in [0,100]",
    );
    e.require(isObject(card.breakdown), "breakdown must be an object");
    for (const band of ["essential", "desirable"]) {
      const value = card.breakdown?.[band];
      e.require(isObject(value), `breakdown.${band} must be an object`);
      e.require(
        Number.isInteger(value?.met) && value.met >= 0,
        `breakdown.${band}.met must be a non-negative integer`,
      );
      e.require(
        Number.isInteger(value?.total) && value.total >= 0,
        `breakdown.${band}.total must be a non-negative integer`,
      );
      e.require(value?.met <= value?.total, `breakdown.${band}.met must not exceed total`);
    }
    e.require(isObject(card.bubble), "bubble must be an object");
    e.require(isString(card.bubble?.hit), "bubble.hit must be a string");
    e.require(isString(card.bubble?.open), "bubble.open must be a string");
    validateRequirementArray(e, card.dontYet, "dontYet");
  }

  validateFactArray(e, card.fit, "fit");
  validateFactArray(e, card.askedClosed, "askedClosed");
  // #162 AC6 — optional and additive: absent means "nothing went untested on this card", which is
  // what every pre-#162 payload meant by saying nothing. Present, it must be a requirement array.
  if (card.notTested !== undefined) validateRequirementArray(e, card.notTested, "notTested");
  // #305 (#294 c3) — the brought job's ageing line, optional and additive for the same reason
  // notTested is: absent means "this card has nothing to say about its own age", which is what every
  // pre-#305 payload meant by saying nothing. Present, it must be a non-empty sentence — an empty
  // string would render as a blank notice, which is worse than no notice at all.
  if (card.ageing !== undefined) {
    e.require(isNonEmptyString(card.ageing), "ageing must be a non-empty string");
  }
  // #306 (#300 change 1) — where to apply, optional and additive like the two above. http(s) only:
  // the value is rendered as an anchor and emailed as one, so the scheme is checked at the contract
  // as well as at both write boundaries rather than trusted to the renderer. Case-insensitive because
  // a URL scheme is (RFC 3986 §3.1) and because both write boundaries already are: a contract stricter
  // than the product that feeds it makes the product store cards its own spec rejects (QA gate D1).
  if (card.applicationUrl !== undefined) {
    e.require(
      isNonEmptyString(card.applicationUrl) && /^https?:\/\//i.test(card.applicationUrl),
      "applicationUrl must be an http(s) URL",
    );
  }
  return result(e);
}

function validateFactArray(e, value, field) {
  if (!e.require(isArray(value), `${field} must be an array`)) return;
  value.forEach((fact, index) => {
    const at = `${field}[${index}]`;
    if (!e.require(isObject(fact), `${at} must be an object`)) return;
    e.require(isString(fact.id), `${at}.id must be a string`);
    e.require(isString(fact.text), `${at}.text must be a string`);
  });
}

function validateRequirementArray(e, value, field) {
  if (!e.require(isArray(value), `${field} must be an array`)) return;
  value.forEach((requirement, index) => {
    const at = `${field}[${index}]`;
    if (!e.require(isObject(requirement), `${at} must be an object`)) return;
    e.require(isString(requirement.id), `${at}.id must be a string`);
    e.require(
      oneOf(requirement.band, REQUIREMENT_BANDS),
      `${at}.band must be essential, standard, or nice-to-have`,
    );
    e.require(isString(requirement.requirement), `${at}.requirement must be a string`);
  });
}
