import { Errors, isArray, isCliMain, isObject, isString, oneOf, printResult, readJsonArg, result } from "./_lib.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function exactKeys(e, value, keys, at) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    e.require(keys.includes(key), `${at}.${key} is not allowed`);
  }
}

function validateReference(e, value, at, withLabel = false) {
  if (!isObject(value)) {
    e.add(`${at} must be an object`);
    return;
  }
  exactKeys(e, value, withLabel ? ["familyId", "version", "label"] : ["familyId", "version"], at);
  e.require(isString(value.familyId) && SLUG.test(value.familyId), `${at}.familyId must be a slug`);
  e.require(Number.isInteger(value.version) && value.version > 0, `${at}.version must be a positive integer`);
  if (withLabel) e.require(isString(value.label) && value.label.length > 0, `${at}.label must be non-empty`);
}

export function validateFamilyPlacement(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "placement must be an object")) return result(e);
  e.require(value.schemaVersion === "1", 'schemaVersion must be "1"');
  e.require(
    oneOf(value.outcome, ["confirmed", "needs_clarification", "unmapped"]),
    "outcome must be confirmed, needs_clarification, or unmapped",
  );

  if (value.outcome === "confirmed") {
    exactKeys(e, value, ["schemaVersion", "outcome", "family"], "placement");
    validateReference(e, value.family, "family");
  } else if (value.outcome === "needs_clarification") {
    exactKeys(e, value, ["schemaVersion", "outcome", "choices"], "placement");
    if (e.require(isArray(value.choices) && value.choices.length >= 2, "choices must contain at least two families")) {
      value.choices.forEach((choice, index) => validateReference(e, choice, `choices[${index}]`, true));
      const refs = value.choices
        .filter(isObject)
        .map((choice) => `${choice.familyId}@${choice.version}`);
      e.require(new Set(refs).size === refs.length, "choices must reference distinct family versions");
    }
  } else if (value.outcome === "unmapped") {
    exactKeys(e, value, ["schemaVersion", "outcome"], "placement");
  }
  return result(e);
}

if (isCliMain(import.meta.url)) {
  process.exitCode = printResult("family-placement", validateFamilyPlacement(readJsonArg()));
}
