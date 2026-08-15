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
  exactKeys(e, value, ["familyId", "version"], at);
  e.require(isString(value.familyId) && SLUG.test(value.familyId), `${at}.familyId must be a slug`);
  e.require(Number.isInteger(value.version) && value.version > 0, `${at}.version must be a positive integer`);
}

export function validateFamilyPlacement(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "placement must be an object")) return result(e);
  e.require(value.schemaVersion === SCHEMA_VERSION, `schemaVersion must be "${SCHEMA_VERSION}"`);
  e.require(oneOf(value.outcome, ["confirmed", "unmapped"]), "outcome must be confirmed or unmapped");

  if (value.outcome === "confirmed") {
    exactKeys(e, value, ["schemaVersion", "outcome", "families", "confidence"], "placement");
    // No upper bound on the count — see the zod port's own note: a cap would hide the signal.
    if (e.require(isArray(value.families) && value.families.length >= 1, "families must contain at least one family")) {
      value.families.forEach((family, index) => validateReference(e, family, `families[${index}]`));
      const refs = value.families.filter(isObject).map((family) => `${family.familyId}@${family.version}`);
      e.require(new Set(refs).size === refs.length, "a placement must reference distinct family versions");
    }
    e.require(oneOf(value.confidence, CONFIDENCE), `confidence must be one of ${CONFIDENCE.join(", ")}`);
  } else if (value.outcome === "unmapped") {
    exactKeys(e, value, ["schemaVersion", "outcome"], "placement");
  }
  return result(e);
}

if (isCliMain(import.meta.url)) {
  process.exitCode = printResult("family-placement", validateFamilyPlacement(readJsonArg()));
}
