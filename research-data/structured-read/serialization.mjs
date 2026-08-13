// Decompose the per-decision×rich output bill into content vs serialization, using the FREE
// /v1/messages/count_tokens endpoint (same tokenizer as the billed call).
//   T_full      tokens of the text the model actually emitted (≈ billed output_tokens)
//   T_noquotes  same JSON with every source_quote blanked -> what repeated verbatim quotes cost
//   T_values    every leaf value concatenated, no JSON syntax at all -> irreducible content
// serialization overhead = T_full - T_values (field names, braces, quotes, colons, indentation)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const KEY = readFileSync("C:/Users/adrie/AI/Projects/jobcrush-app/.env", "utf8")
  .match(/ANTHROPIC_API_KEY\s*=\s*(\S+)/)[1];

async function countTokens(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).input_tokens;
}

const leaves = (v, acc = []) => {
  if (Array.isArray(v)) v.forEach((x) => leaves(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => leaves(x, acc));
  else if (v !== null && v !== "") acc.push(String(v));
  return acc;
};
const blankQuotes = (v) => {
  if (Array.isArray(v)) return v.map(blankQuotes);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "source_quote" ? "" : blankQuotes(x)]));
  return v;
};

const rows = [];
for (const f of readdirSync(OUT).filter((f) => f.startsWith("perdecision-rich__") && f.endsWith("__1.json"))) {
  const r = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  const raw = r.text;
  const doc = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const tFull = await countTokens(raw);
  const tNoQuotes = await countTokens(JSON.stringify(blankQuotes(doc), null, 2));
  const tValues = await countTokens(leaves(doc).join("\n"));
  // the matching compact call's real billed output
  const cf = join(OUT, f.replace("perdecision-rich__", "compact__"));
  const compactOut = JSON.parse(readFileSync(cf, "utf8")).usage.output_tokens;
  rows.push({ cv: r.cv, billed: r.usage.output_tokens, tFull, tNoQuotes, tValues, compactOut });
  console.log(
    `${r.cv.slice(0, 26).padEnd(26)} billed=${String(r.usage.output_tokens).padStart(6)} full=${String(tFull).padStart(6)} ` +
      `noquote=${String(tNoQuotes).padStart(6)} values=${String(tValues).padStart(6)} compact=${String(compactOut).padStart(6)}`,
  );
}

const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const pct = (a, b) => ((a / b) * 100).toFixed(1) + "%";
console.log("\n=== SHARE OF THE per-decision x rich OUTPUT BILL (all 6 CVs pooled) ===");
console.log(`content (leaf values only)      ${pct(sum("tValues"), sum("tFull"))}`);
console.log(`serialization (syntax+keys)     ${pct(sum("tFull") - sum("tValues"), sum("tFull"))}`);
console.log(`  of which: verbatim quotes     ${pct(sum("tFull") - sum("tNoQuotes"), sum("tFull"))}`);
console.log(`  of which: keys/braces/indent  ${pct(sum("tNoQuotes") - sum("tValues"), sum("tFull"))}`);
console.log(`\ncompact recovers of rich's real billed output: ${pct(sum("billed") - sum("compactOut"), sum("billed"))}`);
