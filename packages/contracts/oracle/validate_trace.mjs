// validate_trace.mjs — enforce the claim-trace contract (contracts/claim_trace.schema.md) against the
// live graph. This is the anti-fabrication gate: every rendered bullet must trace to a graph node,
// nothing untraced, and ZERO renderable=false (Negative/gap) nodes rendered.
//
// Usage:  node _claim_graph/validate_trace.mjs <claim_trace.json> <claim_graph_vN.json> [<cv.md>]
// Import: import { validateTrace, extractRenderedBullets } from "./validate_trace.mjs";
//         const r = validateTrace(traceObj, graphObj, { cvBullets });

import fs from "node:fs";
import {
  Errors, result, readJson, printResult, isCliMain,
  isString, isNonEmptyString, isInt, isStringOrNull, isNonEmptyStringArray, isArray,
} from "./_lib.mjs";

const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

// Extract rendered claim bullets from a tailored CV markdown (lines beginning with "- ").
export function extractRenderedBullets(md) {
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+(.*\S)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function validateTrace(trace, graph, opts = {}) {
  const e = new Errors();

  if (trace === null || typeof trace !== "object" || Array.isArray(trace)) {
    e.add("trace must be a JSON object");
    return result(e);
  }
  if (graph === null || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    e.add("graph must be a claim-graph object with a nodes array");
    return result(e);
  }

  const byId = new Map(graph.nodes.filter((n) => n && isString(n.id)).map((n) => [n.id, n]));

  // (1) graph version consistency
  e.require(
    isInt(trace.graphVersion) && trace.graphVersion === graph.graphVersion,
    `trace.graphVersion (${trace.graphVersion}) must equal graph.graphVersion (${graph.graphVersion})`,
  );
  e.require(isNonEmptyString(trace.cvFile), "trace.cvFile must be a non-empty string");

  if (!isArray(trace.entries)) {
    e.add("trace.entries must be an array");
    return result(e);
  }

  const entryBullets = [];
  trace.entries.forEach((en, i) => {
    const at = `entry[${i}]`;
    if (en === null || typeof en !== "object" || Array.isArray(en)) {
      e.add(`${at}: must be an object`);
      return;
    }
    e.require(isNonEmptyString(en.bullet), `${at}: bullet must be a non-empty string`);
    e.require(isString(en.section), `${at}: section must be a string`);

    if (isNonEmptyString(en.bullet)) entryBullets.push(en.bullet);

    // (2) nodeIds non-empty; classifications parallel
    const okIds = isNonEmptyStringArray(en.nodeIds);
    e.require(okIds, `${at}: nodeIds must be a non-empty string[] (nothing untraced)`);
    e.require(
      isArray(en.classifications) && en.classifications.length === (okIds ? en.nodeIds.length : -1),
      `${at}: classifications must be a string[] parallel to nodeIds`,
    );

    if (okIds) {
      en.nodeIds.forEach((id, j) => {
        const node = byId.get(id);
        // (3) every nodeId in the graph
        if (!node) {
          e.add(`${at}: nodeId "${id}" not found in graph (claim absent from the graph)`);
          return;
        }
        // (4) THE GATE: never render a Negative / non-renderable node
        if (node.renderable === false) {
          e.add(`${at}: nodeId "${id}" is renderable=false (${node.classification}) — must never be rendered`);
        }
        // (5) classification consistency
        if (isArray(en.classifications) && en.classifications[j] !== undefined) {
          e.require(
            en.classifications[j] === node.classification,
            `${at}: classifications[${j}] "${en.classifications[j]}" != node "${id}" classification "${node.classification}"`,
          );
        }
      });
    }
  });

  // (6) gaps
  if (!isArray(trace.gaps)) {
    e.add("trace.gaps must be an array");
  } else {
    trace.gaps.forEach((g, i) => {
      const at = `gap[${i}]`;
      if (g === null || typeof g !== "object" || Array.isArray(g)) {
        e.add(`${at}: must be an object`);
        return;
      }
      e.require(isNonEmptyString(g.signal), `${at}: signal must be a non-empty string`);
      e.require(isString(g.note), `${at}: note must be a string`);
      e.require(isStringOrNull(g.proposalId), `${at}: proposalId must be a string or null`);
    });
  }

  // (7) optional: every rendered CV bullet is covered by a trace entry
  if (Array.isArray(opts.cvBullets)) {
    const traced = new Set(entryBullets.map(norm));
    for (const b of opts.cvBullets) {
      if (!traced.has(norm(b))) {
        e.add(`untraced CV bullet (not in claim_trace): "${b}"`);
      }
    }
  }

  return result(e, { count: trace.entries.length });
}

if (isCliMain(import.meta.url)) {
  const [tracePath, graphPath, cvPath] = process.argv.slice(2);
  if (!tracePath || !graphPath) {
    console.error("usage: node validate_trace.mjs <claim_trace.json> <claim_graph_vN.json> [<cv.md>]");
    process.exit(2);
  }
  const opts = {};
  if (cvPath) opts.cvBullets = extractRenderedBullets(fs.readFileSync(cvPath, "utf8"));
  const res = validateTrace(readJson(tracePath), readJson(graphPath), opts);
  process.exit(printResult("validate_trace", res));
}
