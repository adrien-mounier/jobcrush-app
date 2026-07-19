// JC-16 instant draft preview: pick 1 posting from the static curated set (title-keyword
// match — the real cluster engine is S3/JC-31), tailor a draft from the mined candidate
// claims via the ported tailor prompt, and render HTML with the watermark burned into the
// document itself (background + banner are part of the server render, not a UI overlay).
// PDF export is deliberately absent until the facts are verified (S3/JC-40).
//
// The draft schema, prompt, and renderer mirror the JobCrush engine's canonical CV structure
// (rules/cv-authoring.md): categorized skills, certifications as a first-class section,
// bullet caps 4-6 (8 for the current role), two-page budget. The conservation lint below
// enforces "tailor by emphasis, not amputation": mined certifications, languages, and the
// current role's bullet density may never silently disappear from the draft.
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
        location: z.string().default(""),
        dates: z.string().default(""),
        bullets: z.array(z.string()).min(1).max(8),
      }),
    )
    .min(1)
    .max(10),
  skills: z
    .array(z.object({ label: z.string().min(1), items: z.array(z.string().min(1)).min(1) }))
    .min(1)
    .max(4),
  certifications: z
    .array(z.object({ name: z.string().min(1), date: z.string().default("") }))
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string().min(1),
        detail: z.string().default(""),
        dates: z.string().default(""),
      }),
    )
    .default([]),
  additional: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).default([]),
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

// Prefix-first (the miner tags cert-/lang- ids); the text fallback only applies to
// profile-level claims so an education block ("Leaving Certificate") or an experience bullet
// ("led the PCI certification audit") never counts as a lost certification.
const isCertClaim = (c: { id: string; text: string; role: string }) =>
  c.id.startsWith("cert-") || (c.role === "profile" && /\bcertif/i.test(c.text));
const isLanguageClaim = (c: { id: string; text: string; role: string }) =>
  c.id.startsWith("lang-") ||
  (c.role === "profile" &&
    (/\blanguages?\b|\bspeaker\b/i.test(c.text) ||
      /\((native|fluent|conversational|proficient|bilingual|basic)\)/i.test(c.text)));

/**
 * Conservation lint — the "never destroy" gate. The tailor may rephrase, reorder, merge, and
 * emphasize for the posting; it may not silently delete a fact class the miner extracted.
 * Returned issues are fed back to the LLM on retry; a draft that still fails ships with a
 * console warning rather than failing the job (the facts gate is the candidate's review).
 */
export function conservationIssues(claims: CandidateClaims, draft: Draft): string[] {
  const issues: string[] = [];

  const certs = claims.claims.filter(isCertClaim);
  if (certs.length > draft.certifications.length) {
    issues.push(
      `certifications lost: source has ${certs.length}, draft renders ${draft.certifications.length}. ` +
        `Every mined certification must appear in "certifications" (exact name + date).`,
    );
  }

  const langs = claims.claims.filter(isLanguageClaim);
  if (langs.length > 0 && !draft.additional.some((a) => /language/i.test(a.label))) {
    issues.push(
      `languages lost: the source lists languages but "additional" has no Languages entry. ` +
        `Add { "label": "Languages", "value": "..." } with the candidate's languages verbatim.`,
    );
  }

  // Current-role bullet floor: the most recent role must keep its density (up to the cap of 8).
  // Halving a strong recent role is the single biggest quality regression a tailor can make.
  const recent = claims.roles[0];
  if (recent) {
    const key = (s: string) => s.toLowerCase().slice(0, 12);
    const sourceBullets = claims.claims.filter(
      (c) =>
        c.role.toLowerCase().includes(key(recent.employer)) &&
        c.role.toLowerCase().includes(key(recent.title)),
    ).length;
    const entry = draft.experience.find((e) =>
      e.employer.toLowerCase().includes(key(recent.employer)),
    );
    const floor = Math.min(6, sourceBullets);
    if (entry && entry.bullets.length < floor) {
      issues.push(
        `current role too thin: "${recent.title}" has ${entry.bullets.length} bullets but the ` +
          `source supports ${sourceBullets}. Render at least ${floor} (up to 8) — merge weak ` +
          `bullets instead of dropping them.`,
      );
    }
  }

  return issues;
}

export async function tailorDraft(
  claims: CandidateClaims,
  posting: Posting,
  llm: LlmClient,
  headerText = "",
): Promise<Draft> {
  let lastError = "";
  let fallback: Draft | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildTailorInput(claims, posting, headerText)
        : `${buildTailorInput(claims, posting, headerText)}\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const raw = await llm.complete(input);
    let draft: Draft;
    try {
      draft = Draft.parse(extractJson(raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
      continue;
    }
    const issues = conservationIssues(claims, draft);
    if (issues.length === 0) return draft;
    fallback = draft;
    lastError = issues.join("\n");
  }
  if (fallback) {
    // Schema-valid but conservation-lossy after retry: ship it and flag, don't fail the job.
    console.warn(`[preview] draft ships with conservation issues:\n${lastError}`);
    return fallback;
  }
  throw new Error(`tailor output failed validation twice: ${lastError.slice(0, 500)}`);
}

/** Engine glyph hygiene (rules/cv-authoring.md): no em/en dashes, ellipses, or pipes. */
const cleanGlyphs = (s: string) =>
  s
    .replace(/[–—]/g, "-")
    .replace(/…/g, ".")
    .replace(/\s*\|\s*/g, " · ");

const esc = (s: string) =>
  cleanGlyphs(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const WATERMARK_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='280'>` +
    `<text x='50%' y='50%' font-family='Helvetica' font-size='26' fill='rgba(160,20,20,0.10)'` +
    ` text-anchor='middle' transform='rotate(-28 210 140)'>DRAFT — NOT VERIFIED</text></svg>`,
);

/**
 * Render the draft as a self-contained HTML document styled like the engine's DOCX output
 * (_docx_build/build_cv.mjs): Calibri, #1F4E79 accent, centered header, uppercase bordered
 * section heads, bold employer + italic role title, categorized skills. Sections with no
 * content (certifications, education, additional) are omitted entirely.
 */
export function renderPreviewHtml(
  draft: Draft,
  posting: Posting,
  opts: { watermark?: boolean } = {},
): string {
  const watermark = opts.watermark ?? true;
  const section = (title: string, body: string) =>
    body ? `<h2>${esc(title)}</h2>${body}` : "";

  const experience = draft.experience
    .map((e) => {
      const employer = e.location ? `${e.employer}, ${e.location}` : e.employer;
      return (
        `<div class="role"><div class="role-head"><strong>${esc(employer)}</strong>` +
        `<span class="dates">${esc(e.dates)}</span></div>` +
        `<div class="role-title">${esc(e.role)}</div>` +
        `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`
      );
    })
    .join("");

  const skills = draft.skills
    .map(
      (g) =>
        `<p class="skill-group"><strong>${esc(g.label)}</strong><br>${g.items
          .map(esc)
          .join(", ")}</p>`,
    )
    .join("");

  const certifications = draft.certifications
    .map(
      (c) =>
        `<div class="cert"><span>${esc(c.name)}</span><span class="dates">${esc(
          c.date,
        )}</span></div>`,
    )
    .join("");

  const education = draft.education
    .map(
      (e) =>
        `<p class="edu"><strong>${esc(e.institution)}</strong>${
          e.dates ? `, ${esc(e.dates)}` : ""
        }${e.detail ? `<br>${esc(e.detail)}` : ""}</p>`,
    )
    .join("");

  const additional = draft.additional
    .map((a) => `<p class="addl"><strong>${esc(a.label)}:</strong> ${esc(a.value)}</p>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Draft CV preview</title>
<meta name="robots" content="noindex">
<style>
  body{font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1d2126;max-width:760px;margin:0 auto;
    padding:36px 44px;line-height:1.4;font-size:14px;${
      watermark ? `\n    background-image:url("data:image/svg+xml,${WATERMARK_SVG}");` : ""
    }}
  .banner{background:#fbeaea;border:1px solid #d99;color:#8a1f1f;
    font-size:12px;padding:8px 14px;border-radius:6px;margin-bottom:24px;}
  h1{font-size:26px;margin:0;color:#1F4E79;text-align:center;}
  .headline{font-weight:bold;text-transform:uppercase;text-align:center;margin:4px 0 0;font-size:14px;}
  .contact{color:#444;font-size:12px;margin:4px 0 0;text-align:center;}
  h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#1F4E79;
    border-bottom:1.5px solid #1F4E79;padding-bottom:3px;margin:20px 0 8px;}
  .role{margin-bottom:12px;}
  .role-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;}
  .dates{color:#5A6675;font-size:12px;white-space:nowrap;}
  .role-title{font-style:italic;margin:1px 0 2px;}
  ul{margin:4px 0 0;padding-left:18px;}
  li{margin-bottom:2px;}
  .skill-group{margin:0 0 8px;}
  .cert{display:flex;justify-content:space-between;gap:12px;margin-bottom:3px;}
  .edu,.addl{margin:0 0 6px;}
  /* Fit-to-width on phones: viewport meta reflows to the iframe width; trim the page
     margins so the content isn't cramped by the desktop padding. */
  @media (max-width:600px){body{padding:20px 16px;}}
</style></head><body>
${
  watermark
    ? `<div class="banner">DRAFT — tailored for “${esc(posting.title)}” at ${esc(
        posting.company,
      )}. Facts not yet verified by the candidate; not for submission.</div>\n`
    : ""
}<h1>${esc(draft.name)}</h1>
<p class="headline">${esc(draft.headline)}</p>
${draft.contact ? `<p class="contact">${esc(draft.contact)}</p>` : ""}
${section("Summary", `<p>${esc(draft.summary)}</p>`)}
${section("Professional Experience", experience)}
${section("Skills", skills)}
${section("Certifications", certifications)}
${section("Education", education)}
${section("Additional Information", additional)}
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
