// JC-16 instant draft preview: pick 1 posting from the static curated set (title-keyword
// match — the real cluster engine is S3/JC-31), tailor a 1-page draft from the mined
// candidate claims via the ported tailor prompt, and render HTML with the watermark burned
// into the document itself (background + banner are part of the server render, not a UI
// overlay). PDF export is deliberately absent until the facts are verified (S3/JC-40).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CandidateClaims } from "@jobcrush/contracts";
import { extractJson } from "./miner.js";
import type { LlmClient } from "./llm.js";
import type { RawCv } from "./extract.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface Posting {
  id: string;
  title: string;
  company: string;
  location: string;
  keywords: string[];
  excerpt: string;
}

let cachedPostings: Posting[] | null = null;
export function loadPostings(): Posting[] {
  if (!cachedPostings) {
    cachedPostings = JSON.parse(
      readFileSync(join(here, "..", "data", "sample-postings.json"), "utf8"),
    ) as Posting[];
  }
  return cachedPostings;
}

/** Title-keyword match: most overlapping keywords wins; ties go to the earlier posting. */
export function matchPosting(targetTitles: string[], postings = loadPostings()): Posting {
  const targetWords = new Set(
    targetTitles
      .join(" ")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2),
  );
  const first = postings[0];
  if (!first) throw new Error("sample-postings.json is empty");
  let best = first;
  let bestScore = -1;
  for (const p of postings) {
    const score = p.keywords.filter((k) => targetWords.has(k)).length;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

const Draft = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  contact: z.string().default(""),
  summary: z.string().min(1),
  experience: z
    .array(
      z.object({
        role: z.string(),
        employer: z.string(),
        dates: z.string().default(""),
        bullets: z.array(z.string()).max(5),
      }),
    )
    .min(1)
    .max(4),
  skills: z.array(z.string()).max(12),
  education: z.array(z.string()).default([]),
});
export type Draft = z.infer<typeof Draft>;

let cachedPrompt: string | null = null;
function tailorPrompt(): string {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(join(here, "..", "prompts", "preview-tailor.md"), "utf8").replace(
      /^<!--[\s\S]*?-->\s*/,
      "",
    );
  }
  return cachedPrompt;
}

export function buildTailorInput(
  claims: CandidateClaims,
  posting: Posting,
  headerText = "",
): string {
  const claimLines = claims.claims.map((c) => `- [${c.role}] ${c.text}`).join("\n");
  const roles = claims.roles
    .map((r) => `- ${r.title} at ${r.employer} (${r.dates_as_written || "dates not stated"})`)
    .join("\n");
  return (
    `${tailorPrompt()}\n` +
    `===CANDIDATE-HEADER===\n${headerText.slice(0, 600) || "(none captured)"}\n\n` +
    `Roles:\n${roles}\n\nClaims:\n${claimLines}\n\n` +
    `===JOB-POSTING===\n${posting.title} at ${posting.company} (${posting.location})\n\n${posting.excerpt}\n`
  );
}

export async function tailorDraft(
  claims: CandidateClaims,
  posting: Posting,
  llm: LlmClient,
  headerText = "",
): Promise<Draft> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildTailorInput(claims, posting, headerText)
        : `${buildTailorInput(claims, posting, headerText)}\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const raw = await llm.complete(input);
    try {
      return Draft.parse(extractJson(raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new Error(`tailor output failed validation twice: ${lastError.slice(0, 500)}`);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const WATERMARK_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='280'>` +
    `<text x='50%' y='50%' font-family='Helvetica' font-size='26' fill='rgba(160,20,20,0.10)'` +
    ` text-anchor='middle' transform='rotate(-28 210 140)'>DRAFT — NOT VERIFIED</text></svg>`,
);

/** Render the one-page draft as a self-contained HTML document with the watermark burned in. */
export function renderPreviewHtml(draft: Draft, posting: Posting): string {
  const section = (title: string, body: string) =>
    body ? `<h2>${esc(title)}</h2>${body}` : "";
  const experience = draft.experience
    .map(
      (e) =>
        `<div class="role"><div class="role-head"><strong>${esc(e.role)}</strong> — ${esc(
          e.employer,
        )}<span class="dates">${esc(e.dates)}</span></div><ul>${e.bullets
          .map((b) => `<li>${esc(b)}</li>`)
          .join("")}</ul></div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Draft CV preview</title>
<meta name="robots" content="noindex">
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1d2126;max-width:720px;margin:0 auto;
    padding:40px 48px;line-height:1.45;font-size:14px;
    background-image:url("data:image/svg+xml,${WATERMARK_SVG}");}
  .banner{background:#fbeaea;border:1px solid #d99;color:#8a1f1f;font-family:Helvetica,Arial,sans-serif;
    font-size:12px;padding:8px 14px;border-radius:6px;margin-bottom:24px;}
  h1{font-size:24px;margin:0;}
  .headline{font-style:italic;color:#444;margin:2px 0 0;}
  .contact{color:#666;font-size:12px;margin:4px 0 0;font-family:Helvetica,Arial,sans-serif;}
  h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;border-bottom:1px solid #ccc;
    padding-bottom:3px;margin:22px 0 8px;font-family:Helvetica,Arial,sans-serif;}
  .role{margin-bottom:12px;}
  .role-head .dates{float:right;color:#666;font-size:12px;}
  ul{margin:4px 0 0;padding-left:18px;}
  li{margin-bottom:2px;}
  .skills{margin:0;}
</style></head><body>
<div class="banner">DRAFT — tailored for “${esc(posting.title)}” at ${esc(
    posting.company,
  )}. Facts not yet verified by the candidate; not for submission.</div>
<h1>${esc(draft.name)}</h1>
<p class="headline">${esc(draft.headline)}</p>
${draft.contact ? `<p class="contact">${esc(draft.contact)}</p>` : ""}
${section("Summary", `<p>${esc(draft.summary)}</p>`)}
${section("Professional experience", experience)}
${section("Skills", `<p class="skills">${draft.skills.map(esc).join(" · ")}</p>`)}
${section("Education", draft.education.map((e) => `<p>${esc(e)}</p>`).join(""))}
</body></html>`;
}

/** Pipeline step factory (JC-16). `minerOutput` is the mine step's `{doc}` payload. */
export function makePreviewStep(llm: LlmClient) {
  return async (minerOutput: unknown, targetTitles: string[], rawCv?: RawCv) => {
    const doc = (minerOutput as { doc: CandidateClaims }).doc;
    const posting = matchPosting(targetTitles);
    // Header (name/contact) isn't a "claim" — it's the CV's own letterhead. Feed the
    // contact/preamble blocks to the tailor so the draft carries the candidate's identity.
    const headerText = (rawCv?.blocks ?? [])
      .filter((b) => b.kind === "contact" || b.kind === "other")
      .slice(0, 2)
      .map((b) => b.text)
      .join("\n");
    const draft = await tailorDraft(doc, posting, llm, headerText);
    return {
      html: renderPreviewHtml(draft, posting),
      postingTitle: posting.title,
      postingCompany: posting.company,
    };
  };
}
