// validate_card.mjs — enforce Contract 2 (contracts/card_payload.schema.md) on a card.json payload.
//
// Usage:  node _claim_graph/validate_card.mjs <offer folder>/card.json
// Import: import { validateCard } from "./validate_card.mjs"; const r = validateCard(cardObj);
//
// Shape-only — the orchestrator separately checks the PDF exists on disk (the fail-closed rule).

import {
  Errors, result, readJson, printResult, isCliMain,
  isString, isNonEmptyString, isBool, isNumber, isObject, isArray, isStringOrNull, oneOf,
} from "./_lib.mjs";

const CLASSES = ["Verified", "Derived", "Partially-Supported", "Unsupported-but-Plausible", "Negative"];
const RISKS_OR_NULL = ["Low", "Med", "High", null];
const LANES = ["easy_apply", "external_ats"];
const STATUS = ["seen", "screened", "rejected_score", "staged", "tailored", "ready_for_review", "held", "queued", "applied", "declined"];

export function validateCard(card) {
  const e = new Errors();

  if (!isObject(card)) {
    e.add("card must be a JSON object");
    return result(e);
  }

  e.require(isNonEmptyString(card.schemaVersion), "schemaVersion must be a non-empty string");
  e.require(isNonEmptyString(card.jobId), "jobId must be a non-empty string");
  for (const f of ["company", "title", "location", "offerFolder", "pdfPath", "cvVersion", "diffVsRoot", "auditModel", "createdAt"]) {
    e.require(isString(card[f]), `${f} must be a string`);
  }
  e.require(isNonEmptyString(card.pdfPath), "pdfPath must be a non-empty string");

  // (3) fitScore
  e.require(isNumber(card.fitScore) && card.fitScore >= 0 && card.fitScore <= 100, "fitScore must be a number in [0,100]");
  e.require(isObject(card.scoreBreakdown), "scoreBreakdown must be an object");

  // (2) lane + status
  e.require(oneOf(card.lane, LANES), `lane must be one of ${LANES.join(", ")}`);
  e.require(oneOf(card.status, STATUS), `status must be one of ${STATUS.join(", ")}`);

  e.require(isStringOrNull(card.firstPagePngPath), "firstPagePngPath must be a string or null");

  // (5) auditFlags present (fail-closed: the field must exist even if empty)
  if (!isArray(card.auditFlags)) {
    e.add("auditFlags must be an array (present even when empty — fail-closed)");
  } else {
    card.auditFlags.forEach((fl, i) => {
      const at = `auditFlags[${i}]`;
      if (!isObject(fl)) {
        e.add(`${at}: must be an object`);
        return;
      }
      e.require(isString(fl.claim), `${at}: claim must be a string`);
      e.require(oneOf(fl.classification, CLASSES), `${at}: classification invalid`);
      e.require(oneOf(fl.risk, RISKS_OR_NULL), `${at}: risk must be Low|Med|High or null`);
      e.require(isString(fl.note), `${at}: note must be a string`);
      e.require(isStringOrNull(fl.provenance), `${at}: provenance must be a string or null`);
      e.require(isBool(fl.isStrategicStretch), `${at}: isStrategicStretch must be a boolean`);
      e.require(isStringOrNull(fl.narrativeRef), `${at}: narrativeRef must be a string or null`);
      // (6) a flagged strategic stretch must carry its narrative pointer
      if (fl.isStrategicStretch === true) {
        e.require(isNonEmptyString(fl.narrativeRef), `${at}: isStrategicStretch=true requires a non-null narrativeRef`);
      }
    });
  }

  // (7) audit model / degraded badge
  e.require(isBool(card.auditDegraded), "auditDegraded must be a boolean");
  if (card.auditDegraded === true) {
    e.require(card.auditModel === "claude", 'auditDegraded=true requires auditModel="claude"');
  }

  // easyApplyAnswers
  if (!isArray(card.easyApplyAnswers)) {
    e.add("easyApplyAnswers must be an array");
  } else {
    card.easyApplyAnswers.forEach((a, i) => {
      const at = `easyApplyAnswers[${i}]`;
      if (!isObject(a)) return e.add(`${at}: must be an object`);
      e.require(isString(a.question), `${at}: question must be a string`);
      e.require(isString(a.answer), `${at}: answer must be a string`);
    });
  }

  // heldQuestions + needsAnswer (4)
  let heldLen = -1;
  if (!isArray(card.heldQuestions)) {
    e.add("heldQuestions must be an array");
  } else {
    heldLen = card.heldQuestions.length;
    card.heldQuestions.forEach((h, i) => {
      const at = `heldQuestions[${i}]`;
      if (!isObject(h)) return e.add(`${at}: must be an object`);
      e.require(isString(h.question), `${at}: question must be a string`);
      e.require(isString(h.reason), `${at}: reason must be a string`);
    });
  }
  e.require(isBool(card.needsAnswer), "needsAnswer must be a boolean");
  if (isBool(card.needsAnswer) && heldLen >= 0) {
    e.require(card.needsAnswer === (heldLen > 0), `needsAnswer must equal heldQuestions.length > 0 (have needsAnswer=${card.needsAnswer}, heldQuestions=${heldLen})`);
  }

  return result(e);
}

if (isCliMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node validate_card.mjs <card.json>");
    process.exit(2);
  }
  process.exit(printResult("validate_card", validateCard(readJson(path))));
}
