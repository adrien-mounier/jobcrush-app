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

  validateFactArray(e, card.fit, "fit");
  validateRequirementArray(e, card.dontYet);
  validateFactArray(e, card.askedClosed, "askedClosed");
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

function validateRequirementArray(e, value) {
  if (!e.require(isArray(value), "dontYet must be an array")) return;
  value.forEach((requirement, index) => {
    const at = `dontYet[${index}]`;
    if (!e.require(isObject(requirement), `${at} must be an object`)) return;
    e.require(isString(requirement.id), `${at}.id must be a string`);
    e.require(
      oneOf(requirement.band, REQUIREMENT_BANDS),
      `${at}.band must be essential, standard, or nice-to-have`,
    );
    e.require(isString(requirement.requirement), `${at}.requirement must be a string`);
  });
}
