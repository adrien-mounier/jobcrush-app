// Oracle for jobBlock.ts (#161) — the job-record miner's output. Mirrors the zod port field for
// field; the oracle is the contract spec (repo rule) — if they ever disagree, the port is wrong.
import { Errors, isArray, isInt, isObject, isString, oneOf, result } from "./_lib.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOUCH = new Set(["verbatim", "reworded", "inferred"]);
const CLASSIFICATION = new Set(["Verified", "Derived", "Partially-Supported"]);
const KINDS = new Set(["job", "education", "project", "client", "volunteering"]);
const PRECISIONS = new Set(["year", "month"]);

function validateDate(d, e, at) {
  if (!e.require(isObject(d), `${at} must be an object`)) return;
  e.require(isInt(d.year) && d.year >= 1900 && d.year <= 2100, `${at}.year invalid`);
  e.require(d.month === null || (isInt(d.month) && d.month >= 1 && d.month <= 12), `${at}.month invalid`);
  e.require(PRECISIONS.has(d.precision), `${at}.precision invalid`);
  if (d.precision === "year") e.require(d.month === null, `${at}.month must be null at year precision`);
  if (d.precision === "month") e.require(d.month !== null, `${at}.month required at month precision`);
}

function validateDecision(d, e, at, checkValue) {
  if (!e.require(isObject(d), `${at} must be an object`)) return;
  checkValue(d.value, e, `${at}.value`);
  e.require(
    isString(d.source_quote) && d.source_quote.length > 0 && d.source_quote.length <= 200,
    `${at}.source_quote invalid`,
  );
  e.require(TOUCH.has(d.machine_touch), `${at}.machine_touch invalid`);
  e.require(CLASSIFICATION.has(d.classification), `${at}.classification invalid`);
}

function validateEnd(d, e, at) {
  if (!e.require(isObject(d), `${at} must be an object`)) return;
  const v = d.value;
  const stateOk = isObject(v) && oneOf(v.state, ["ongoing", "ended", "unknown"]);
  if (e.require(stateOk, `${at}.value.state invalid`) && v.state === "ended") {
    validateDate(v.date, e, `${at}.value.date`);
  }
  e.require(
    d.source_quote === null || (isString(d.source_quote) && d.source_quote.length <= 200),
    `${at}.source_quote invalid`,
  );
  if (stateOk && v.state !== "unknown") e.require(!!d.source_quote, `${at} a stated end must carry its source words`);
  if (stateOk && v.state === "unknown") e.require(d.source_quote === null, `${at} an unknown end has nothing to quote`);
  e.require(TOUCH.has(d.machine_touch), `${at}.machine_touch invalid`);
  e.require(CLASSIFICATION.has(d.classification), `${at}.classification invalid`);
}

export function validateJobBlock(block, e = new Errors(), at = "block") {
  if (!e.require(isObject(block), `${at} must be an object`)) return e;
  e.require(isString(block.id) && SLUG.test(block.id), `${at}.id must be kebab-case`);
  validateDecision(block.employer, e, `${at}.employer`, (v, e2, at2) =>
    e2.require(isString(v) && v.length > 0, `${at2} invalid`),
  );
  validateDecision(block.title, e, `${at}.title`, (v, e2, at2) =>
    e2.require(isString(v) && v.length > 0, `${at2} invalid`),
  );
  validateDecision(block.start, e, `${at}.start`, (v, e2, at2) => validateDate(v, e2, at2));
  validateEnd(block.end, e, `${at}.end`);
  validateDecision(block.kind, e, `${at}.kind`, (v, e2, at2) => e2.require(KINDS.has(v), `${at2} invalid`));
  return e;
}

export function validateMinedJobBlocks(doc) {
  const e = new Errors();
  e.require(isObject(doc), "job blocks doc must be an object");
  e.require(doc?.schemaVersion === "1", 'schemaVersion must be "1"');
  if (e.require(isArray(doc?.blocks), "blocks must be an array")) {
    doc.blocks.forEach((block, index) => validateJobBlock(block, e, `blocks[${index}]`));
  }
  e.require(
    isArray(doc?.parser_flags) && doc.parser_flags.every(isString),
    "parser_flags must be a string array",
  );
  return result(e);
}
