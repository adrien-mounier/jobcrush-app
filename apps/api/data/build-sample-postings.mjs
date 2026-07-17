// One-shot generator for the JC-16 static curated posting set (run:
//   node data/build-sample-postings.mjs [path-to-JobCrush-repo]
// from apps/api). Reads the personal pipeline's job_offers/ history (real postings across
// the §2 title families) and distills each into what the S1 preview needs: title, company,
// location, an excerpt for the tailor, and match keywords. Output is committed; the real
// cluster engine replaces this in S3 (JC-31).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const jobcrushRoot = process.argv[2] ?? "C:/Users/adrie/AI/Projects/JobCrush";
const offersDir = join(jobcrushRoot, "job_offers");

const STOP = new Set(["senior", "junior", "lead", "the", "and", "of", "a", "i", "up", "to"]);

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

const postings = [];
for (const dir of readdirSync(offersDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  let text;
  try {
    text = readFileSync(join(offersDir, dir.name, "offer.md"), "utf8");
  } catch {
    continue;
  }
  const fm = frontmatter(text);
  if (!fm.job_title || !fm.company) continue;
  const raw = text.split(/## Raw Offer Text/i)[1] ?? text;
  const excerpt = raw
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2200);
  const keywords = [
    ...new Set(
      fm.job_title
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ];
  postings.push({
    id: dir.name,
    title: fm.job_title,
    company: fm.company,
    location: fm.location ?? "",
    keywords,
    excerpt,
  });
}

// keep a spread across title families, capped at 16
const out = postings.slice(0, 16);
writeFileSync(join(here, "sample-postings.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`wrote ${out.length} postings`);
