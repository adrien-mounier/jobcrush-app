#!/usr/bin/env node
// Blind test for the CV review prompt (#340): run one input against one model, through the SAME
// drivers the app uses (dist/llm.js), and write the output for scoring the way the research README
// scores (docs/cv-brain/research/2026-10-03_thin-job-line-generation/README.md). This is the gate
// before any model switch for the review step — no switch without a scored run from here.
//
// Built from that folder's run-fireworks.mjs, with two changes: the drivers are the app's own
// (so a run here is the product's call, reasoning level and streaming included), and the defaults
// are the review step's settings in data/ai-steps.json. Needs `pnpm --filter @jobcrush/api build`
// first, and ANTHROPIC_API_KEY or FIREWORKS_API_KEY in the environment.
//
//   node scripts/blind-test.mjs --input <file> --out <dir>
//        [--model <id>] [--reasoning off|low|medium|high|xhigh|max] [--max-tokens n] [--timeout ms]
//        [--prompt prompts/cv-review.md] [--label name]
//   node scripts/blind-test.mjs --from-json <run.json> --out <dir>     # re-render a run made elsewhere
//
// The input file holds the four blocks the prompt names (JOB FAMILIES, JOB PLACEMENTS, JOBS TO
// REVIEW, THE CANDIDATE'S CV); the prompt is prepended here. Writes <out>/<label>.json (raw text,
// usage, seconds, USD) and <out>/<label>.md (the answer rendered for a human scorer).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AnthropicLlm, FireworksLlm, stepConfig } from "../dist/llm.js";

// USD per million tokens, in / out. Read from the providers' own pages on PRICES_READ_ON:
// platform.claude.com/docs/en/about-claude/pricing and docs.fireworks.ai/serverless/pricing.
// A model not listed here runs, and its cost is reported as unknown — never estimated.
const PRICES_READ_ON = "2026-10-06";
const PRICES = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "accounts/fireworks/models/glm-5p3-flash": [0.15, 0.5],
  "accounts/fireworks/models/glm-5p3": [1.4, 4.4],
  "accounts/fireworks/models/kimi-k3": [3, 15],
};

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string" },
    model: { type: "string" },
    reasoning: { type: "string" },
    "max-tokens": { type: "string" },
    timeout: { type: "string" },
    prompt: { type: "string", default: join(here, "..", "prompts", "cv-review.md") },
    label: { type: "string" },
    "from-json": { type: "string" },
  },
});
if (args["from-json"] && args.out) {
  // A run made on another machine (staging holds the API key; the agent's shell does not) comes
  // back as its .json; this writes the .md a scorer reads from it, nothing else.
  const record = JSON.parse(readFileSync(args["from-json"], "utf8"));
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, `${record.label}.md`), render(record));
  process.exit(0);
}
if (!args.input || !args.out) {
  console.error("usage: blind-test.mjs --input <file> --out <dir> [--model id] [--reasoning level] ...");
  process.exit(2);
}

const step = stepConfig("review");
const model = args.model ?? step.model;
// The step names its provider; an overriding model id says which one it belongs to.
const provider = args.model ? (model.startsWith("accounts/") ? "fireworks" : "anthropic") : step.provider;
const priceAgeDays = Math.floor((Date.now() - Date.parse(PRICES_READ_ON)) / 86_400_000);
if (priceAgeDays > 30) console.error(`PRICES were read ${priceAgeDays} days ago — re-read the providers' pages before quoting a cost`);
const settings = {
  reasoning: provider === "anthropic" ? (args.reasoning ?? step.reasoning) : undefined,
  maxTokens: args["max-tokens"] ? Number(args["max-tokens"]) : step.maxTokens,
  timeoutMs: args.timeout ? Number(args.timeout) : step.timeoutMs,
};
const key = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.FIREWORKS_API_KEY;
if (!key) {
  console.error(`no ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "FIREWORKS_API_KEY"} in the environment`);
  process.exit(2);
}
const llm =
  provider === "anthropic" ? new AnthropicLlm(key, model, settings) : new FireworksLlm(model, key, settings);

const prompt = readFileSync(args.prompt, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
const input = readFileSync(args.input, "utf8");
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const label = args.label ?? `${model.split("/").pop()}_${settings.reasoning ?? "default"}_${stamp}`;
mkdirSync(args.out, { recursive: true });

console.error(`${label}: ${provider} ${model} reasoning=${settings.reasoning ?? "n/a"} maxTokens=${settings.maxTokens} timeout=${settings.timeoutMs}ms`);
const started = Date.now();
const { text, usage } = await llm.completeWithUsage(`${prompt}\n\n${input}`);
const secs = Math.round((Date.now() - started) / 1000);
const price = PRICES[model];
const costUsd = price ? (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1e6 : null;

const record = { label, provider, model, ...settings, secs, usage, costUsd, pricesReadOn: PRICES_READ_ON, output: text };
writeFileSync(join(args.out, `${label}.json`), JSON.stringify(record, null, 2));
writeFileSync(join(args.out, `${label}.md`), render(record));
console.log(
  `${label}: ${secs}s, ${usage.inputTokens} in / ${usage.outputTokens} out, ` +
    (costUsd === null ? `cost unknown (add ${model} to PRICES)` : `USD ${costUsd.toFixed(3)} at ${PRICES_READ_ON} prices`),
);

/** The answer as a scorer reads it. A non-JSON answer is written raw, labelled as such. */
function render(r) {
  const head = [
    `# ${r.label}`,
    "",
    `${r.provider} \`${r.model}\`, reasoning ${r.reasoning ?? "n/a"}, ${r.secs}s, ${r.usage.inputTokens} in / ${r.usage.outputTokens} out, ` +
      (r.costUsd === null ? "cost unknown" : `≈ USD ${r.costUsd.toFixed(3)} (prices read ${r.pricesReadOn})`),
    "",
  ];
  let review;
  try {
    review = JSON.parse(r.output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    return [...head, "## Raw output (not JSON)", "", r.output].join("\n");
  }
  const out = [...head];
  const fixes = (list) => list.map((f) => `- \`${f.line}\` ${f.original} → **${f.corrected}**`);
  const judgements = (list) =>
    list.filter((j) => j.verdict !== "keep").map((j) => `- \`${j.line}\` UNTICK (${j.kind}): ${j.reason}`);
  const block = (fx, jd) => {
    const lines = [];
    if (fx.length) lines.push("Fixes:", ...fixes(fx));
    const un = judgements(jd);
    lines.push(un.length ? "Untick suggestions:" : `Untick suggestions: none (${jd.length} lines judged)`, ...un);
    return lines;
  };
  const letterhead =
    review.letterhead === null || review.letterhead === undefined
      ? ["- not requested this call"]
      : review.letterhead.checks?.length
        ? review.letterhead.checks.map((c) => `- ${c}`)
        : ["- nothing to check"];
  out.push("## Letterhead", "", ...letterhead, "");
  if (review.sections === null) out.push("## Sections", "", "- not requested this call", "");
  for (const s of review.sections ?? []) out.push(`## Section: ${s.section}`, "", ...block(s.fixes ?? [], s.judgements ?? []), "");
  for (const j of review.jobs ?? []) {
    out.push(`## Job: ${j.job} (family: ${j.family ?? "none"})${j.complete ? " — complete" : ""}`, "", ...block(j.fixes ?? [], j.judgements ?? []));
    for (const m of j.mustHaves ?? []) out.push(`- must-have \`${m.id}\`: ${m.shownBy?.length ? `shown by ${m.shownBy.join(", ")}` : "not shown"}`);
    if (j.drafted?.length) {
      out.push("", "Drafted lines:");
      for (const d of j.drafted) {
        const source = [d.mustHave && `must-have \`${d.mustHave}\``, d.quote && `"${d.quote}"`].filter(Boolean).join(" + ");
        out.push(`- ${d.text}`, `  - SOURCE: ${source || "NONE (rule violation)"}${d.flags?.length ? ` · FLAGS: ${d.flags.join(", ")}` : ""}`);
        for (const v of d.vague ?? [])
          out.push(`  - [${v.phrase}]: ${v.options.map((o) => `${o.text} (${o.from}${o.quote ? ` "${o.quote}"` : ""})`).join(" · ")}`);
      }
    }
    out.push("", `End date missing: ${j.endDateMissing ? "yes" : "no"}`);
    for (const c of j.conflicts ?? []) out.push(`- conflict: ${c.what}: ${c.values.join(" / ")}`);
    out.push("");
  }
  if (review.refused?.length) out.push("## Refused", "", ...review.refused.map((x) => `- ${x.job}: ${x.what} (${x.rule})`), "");
  return out.join("\n");
}
