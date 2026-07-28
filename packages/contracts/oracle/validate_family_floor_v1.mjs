import { Errors, isArray, isCliMain, isObject, isString, oneOf, printResult, readJsonArg, result } from "./_lib.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTIONS = ["summary", "experience", "skills", "education"];

function exactKeys(e, value, keys, at) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) e.require(keys.includes(key), `${at}.${key} is not allowed`);
}

export function validateFamilyFloorV1(value) {
  const e = new Errors();
  if (!e.require(isObject(value), "floor must be an object")) return result(e);
  exactKeys(e, value, ["schemaVersion", "familyId", "version", "source", "productionRewardEligible", "essentialItems"], "floor");
  e.require(value.schemaVersion === "1", 'schemaVersion must be "1"');
  e.require(isString(value.familyId) && SLUG.test(value.familyId), "familyId must be a slug");
  e.require(Number.isInteger(value.version) && value.version > 0, "version must be a positive integer");
  e.require(value.source === "test_fixture", 'source must be "test_fixture"');
  e.require(value.productionRewardEligible === false, "test fixtures cannot be production reward eligible");
  if (!e.require(isArray(value.essentialItems) && value.essentialItems.length > 0, "essentialItems must be non-empty")) return result(e);

  const ids = new Set();
  const priorities = new Set();
  value.essentialItems.forEach((item, index) => {
    const at = `essentialItems[${index}]`;
    if (!e.require(isObject(item), `${at} must be an object`)) return;
    exactKeys(e, item, ["id", "priority", "question", "evidenceDestination", "negativeSemantics"], at);
    e.require(isString(item.id) && SLUG.test(item.id), `${at}.id must be a slug`);
    e.require(!ids.has(item.id), `${at}.id must be unique`);
    ids.add(item.id);
    e.require(Number.isInteger(item.priority) && item.priority === index + 1, `${at}.priority must be contiguous rank order`);
    e.require(!priorities.has(item.priority), `${at}.priority must be unique`);
    priorities.add(item.priority);

    const q = item.question;
    if (e.require(isObject(q), `${at}.question must be an object`)) {
      exactKeys(e, q, ["prompt", "form", "options"], `${at}.question`);
      e.require(isString(q.prompt) && q.prompt.length > 0, `${at}.question.prompt must be non-empty`);
      e.require(oneOf(q.form, ["single_select", "multi_select", "free_text"]), `${at}.question.form is invalid`);
      if (e.require(isArray(q.options), `${at}.question.options must be an array`)) {
        q.options.forEach((option, optionIndex) => {
          const optionAt = `${at}.question.options[${optionIndex}]`;
          if (!e.require(isObject(option), `${optionAt} must be an object`)) return;
          exactKeys(e, option, ["value", "label"], optionAt);
          e.require(isString(option.value) && option.value.length > 0, `${optionAt}.value must be non-empty`);
          e.require(isString(option.label) && option.label.length > 0, `${optionAt}.label must be non-empty`);
        });
        if (q.form === "free_text") e.require(q.options.length === 0, `${at}.question free_text must not define options`);
        if (q.form === "single_select" || q.form === "multi_select") e.require(q.options.length > 0, `${at}.question select form requires options`);
      }
    }

    const destination = item.evidenceDestination;
    if (e.require(isObject(destination), `${at}.evidenceDestination must be an object`)) {
      exactKeys(e, destination, ["document", "section"], `${at}.evidenceDestination`);
      e.require(destination.document === "root_cv", `${at}.evidenceDestination.document must be root_cv`);
      e.require(oneOf(destination.section, SECTIONS), `${at}.evidenceDestination.section is invalid`);
    }
    e.require(item.negativeSemantics === "records_explicit_negative", `${at}.negativeSemantics is invalid`);
  });
  return result(e);
}

if (isCliMain(import.meta.url)) {
  process.exitCode = printResult("family-floor-v1", validateFamilyFloorV1(readJsonArg()));
}
