import { Errors, isArray, isCliMain, isObject, isString, oneOf, printResult, readJsonArg, result } from "./_lib.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCHEMA_VERSION = "2";
const CONFIDENCE = ["certain", "likely", "possible"];

function exactKeys(e, value, keys, at) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    e.require(keys.includes(key), `${at}.${key} is not allowed`);
  }
}

function validateReference(e, value, at) {
  if (!isObject(value)) {
    e.add(`${at} must be an object`);
    return;
  }
  exactKeys(e, value, ["industryId", "version", "confidence"], at);
  e.require(isString(value.industryId) && SLUG.test(value.industryId), `${at}.industryId must be a slug`);
  e.require(Number.isInteger(value.version) && value.version > 0, `${at}.version must be a positive integer`);
  // v2 (#282): confidence rides on EACH industry, not on the placement — the employer's own
  // industry and the industry the work was served into are known to different strengths.
  e.require(oneOf(value.confidence, CONFIDENCE), `${at}.confidence must be one of ${CONFIDENCE.join(", ")}`);
}

export function validateIndustryPlacement(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "placement must be an object")) return result(e);
  e.require(value.schemaVersion === SCHEMA_VERSION, `schemaVersion must be "${SCHEMA_VERSION}"`);
  // Two outcomes and no third — nobody is asked which industry their employer was in.
  e.require(oneOf(value.outcome, ["confirmed", "unmapped"]), "outcome must be confirmed or unmapped");

  if (value.outcome === "confirmed") {
    exactKeys(e, value, ["schemaVersion", "outcome", "industries"], "placement");
    // No upper bound on the count — see the zod port's own note: a cap would hide the signal.
    if (e.require(isArray(value.industries) && value.industries.length >= 1, "industries must contain at least one industry")) {
      value.industries.forEach((industry, index) => validateReference(e, industry, `industries[${index}]`));
      const refs = value.industries.filter(isObject).map((industry) => `${industry.industryId}@${industry.version}`);
      e.require(new Set(refs).size === refs.length, "a placement must reference distinct industry versions");
    }
  } else if (value.outcome === "unmapped") {
    exactKeys(e, value, ["schemaVersion", "outcome"], "placement");
  }
  return result(e);
}

if (isCliMain(import.meta.url)) {
  process.exitCode = printResult("industry-placement", validateIndustryPlacement(readJsonArg()));
}
