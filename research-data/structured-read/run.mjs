// #196 cost matrix. Mirrors apps/api/src/llm.ts AnthropicLlm.request() exactly:
// POST https://api.anthropic.com/v1/messages, model claude-sonnet-5, max_tokens 32000,
// thinking disabled, no system prompt, no tools, single user message.
// Resumable: an existing out/<cell>__<cv>__<n>.json is never re-paid for.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const KEY = readFileSync("C:/Users/adrie/AI/Projects/jobcrush-app/.env", "utf8")
  .match(/ANTHROPIC_API_KEY\s*=\s*(\S+)/)[1];

const MODEL = "claude-sonnet-5";
const PRICE_IN = 3.0 / 1e6;
const PRICE_OUT = 15.0 / 1e6;

const cvs = JSON.parse(readFileSync(join(HERE, "cvs.json"), "utf8"));

// today's live miner prompt, read from the repo at run time, header-stripped exactly as
// apps/api/src/miner.ts minerPrompt() does
const minerPrompt = readFileSync(
  "C:/Users/adrie/AI/Projects/jobcrush-app/apps/api/prompts/claim-miner.md",
  "utf8",
).replace(/^<!--[\s\S]*?-->\s*/, "");

const lean = readFileSync(join(HERE, "prompt-lean.md"), "utf8");
const rich = readFileSync(join(HERE, "prompt-rich.md"), "utf8");
const compact = readFileSync(join(HERE, "prompt-compact.md"), "utf8");

const numbered = (t) => t.split(/\r?\n/).map((l, i) => `${i + 1}|${l}`).join("\n");

// buildMinerInput()'s exact construction: `${prompt}\n${cvText}\n`
const CELLS = {
  "batched-rich": (t) => `${minerPrompt}\n${t}\n`,
  "perdecision-lean": (t) => `${lean}\n${t}\n`,
  "perdecision-rich": (t) => `${rich}\n${t}\n`,
  compact: (t) => `${compact}\n${numbered(t)}\n`,
};

async function call(prompt, attempt = 0) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  // transient overload/rate-limit: back off and retry. A retried call is NOT billed twice --
  // an errored response returns no usage block, so nothing is counted for it.
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = 2 ** attempt * 5000;
    console.log(`  ${res.status} ${res.statusText} - retry ${attempt + 1}/5 in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return call(prompt, attempt + 1);
  }
  if (!res.ok) throw new Error(`anthropic api ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return {
    text: body.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    usage: body.usage,
    stop_reason: body.stop_reason,
  };
}

function spentSoFar() {
  let usd = 0;
  for (const f of readdirSync(OUT).filter((f) => f.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(join(OUT, f), "utf8"));
    usd += r.usage.input_tokens * PRICE_IN + r.usage.output_tokens * PRICE_OUT;
  }
  return usd;
}

const [cellArg, cvArg, samplesArg] = process.argv.slice(2);
const cells = cellArg && cellArg !== "all" ? cellArg.split(",") : Object.keys(CELLS);
const cvNames = cvArg && cvArg !== "all" ? [cvArg] : Object.keys(cvs);
const samples = Number(samplesArg ?? 2);
const CEILING = 20;

for (const cell of cells) {
  for (const cv of cvNames) {
    for (let n = 1; n <= samples; n++) {
      const slug = cv.replace(/[^A-Za-z0-9]+/g, "_");
      const path = join(OUT, `${cell}__${slug}__${n}.json`);
      if (existsSync(path)) continue;
      const spent = spentSoFar();
      if (spent > CEILING) {
        console.log(`STOPPING: spend $${spent.toFixed(2)} past ceiling $${CEILING}`);
        process.exit(0);
      }
      const t0 = Date.now();
      const r = await call(CELLS[cell](cvs[cv].text));
      const usd = r.usage.input_tokens * PRICE_IN + r.usage.output_tokens * PRICE_OUT;
      writeFileSync(path, JSON.stringify({ cell, cv, sample: n, ...r }, null, 2));
      console.log(
        `${cell} | ${cv.slice(0, 28)} | #${n} | in ${r.usage.input_tokens} out ${r.usage.output_tokens} ` +
          `| $${usd.toFixed(4)} | ${r.stop_reason} | ${((Date.now() - t0) / 1000).toFixed(0)}s ` +
          `| running $${(spent + usd).toFixed(2)}`,
      );
    }
  }
}
console.log(`TOTAL SPENT: $${spentSoFar().toFixed(4)}`);
