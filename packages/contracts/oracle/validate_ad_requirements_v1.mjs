import {
  Errors,
  isArray,
  isBool,
  isCliMain,
  isNonEmptyString,
  isNumber,
  isObject,
  oneOf,
  printResult,
  readJsonArg,
  result,
} from "./_lib.mjs";

const BANDS = ["essential", "standard", "nice-to-have"];
const KINDS = ["blocking", "ordinary"];
const SECTIONS = ["summary", "experience", "skills", "education"];
const ELIGIBILITY_DIMENSIONS = ["years-experience", "work-rights", "language", "certification", "degree"];
const COMPARE_OPS = [">=", "<=", "=="];
// #165 / ADR-0003 clause 8(a) — the ladder's rungs, kept identical to the zod port's LanguageLevel.
// Ordered rungs of concrete situations, never a code or an adjective. "not-at-all" is the visitor
// side only (the explicit "I don't speak this"); the contract accepts it here rather than growing a
// second enum, and adReader.ts's clamp is what keeps it off a read requirement.
const LANGUAGE_LEVELS = ["not-at-all", "a-few-words", "gets-by", "meetings", "negotiate", "native"];
// #222 — the two scopes a years bar can test (see the yearsScope check below).
const YEARS_SCOPES = ["family", "total"];

function exactKeys(e, value, keys, at) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) e.require(keys.includes(key), `${at}.${key} is not allowed`);
}

export function validateAdRequirementsV1(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "ad requirements must be an object")) return result(e);
  exactKeys(
    e,
    value,
    ["schemaVersion", "adId", "curated", "language", "familyFit", "requirements"],
    "adRequirements",
  );
  e.require(value.schemaVersion === "1", 'schemaVersion must be "1"');
  e.require(isNonEmptyString(value.adId), "adId must be a non-empty string");
  e.require(value.curated === undefined || isBool(value.curated), "curated must be a boolean");
  e.require(isNonEmptyString(value.language), "language must be a non-empty string");

  const familyFit = value.familyFit;
  if (e.require(isObject(familyFit), "familyFit must be an object")) {
    exactKeys(e, familyFit, ["family", "confidence"], "familyFit");
    e.require(isNonEmptyString(familyFit.family), "familyFit.family must be a non-empty string");
    e.require(
      isNumber(familyFit.confidence) && familyFit.confidence >= 0 && familyFit.confidence <= 1,
      "familyFit.confidence must be a number in [0,1]",
    );
  }

  if (!e.require(isArray(value.requirements) && value.requirements.length > 0, "requirements must be non-empty")) {
    return result(e);
  }

  const ids = new Set();
  value.requirements.forEach((req, index) => {
    const at = `requirements[${index}]`;
    if (!e.require(isObject(req), `${at} must be an object`)) return;
    exactKeys(
      e,
      req,
      [
        "id",
        "band",
        "kind",
        "requirement",
        "cvSection",
        "comparable",
        "eligibilityDimension",
        "eligibilitySubject",
        "eligibilityLevel",
        "yearsScope",
        "sourceSpan",
      ],
      at,
    );
    e.require(isNonEmptyString(req.id), `${at}.id must be a non-empty string`);
    e.require(!ids.has(req.id), `${at}.id must be unique`);
    ids.add(req.id);
    e.require(oneOf(req.band, BANDS), `${at}.band must be essential, standard, or nice-to-have`);
    // kind defaults to "ordinary" when absent — the vague-case pin: representing a requirement never
    // forces a blocking/not-blocking guess.
    e.require(req.kind === undefined || oneOf(req.kind, KINDS), `${at}.kind must be blocking or ordinary`);
    e.require(isNonEmptyString(req.requirement), `${at}.requirement must be a non-empty string`);
    e.require(
      req.cvSection === undefined || oneOf(req.cvSection, SECTIONS),
      `${at}.cvSection is invalid`,
    );
    e.require(isNonEmptyString(req.sourceSpan), `${at}.sourceSpan must be a non-empty string`);
    e.require(
      req.eligibilityDimension === undefined || oneOf(req.eligibilityDimension, ELIGIBILITY_DIMENSIONS),
      `${at}.eligibilityDimension is invalid`,
    );
    // #107 (E5 slice 6, D1) — additive v1 field: the concrete subject a language/certification gate
    // is about ("Mandarin", "PMP"). Optional at the CONTRACT level for every dimension — the reader's
    // own code-level clamp (apps/api/src/adReader.ts's clampBlocking) is what actually requires it on
    // a blocking language/certification requirement; the contract just accepts a non-empty string or
    // nothing.
    e.require(
      req.eligibilitySubject === undefined || isNonEmptyString(req.eligibilitySubject),
      `${at}.eligibilitySubject must be a non-empty string`,
    );
    // #165 — additive v1 field: which rung of the ladder this advert tests. Optional at the CONTRACT
    // level (an advert that names a language without saying what it needs it for is the common case);
    // the reader's own clamp decides when it may ride on a requirement at all.
    e.require(
      req.eligibilityLevel === undefined || oneOf(req.eligibilityLevel, LANGUAGE_LEVELS),
      `${at}.eligibilityLevel is invalid`,
    );
    // #222 — additive v1 field: which scope of the visitor's worked-out years a years bar tests
    // ("family" = years doing this advert's kind of work, the default when absent; "total" = the
    // whole career). Optional at the CONTRACT level; only meaningful beside a years-experience
    // eligibilityDimension.
    e.require(
      req.yearsScope === undefined || oneOf(req.yearsScope, YEARS_SCOPES),
      `${at}.yearsScope is invalid`,
    );
    if (req.comparable !== undefined) {
      const c = req.comparable;
      if (e.require(isObject(c), `${at}.comparable must be an object`)) {
        exactKeys(e, c, ["op", "value"], `${at}.comparable`);
        e.require(oneOf(c.op, COMPARE_OPS), `${at}.comparable.op is invalid`);
        e.require(isNumber(c.value), `${at}.comparable.value must be a number`);
      }
    }
  });
  return result(e);
}

if (isCliMain(import.meta.url)) {
  process.exitCode = printResult("ad-requirements-v1", validateAdRequirementsV1(readJsonArg()));
}
