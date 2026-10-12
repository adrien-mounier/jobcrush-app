#!/usr/bin/env node
// #380 eval (ADR-0018 clause 4): checks a review run made by blind-test.mjs for its removal
// suggestions. Passes when exactly the expected lines are suggested for removal, each as personal
// data, and nothing else is — on the owner's real CV that means none at all, so every true
// achievement stays. Any other removal is printed for a human to judge (a genuine duplicate or PDF
// fragment would be allowed, a true but weak line never) and fails the run.
//
//   node scripts/removal-eval.mjs <run.json> [--personal-data <line id>]...
//
// The run's .json is what blind-test.mjs writes (its `output` is the model's raw text). Needs
// `pnpm --filter @jobcrush/api build` first: the answer is parsed by the app's own parser.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseReviewAnswer } from "../dist/cvReviewRun.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { "personal-data": { type: "string", multiple: true, default: [] } } });
const record = JSON.parse(readFileSync(positionals[0], "utf8"));
const answer = parseReviewAnswer(record.output);
const removals = [...answer.jobs, ...(answer.sections ?? [])].flatMap((u) => u.judgements).filter((j) => j.verdict !== "keep");
for (const r of removals) console.log(`${r.verdict} [${r.line}] ${r.kind}: ${r.reason}`);
const expected = new Set(values["personal-data"]);
const wrong = removals.filter((r) => !(expected.has(r.line) && r.verdict === "remove" && r.kind === "personal-data"));
const missing = [...expected].filter((id) => !removals.some((r) => r.line === id && r.verdict === "remove" && r.kind === "personal-data"));
if (missing.length) console.log(`FAIL: not suggested for removal as personal data: ${missing.join(", ")}`);
if (wrong.length) console.log(`FAIL: suggested for removal and not expected: ${wrong.map((r) => r.line).join(", ")}`);
console.log(missing.length || wrong.length ? "FAIL" : "PASS");
process.exit(missing.length || wrong.length ? 1 : 0);
