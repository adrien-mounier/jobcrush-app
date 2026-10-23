// validate_stretch_proposal_v2.mjs — enforce the stretch proposal v2 (#417, ADR-0020 clause 3) on one
// suggestion stored beside a tailored draft. Versioned BESIDE Contract 3 (validate_proposal.mjs),
// which stays frozen as the ported shape: v2 is ADR-0005's four changes plus the line out —
//   1. not a claim-graph node (nothing here references the graph; no narrativeAnchor, no tags);
//   2. the job reference is required, never null (clause 7);
//   3. a decline carries its scope — "this-job" only until the mute list exists (clause 9, ADR-0020);
//   4. a record names the proposal it derived from (clause 8: an edited wording is a new record).
// The line out is slot-matched (clause 4): a bullet or a summary line pushes a line out, shown in
// full; a skill pushes nothing out.
//
// Usage:  node validate_stretch_proposal_v2.mjs proposal.json
// Import: import { validateStretchProposalV2 } from "./validate_stretch_proposal_v2.mjs";

import {
  Errors, result, readJson, printResult, isCliMain,
  isInt, isNonEmptyString, isObject, oneOf, SLUG,
} from "./_lib.mjs";

const STRETCH_CLASSES = ["Partially-Supported", "Unsupported-but-Plausible"];
const STATES = ["pending", "approved", "declined"];
const SLOT_KINDS = ["bullet", "summary", "skill"];
const APPROVED_SCOPES = ["this-job", "every-job"];
const DECLINED_SCOPES = ["this-job"];

const isIndex = (v) => isInt(v) && v >= 0;

export function validateStretchProposalV2(p) {
  const e = new Errors();
  if (!isObject(p)) {
    e.add("proposal must be a JSON object");
    return result(e);
  }
  e.require(p.schemaVersion === "2", 'schemaVersion must be "2"');
  e.require(isNonEmptyString(p.id) && SLUG.test(p.id), "id must be a non-empty kebab slug");
  // (2) the job reference is required
  e.require(isNonEmptyString(p.adId), "adId must be a non-empty string (a stretch belongs to its job)");
  e.require(isNonEmptyString(p.requirementId), "requirementId must be a non-empty string");
  e.require(isNonEmptyString(p.why), "why must be non-empty (every suggestion states why it fired)");
  e.require(isNonEmptyString(p.claimText), "claimText must be a non-empty string");
  e.require(oneOf(p.intendedClass, STRETCH_CLASSES), `intendedClass must be one of ${STRETCH_CLASSES.join(", ")}`);
  e.require(isNonEmptyString(p.interviewNarrative), "interviewNarrative must be non-empty (every stretch carries what to say)");

  // the slot, and the slot-matched line out
  if (!isObject(p.slot) || !oneOf(p.slot.kind, SLOT_KINDS)) {
    e.add(`slot.kind must be one of ${SLOT_KINDS.join(", ")}`);
  } else if (p.slot.kind === "bullet") {
    e.require(isIndex(p.slot.role) && isIndex(p.slot.bullet), "a bullet slot names a role index and a bullet index");
    e.require(isNonEmptyString(p.lineOut), "a bullet slot pushes a line out, shown in full");
  } else if (p.slot.kind === "summary") {
    e.require(isNonEmptyString(p.lineOut), "a summary slot pushes the summary line out, shown in full");
  } else {
    e.require(isIndex(p.slot.group), "a skill slot names a skills group index");
    e.require(p.lineOut === null, "a skill slot pushes nothing out (lineOut must be null)");
  }

  // (4) lineage
  e.require(p.derivedFrom === null || (isNonEmptyString(p.derivedFrom) && SLUG.test(p.derivedFrom)), "derivedFrom must be null or a kebab slug");
  e.require(isNonEmptyString(p.createdAt), "createdAt must be a non-empty string");

  // state, decidedAt and (3) the scope
  if (!oneOf(p.state, STATES)) {
    e.add(`state must be one of ${STATES.join(", ")}`);
  } else if (p.state === "pending") {
    e.require(p.decidedAt === null, "a pending proposal has no decidedAt");
    e.require(p.scope === null, "a pending proposal has no scope");
  } else {
    e.require(isNonEmptyString(p.decidedAt), `state "${p.state}" requires a non-null decidedAt`);
    const scopes = p.state === "approved" ? APPROVED_SCOPES : DECLINED_SCOPES;
    e.require(oneOf(p.scope, scopes), `state "${p.state}" requires scope one of ${scopes.join(", ")}`);
  }
  return result(e);
}

if (isCliMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node validate_stretch_proposal_v2.mjs <proposal.json>");
    process.exit(2);
  }
  process.exit(printResult("validate_stretch_proposal_v2", validateStretchProposalV2(readJson(path))));
}
