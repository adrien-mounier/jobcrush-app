// validate_graph.mjs — enforce Contract 1 (contracts/claim_graph.schema.md) on a claim-graph file.
//
// Usage:  node _claim_graph/validate_graph.mjs claim_graph/claim_graph_v1.json
// Import: import { validateGraph } from "./validate_graph.mjs"; const r = validateGraph(graphObj);
//
// Returns { ok, errors[], stats, digest }. `digest` powers the one-time human-review digest
// (counts per class, the full Negative/gap list, High-risk stretches).

import {
  Errors, result, readJson, printResult, isCliMain,
  isString, isNonEmptyString, isInt, isBool, isStringOrNull,
  isNonEmptyStringArray, oneOf, ISO_DATE, SLUG,
} from "./_lib.mjs";

const CLASSES = ["Verified", "Derived", "Partially-Supported", "Unsupported-but-Plausible", "Negative"];
const PROVENANCE_REQUIRED = ["Verified", "Derived", "Partially-Supported", "Negative"];
const RISKS = ["Low", "Med", "High"];

export function validateGraph(graph) {
  const e = new Errors();

  if (graph === null || typeof graph !== "object" || Array.isArray(graph)) {
    e.add("graph must be a JSON object");
    return result(e);
  }

  e.require(isNonEmptyString(graph.schemaVersion), "header.schemaVersion must be a non-empty string");
  e.require(isInt(graph.graphVersion) && graph.graphVersion >= 1, "header.graphVersion must be an integer >= 1");
  e.require(isNonEmptyString(graph.built_from_root_cv), "header.built_from_root_cv must be a non-empty string (e.g. \"v9\")");
  if (!Array.isArray(graph.nodes)) {
    e.add("header.nodes must be an array");
    return result(e);
  }

  const ids = new Set();
  const digest = {
    total: graph.nodes.length,
    byClass: Object.fromEntries(CLASSES.map((c) => [c, 0])),
    renderableFalse: 0,
    originEnrichment: 0,
    negatives: [],          // { id, text }
    highRiskStretches: [],  // { id, text, classification }
  };

  graph.nodes.forEach((n, i) => {
    const at = n && isString(n.id) ? `node "${n.id}"` : `node[${i}]`;

    if (n === null || typeof n !== "object" || Array.isArray(n)) {
      e.add(`${at}: must be an object`);
      return;
    }

    // id
    if (!isNonEmptyString(n.id) || !SLUG.test(n.id)) {
      e.add(`${at}: id must be a non-empty kebab slug`);
    } else if (ids.has(n.id)) {
      e.add(`${at}: duplicate id`);
    } else {
      ids.add(n.id);
    }

    // text
    e.require(isNonEmptyString(n.text), `${at}: text must be a non-empty string`);

    // classification
    const cls = n.classification;
    if (!oneOf(cls, CLASSES)) {
      e.add(`${at}: classification must be one of ${CLASSES.join(", ")}`);
    } else {
      digest.byClass[cls]++;
    }

    // provenance fields
    e.require(isStringOrNull(n.source_file), `${at}: source_file must be a string or null`);
    e.require(isStringOrNull(n.source_quote), `${at}: source_quote must be a string or null`);

    // inferred_from
    e.require(
      n.inferred_from === null || (Array.isArray(n.inferred_from) && n.inferred_from.every(isString)),
      `${at}: inferred_from must be a string[] or null`,
    );

    // tags
    e.require(isNonEmptyStringArray(n.tags), `${at}: tags must be a non-empty string[]`);

    // risk
    e.require(n.risk === null || oneOf(n.risk, RISKS), `${at}: risk must be Low|Med|High or null`);

    // renderable
    e.require(isBool(n.renderable), `${at}: renderable must be a boolean`);

    // origin
    e.require(oneOf(n.origin, ["source", "enrichment"]), `${at}: origin must be "source" or "enrichment"`);

    // narrative_ref
    e.require(isStringOrNull(n.narrative_ref), `${at}: narrative_ref must be a string or null`);

    // confirmed_date
    e.require(
      n.confirmed_date === null || (isString(n.confirmed_date) && ISO_DATE.test(n.confirmed_date)),
      `${at}: confirmed_date must be an ISO date (YYYY-MM-DD) or null`,
    );

    // ---- conditional invariants ----
    if (cls === "Negative") {
      // (5) gaps can never render
      e.require(n.renderable === false, `${at}: Negative node must have renderable=false`);
      digest.negatives.push({ id: n.id, text: n.text });
    }
    if (cls === "Unsupported-but-Plausible") {
      // (6) no provenance, carries a risk + a narrative
      e.require(n.source_file === null, `${at}: Unsupported-but-Plausible must have source_file=null`);
      e.require(oneOf(n.risk, RISKS), `${at}: Unsupported-but-Plausible must carry a risk (Low|Med|High)`);
      e.require(isNonEmptyString(n.narrative_ref), `${at}: Unsupported-but-Plausible must have a narrative_ref`);
    }
    if (PROVENANCE_REQUIRED.includes(cls)) {
      // (7) graded/negative classes need provenance
      e.require(isNonEmptyString(n.source_file), `${at}: ${cls} must have a non-empty source_file (provenance)`);
    }
    if (cls === "Partially-Supported") {
      // (8)
      e.require(oneOf(n.risk, RISKS), `${at}: Partially-Supported must carry a risk (Low|Med|High)`);
    }
    if (n.origin === "enrichment") {
      // (9) every deliberately-added stretch points to its interview narrative
      e.require(isNonEmptyString(n.narrative_ref), `${at}: origin=enrichment must have a narrative_ref`);
    }

    // digest tallies
    if (n.renderable === false) digest.renderableFalse++;
    if (n.origin === "enrichment") digest.originEnrichment++;
    if ((cls === "Partially-Supported" || cls === "Unsupported-but-Plausible") && n.risk === "High") {
      digest.highRiskStretches.push({ id: n.id, text: n.text, classification: cls });
    }
  });

  const stats =
    `${digest.total} nodes | ` +
    CLASSES.map((c) => `${c}:${digest.byClass[c]}`).join(" ") +
    ` | renderable=false:${digest.renderableFalse} | enrichment:${digest.originEnrichment}`;

  return result(e, { stats, digest, count: digest.total });
}

// Render the one-time human-review digest (counts per class + full Negative list + High-risk stretches).
export function formatDigest(digest) {
  const lines = [];
  lines.push("=== Claim-graph review digest ===");
  lines.push(`Total nodes: ${digest.total}`);
  lines.push("By classification:");
  for (const [c, n] of Object.entries(digest.byClass)) lines.push(`  ${c}: ${n}`);
  lines.push(`Renderable=false (Negative/gap): ${digest.renderableFalse}`);
  lines.push(`Origin=enrichment: ${digest.originEnrichment}`);
  lines.push("");
  lines.push(`Negative / confirmed-gap nodes (${digest.negatives.length}) — Tailor must never assert these:`);
  for (const g of digest.negatives) lines.push(`  - [${g.id}] ${g.text}`);
  lines.push("");
  lines.push(`High-risk stretches (${digest.highRiskStretches.length}) — sanity-check before trusting:`);
  for (const s of digest.highRiskStretches) lines.push(`  - [${s.id}] (${s.classification}) ${s.text}`);
  return lines.join("\n");
}

if (isCliMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node validate_graph.mjs <claim_graph_vN.json> [--digest]");
    process.exit(2);
  }
  const res = validateGraph(readJson(path));
  const code = printResult("validate_graph", res);
  if (process.argv.includes("--digest") && res.digest) {
    console.log("\n" + formatDigest(res.digest));
  }
  process.exit(code);
}
