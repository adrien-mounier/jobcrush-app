import { Errors, isArray, isObject, isString, result } from "./_lib.mjs";

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOUCH = new Set(["verbatim", "reworded", "inferred"]);
const CLASSIFICATION = new Set(["Verified", "Derived", "Partially-Supported"]);

export function validateCandidateClaims(doc) {
  const e = new Errors();
  e.require(isObject(doc), "candidate claims must be an object");
  e.require(doc?.schemaVersion === "1", 'schemaVersion must be "1"');
  e.require(isArray(doc?.roles), "roles must be an array");
  if (isArray(doc?.roles)) {
    doc.roles.forEach((role, index) => {
      const at = `roles[${index}]`;
      if (!e.require(isObject(role), `${at} must be an object`)) return;
      e.require(isString(role.employer) && role.employer.length > 0, `${at}.employer invalid`);
      e.require(isString(role.title) && role.title.length > 0, `${at}.title invalid`);
      e.require(isString(role.dates_as_written), `${at}.dates_as_written must be string`);
      e.require(typeof role.dates_missing === "boolean", `${at}.dates_missing must be boolean`);
    });
  }
  if (e.require(isArray(doc?.claims) && doc.claims.length > 0, "claims must be non-empty array")) {
    doc.claims.forEach((claim, index) => {
      const at = `claims[${index}]`;
      if (!e.require(isObject(claim), `${at} must be an object`)) return;
      e.require(isString(claim.id) && KEY.test(claim.id), `${at}.id must be kebab-case`);
      e.require(
        isString(claim.semantic_key) && KEY.test(claim.semantic_key),
        `${at}.semantic_key must be kebab-case`,
      );
      const paired =
        (claim.field_key === null && claim.field_value === null && claim.field_label === null) ||
        (isString(claim.field_key) &&
          KEY.test(claim.field_key) &&
          isString(claim.field_value) &&
          claim.field_value.trim().length > 0 &&
          isString(claim.field_label) &&
          claim.field_label.trim().length > 0);
      e.require(paired, `${at}.field_key, field_value, and field_label must be paired`);
      e.require(isString(claim.role) && claim.role.length > 0, `${at}.role must be non-empty`);
      e.require(isString(claim.text) && claim.text.length > 0, `${at}.text must be non-empty`);
      e.require(TOUCH.has(claim.machine_touch), `${at}.machine_touch invalid`);
      e.require(CLASSIFICATION.has(claim.classification), `${at}.classification invalid`);
      e.require(
        isString(claim.source_quote) &&
          claim.source_quote.length > 0 &&
          claim.source_quote.length <= 200,
        `${at}.source_quote invalid`,
      );
      e.require(typeof claim.needs_grill === "boolean", `${at}.needs_grill must be boolean`);
      e.require(
        claim.grill_hint === null || isString(claim.grill_hint),
        `${at}.grill_hint must be string or null`,
      );
      e.require(
        claim.machine_touch !== "inferred" || claim.needs_grill,
        `${at} inferred claims must need grill`,
      );
      e.require(!claim.needs_grill || !!claim.grill_hint, `${at} needs grill hint`);
    });
  }
  e.require(
    isArray(doc?.parser_flags) && doc.parser_flags.every(isString),
    "parser_flags must be a string array",
  );
  return result(e);
}
