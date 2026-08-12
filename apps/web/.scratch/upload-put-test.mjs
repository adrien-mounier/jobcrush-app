// Throwaway: prove the actual CV upload PUT lands on R2 from a browser-equivalent request.
// Creates one anonymous session, gets a presigned URL per file type, and PUTs the real fixture
// bytes with Origin: https://jobcrush.org so R2 enforces CORS exactly as a browser would.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "https://jobcrush.org";
const ORIGIN = process.env.CORS_ORIGIN ?? "https://jobcrush.org";
const FIX = fileURLToPath(new URL("../../api/test/fixtures/", import.meta.url));

const files = [
  { name: "clean.pdf", type: "application/pdf" },
  { name: "clean.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { name: "plain.txt", type: "text/plain" },
];

let cookie = "";
function extractCookie(setCookie) {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map((c) => c.split(";")[0]).join("; ") || null;
}
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...opts.headers, cookie } });
  const setCookie = res.headers.getSetCookie?.() ?? res.headers.get("set-cookie") ?? [];
  const c = extractCookie(setCookie);
  if (c) cookie = c;
  return res;
}

const sres = await apiFetch("/api/sessions/anonymous", { method: "POST" });
if (!sres.ok) throw new Error(`session failed: ${sres.status} ${sres.statusText}`);
console.log("session: ok");

let allOk = true;
for (const f of files) {
  const body = await readFile(`${FIX}${f.name}`);
  const ures = await apiFetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: f.name }),
  });
  if (!ures.ok) throw new Error(`uploads create failed for ${f.name}: ${ures.status}`);
  const { id, putUrl } = await ures.json();
  if (!putUrl?.startsWith("http")) throw new Error(`no presigned URL for ${f.name}: ${putUrl}`);

  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": f.type, Origin: ORIGIN },
    body,
  });
  const allowOrigin = putRes.headers.get("access-control-allow-origin");
  const ok = putRes.ok && allowOrigin === ORIGIN;
  if (!ok) allOk = false;
  console.log(`${f.name}: PUT ${putRes.status} ${putRes.ok ? "OK" : "FAIL"} allow-origin=${allowOrigin ?? "(none)"}`);
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    console.log(`  body: ${text.slice(0, 200)}`);
  }
}
console.log(allOk ? "\nALL UPLOADS OK" : "\nSOME UPLOADS FAILED");
process.exit(allOk ? 0 : 1);
