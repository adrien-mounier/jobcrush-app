// validate_proposal.mjs — enforce Contract 3 (contracts/enrichment_proposal.schema.md) on the
// enrichment inbox.
//
// Usage:  node _claim_graph/validate_proposal.mjs enrichment_inbox/inbox.json
// Import: import { validateInbox } from "./validate_proposal.mjs"; const r = validateInbox(inboxObj);

import {
  Errors, result, readJson, printResult, isCliMain,
  isString, isNonEmptyString, isStringOrNull, isNonEmptyStringArray, oneOf, isObject, isArray, SLUG,
} from "./_lib.mjs";

const STRETCH_CLASSES = ["Partially-Supported", "Unsupported-but-Plausible"];
const SOURCES = ["tailor_gap", "enricher_scan"];
const STATES = ["pending", "approved", "declined"];

export function validateInbox(inbox) {
  const e = new Errors();

  if (!isObject(inbox)) {
    e.add("inbox must be a JSON object");
    return result(e);
  }
  e.require(isNonEmptyString(inbox.schemaVersion), "schemaVersion must be a non-empty string");
  if (!isArray(inbox.proposals)) {
    e.add("inbox.proposals must be an array");
    return result(e);
  }

  const ids = new Set();
  inbox.proposals.forEach((p, i) => {
    const at = p && isString(p.id) ? `proposal "${p.id}"` : `proposal[${i}]`;
    if (!isObject(p)) {
      e.add(`${at}: must be an object`);
      return;
    }

    // id + uniqueness
    if (!isNonEmptyString(p.id) || !SLUG.test(p.id)) {
      e.add(`${at}: id must be a non-empty kebab slug`);
    } else if (ids.has(p.id)) {
      e.add(`${at}: duplicate id`);
    } else {
      ids.add(p.id);
    }

    // (5) claim + narrative both non-empty (the design guarantee)
    e.require(isNonEmptyString(p.claimText), `${at}: claimText must be a non-empty string`);
    e.require(isNonEmptyString(p.interviewNarrative), `${at}: interviewNarrative must be non-empty (every stretch carries a narrative)`);

    // (3) intendedClass is a stretch class only
    e.require(oneOf(p.intendedClass, STRETCH_CLASSES), `${at}: intendedClass must be one of ${STRETCH_CLASSES.join(", ")}`);

    // (4) source + state enums
    e.require(oneOf(p.source, SOURCES), `${at}: source must be one of ${SOURCES.join(", ")}`);
    e.require(oneOf(p.state, STATES), `${at}: state must be one of ${STATES.join(", ")}`);

    // (6) tags
    e.require(isNonEmptyStringArray(p.tags), `${at}: tags must be a non-empty string[]`);

    // optional refs
    e.require(isStringOrNull(p.originOffer), `${at}: originOffer must be a string or null`);
    e.require(isStringOrNull(p.targetContextFile), `${at}: targetContextFile must be a string or null`);

    // (2) narrativeAnchor slug
    e.require(isNonEmptyString(p.narrativeAnchor) && SLUG.test(p.narrativeAnchor), `${at}: narrativeAnchor must be a kebab slug`);

    // timestamps + (7) decided proposals record decidedAt
    e.require(isNonEmptyString(p.createdAt), `${at}: createdAt must be a non-empty string`);
    e.require(isStringOrNull(p.decidedAt), `${at}: decidedAt must be a string or null`);
    if (p.state === "approved" || p.state === "declined") {
      e.require(isNonEmptyString(p.decidedAt), `${at}: state "${p.state}" requires a non-null decidedAt`);
    }
  });

  return result(e, { count: inbox.proposals.length });
}

if (isCliMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node validate_proposal.mjs <inbox.json>");
    process.exit(2);
  }
  process.exit(printResult("validate_proposal", validateInbox(readJson(path))));
}
