// _lib.mjs — shared helpers for the claim-graph / card / proposal validators.
//
// Pure Node built-ins, no dependencies (so the validators run anywhere `node` is on PATH, with no
// npm install). Each validator imports the predicates + Errors collector from here, exports a pure
// `validate…()` function for the test suite to import, and uses `printResult` / `isCliMain` for its
// standalone CLI entry point.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function readJson(path) {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw);
}

// Read+parse the JSON file path given as the first CLI argument (argv[2]) — the convenience wrapper
// validators reach for in their CLI entry point when they take exactly one file argument. Was
// imported by validate_family_floor_v1.mjs and validate_family_placement.mjs without ever being
// defined here; a standalone `node <validator>.mjs <fixture>` run threw SyntaxError on the missing
// export (only vitest's transform masked it, as `undefined`). Same argv[2] convention already used
// inline by validate_card.mjs/validate_graph.mjs/validate_proposal.mjs — this just names it once.
export function readJsonArg() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node <validator>.mjs <path-to-json>");
    process.exit(2);
  }
  return readJson(path);
}

// ---- format predicates ----
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/; // lenient on the timezone tail
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isString = (v) => typeof v === "string";
export const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
export const isBool = (v) => typeof v === "boolean";
export const isInt = (v) => Number.isInteger(v);
export const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isArray = (v) => Array.isArray(v);
export const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
export const isNonEmptyStringArray = (v) => isStringArray(v) && v.length > 0;
export const isStringOrNull = (v) => v === null || typeof v === "string";
export const isNonEmptyStringOrNull = (v) => v === null || isNonEmptyString(v);
export const oneOf = (v, allowed) => allowed.includes(v);

// ---- error collector ----
export class Errors {
  constructor() {
    this.list = [];
  }
  add(msg) {
    this.list.push(msg);
    return this;
  }
  // require(cond, msg): record `msg` when the condition is false. Returns cond (handy for guards).
  require(cond, msg) {
    if (!cond) this.list.push(msg);
    return cond;
  }
  get ok() {
    return this.list.length === 0;
  }
}

// Wrap a validate function's accumulated errors into the common result shape.
export function result(errors, extra = {}) {
  return { ok: errors.ok, errors: errors.list, ...extra };
}

// ---- CLI helpers ----

// True when this module file is the script node was invoked with (cross-platform via file URL).
export function isCliMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

// Print a result and return the process exit code (0 ok, 1 failed). `stats` lines printed if present.
export function printResult(label, res) {
  if (res.stats) {
    console.log(`[${label}] ${res.stats}`);
  }
  if (res.ok) {
    console.log(`[${label}] OK${res.count != null ? ` (${res.count} checked)` : ""}`);
    return 0;
  }
  console.error(`[${label}] FAILED — ${res.errors.length} error(s):`);
  for (const e of res.errors) console.error(`  - ${e}`);
  return 1;
}
