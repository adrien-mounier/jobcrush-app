import fs from "node:fs";
const dir = process.argv[2];
const input = fs.readFileSync(`${dir}/input-full-cv.md`, "utf8");
const models = {
  "kimi-fast-latest (Fire Pass)": ["accounts/fireworks/routers/kimi-fast-latest", 0, 0],
  "kimi-k3": ["accounts/fireworks/models/kimi-k3", 3.0, 15.0],
  "glm-5p3": ["accounts/fireworks/models/glm-5p3", 1.4, 4.4],
  "glm-5p3-flash": ["accounts/fireworks/models/glm-5p3-flash", 0.15, 0.5],
  "deepseek-v4-pro": ["accounts/fireworks/models/deepseek-v4-pro-0813", null, null],
  "deepseek-v4p1-flash": ["accounts/fireworks/models/deepseek-v4p1-flash", 0.3, 1.2],
  "qwen3p8-max": ["accounts/fireworks/models/qwen3p8-max", 2.0, 6.0],
  "minimax-m3": ["accounts/fireworks/models/minimax-m3", 0.3, 1.2],
  "gpt-oss-120b": ["accounts/fireworks/models/gpt-oss-120b", 0.15, 0.6],
  "nemotron-3-ultra": ["accounts/fireworks/models/nemotron-3-ultra-nvfp4", 0.6, 2.4],
};
const one = async (name, [id, pin, pout]) => {
  const t = Date.now();
  try {
    const r = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: id, max_tokens: 32000, reasoning_effort: "high",
        messages: [{ role: "system", content: "You are a careful CV writer. Follow the user's rules exactly." },
                   { role: "user", content: input }] }),
      signal: AbortSignal.timeout(900000),
    });
    const j = await r.json();
    const secs = Math.round((Date.now() - t) / 1000);
    if (!r.ok) return { name, id, error: `${r.status} ${JSON.stringify(j).slice(0, 300)}`, secs };
    const u = j.usage ?? {};
    const cost = pin == null ? null : ((u.prompt_tokens ?? 0) * pin + (u.completion_tokens ?? 0) * pout) / 1e6;
    const text = j.choices?.[0]?.message?.content ?? "";
    fs.writeFileSync(`${dir}/open-${name.split(" ")[0]}.md`, text);
    return { name, id, secs, in: u.prompt_tokens, out: u.completion_tokens, cost };
  } catch (e) { return { name, id, error: String(e), secs: Math.round((Date.now() - t) / 1000) }; }
};
const res = await Promise.all(Object.entries(models).map(([n, m]) => one(n, m)));
fs.writeFileSync(`${dir}/open-usage.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
