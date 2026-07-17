// S1 end-to-end smoke: anonymous session → CV upload → extract → mine → tailored preview,
// against a running API (real LLM), measuring the upload→preview wall clock that the S1
// exit review budgets at p50 ≤ 2 min. Run:  node scripts/s1-smoke.mjs [apiUrl] [cvPath]
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = process.argv[2] ?? "http://127.0.0.1:3001";
const here = dirname(fileURLToPath(import.meta.url));
const cvPath = process.argv[3] ?? join(here, "..", "apps", "api", "test", "fixtures", "clean.pdf");

let cookie = "";
async function call(method, path, body, headers = {}) {
  const res = await fetch(api + path, {
    method,
    headers: { cookie, ...headers },
    body,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// 1. session
let res = await call("POST", "/sessions/anonymous");
if (res.status !== 201) throw new Error(`session: ${res.status}`);
console.log(stamp(), "session created");

res = await call("PUT", "/sessions/me/targets", JSON.stringify({ targetTitles: ["IT Project Manager"] }), {
  "content-type": "application/json",
});
if (res.status !== 200) throw new Error(`targets: ${res.status}`);

// 2. upload (presign → put → complete). The 2-minute clock starts at upload.
const tUpload = Date.now();
res = await call("POST", "/uploads", JSON.stringify({ filename: "cv.pdf" }), {
  "content-type": "application/json",
});
const { id, putUrl } = await res.json();
res = await call("PUT", putUrl, readFileSync(cvPath), { "content-type": "application/octet-stream" });
if (res.status !== 200) throw new Error(`put: ${res.status}`);
res = await call("POST", `/uploads/${id}/complete`);
const completed = await res.json();
if (res.status !== 200) throw new Error(`complete: ${res.status} ${JSON.stringify(completed)}`);
const jobId = completed.jobId;
console.log(stamp(), `upload complete (kind=${completed.kind}), job ${jobId}`);

// 3. follow the job
let job;
let lastFeedLen = 0;
for (;;) {
  res = await call("GET", `/jobs/${jobId}`);
  job = await res.json();
  const feed = job.progress?.feed ?? [];
  for (; lastFeedLen < feed.length; lastFeedLen++) console.log(stamp(), " feed:", feed[lastFeedLen]);
  if (job.status === "completed" || job.status === "failed") break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (job.status !== "completed") throw new Error(`job failed: ${job.error}`);

// 4. preview
res = await call("GET", `/previews/${jobId}`);
if (res.status !== 200) throw new Error(`preview: ${res.status}`);
const html = await res.text();
const out = join(here, "s1-smoke-preview.html");
writeFileSync(out, html, "utf8");

const secs = ((Date.now() - tUpload) / 1000).toFixed(1);
console.log(stamp(), `PREVIEW READY — upload→preview ${secs}s (budget: 120s p50)`);
console.log(stamp(), `watermark present: ${html.includes("DRAFT")}, saved to ${out}`);
