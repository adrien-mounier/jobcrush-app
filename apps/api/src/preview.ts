// JC-16 instant draft preview: pick 1 posting from the static curated set (title-keyword
// match — the real cluster engine is S3/JC-31), tailor a draft from the mined candidate
// claims via the ported tailor prompt, and render HTML with the watermark burned into the
// document itself (background + banner are part of the server render, not a UI overlay).
// PDF export is deliberately absent until the facts are verified (S3/JC-40).
//
// The draft schema, prompt, and renderer mirror the JobCrush engine's canonical CV structure
// (rules/cv-authoring.md): categorized skills, certifications as a first-class section, a
// 10-bullet-per-role rail spent on a newest-first ladder — not a cap-and-floor (#153/#158) —
// two-page budget. The conservation lint below enforces "tailor by emphasis, not amputation"
// for mined certifications and languages; every printed experience bullet carries the source
// claim id(s) it was built from, and conservationIssues() cross-checks every cited id against
// the real source claims, so a merge, a silent drop, and an invention are mechanically
// distinguishable — an id the tailor did not actually receive is flagged, not trusted.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SLUG, type CandidateClaims } from "@jobcrush/contracts";
import { extractJson } from "./miner.js";
import type { LlmClient } from "./llm.js";
import { EMAIL_RE, PHONE_RE, type RawCv } from "./extract.js";
import { detectLanguage, languageEligible, SERVED_LANGUAGES } from "./language.js";
import { incrementCounter } from "./counters.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface Posting {
  id: string;
  title: string;
  company: string;
  location: string;
  keywords: string[];
  excerpt: string;
  // #103: labelled at ingest (here, the pool's one entry point), local + deterministic, no model
  // call — so this keeps working unchanged once live retrieval (#99-#101) replaces this fixture.
  // A BCP-47 primary subtag ("en", "zh", ...) or "und" — see language.ts's detectLanguage doc.
  language: string;
}

// Fixture shape on disk: no language field (#86 decision 2 — the label is DERIVED at load, never
// hand-authored into the JSON, so a real provider feed gets labelled by the same code path).
type RawPosting = Omit<Posting, "language">;

let cachedPostings: Posting[] | null = null;
export function loadPostings(): Posting[] {
  if (!cachedPostings) {
    const raw = JSON.parse(
      readFileSync(join(here, "..", "data", "sample-postings.json"), "utf8"),
    ) as RawPosting[];
    // Counted once per posting HERE, at ingest — never at read time — so the counters can't inflate
    // with every deck request (#86 AC). The cache guard above makes this run exactly once per
    // process lifetime, same as the language label itself. "und" is counted separately from a real
    // non-served-language skip (#103 code review finding 3): a terse-but-genuinely-English excerpt
    // that can't be judged is a different operational signal from a confirmed Chinese/Japanese/...
    // advert, and folding them together would let slice 3's alarm miss the former as a "benign skip."
    cachedPostings = raw.map((p) => {
      const language = detectLanguage(p.excerpt);
      if (language === "und") incrementCounter("postings.language_undetermined");
      else if (!languageEligible(language, SERVED_LANGUAGES)) incrementCounter("postings.language_skipped");
      return { ...p, language };
    });
  }
  return cachedPostings;
}

/**
 * Postings a reader with `languages` may see — the ONE application of the language gate to the pool
 * (#86 AC4), reused by every caller rather than re-filtered ad hoc: session-scoped routes
 * (routes/onboarding.ts) pass a session's own readingLanguages(); pre-session paths (matchPosting
 * below) pass SERVED_LANGUAGES, since the pre-signup magic-mirror preview still picks and shows a
 * real advert and burns a real LLM call (#103 code review finding 1) even though there's no session
 * yet to read a list from. Lives beside loadPostings so slice 3's reader can reuse it without
 * importing a routes module.
 */
export function eligiblePostings(languages: string[], postings = loadPostings()): Posting[] {
  return postings.filter((p) => languageEligible(p.language, languages));
}

/** Title-keyword match: most overlapping keywords wins; ties go to the earlier posting. Defaults to
 *  the served-language pool (#103 code review finding 1/2) — this path has no session, so it can't
 *  ask a user's own languages and instead uses what the product currently serves. */
export function matchPosting(
  targetTitles: string[],
  postings = eligiblePostings(SERVED_LANGUAGES),
): Posting {
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

// A printed experience bullet carries the id(s) of the claim(s) it was built from — one id for a
// bullet drawn straight from a single claim, more than one when the tailor merged claims into one
// line. A bullet with no claim id fails validation here; conservationIssues() below then
// cross-checks every id against the real source claims, so a fabricated id (well-formed but
// never actually issued) is caught too, not just a missing one (#153, #158).
const ExperienceBullet = z.object({
  text: z.string().min(1),
  claimIds: z.array(z.string().regex(SLUG)).min(1),
});

export const Draft = z.object({
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
        // The rail is 10 — a guard rail, not a cap-and-floor. There is no separate per-role
        // minimum: a role with 2 good bullets prints 2 (docs/cv-brain/cv-authoring-rules.md,
        // "Length and bullet density").
        bullets: z.array(ExperienceBullet).min(1).max(10),
        // Candidate bullets the tailor chose not to print for this role, by claim id — kept, not
        // discarded, so a future "N more not shown" control (#157, out of scope here) has data to
        // work from.
        unprinted: z.array(z.string().min(1)).default([]),
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
  // Each line leads with the claim's own id so the tailor can cite it back in a printed
  // bullet's "claimIds" (#153, #158) — previously stripped here, which made a merge, a silent
  // drop, and an invention indistinguishable downstream.
  const claimLines = claims.claims.map((c) => `- ${c.id} [${c.role}] ${c.text}`).join("\n");
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

  // Claim-id provenance: every id a bullet or an "unprinted" list cites must be a real source
  // claim id. This is the actual mechanical check behind the header comment's claim — without
  // it, a tailor could cite a fabricated id (e.g. "made-up") and pass validation untouched.
  const realIds = new Set(claims.claims.map((c) => c.id));
  for (const role of draft.experience) {
    for (const b of role.bullets) {
      for (const id of b.claimIds) {
        if (!realIds.has(id)) {
          issues.push(
            `unknown claim id "${id}" cited by a bullet in "${role.role}" — every claimIds ` +
              `entry must be a real source claim id, never invented.`,
          );
        }
      }
    }
    for (const id of role.unprinted) {
      if (!realIds.has(id)) {
        issues.push(
          `unknown claim id "${id}" in "${role.role}"'s unprinted list — every unprinted ` +
            `entry must be a real source claim id, never invented.`,
        );
      }
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
        // Renders the bullet's human text only — claimIds/unprinted are provenance data for a
        // future control (#157), never shown on the page itself.
        `<ul>${e.bullets.map((b) => `<li>${esc(b.text)}</li>`).join("")}</ul></div>`
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

export interface StoredContact {
  phone: string | null;
  email: string | null;
}

const appendContactPart = (line: string, part: string) => (line ? `${line} · ${part}` : part);

// PHONE_SWAP_RE's char class is greedy across spaces/dashes/dots — it has to span "600 000 000" or
// "6.00.00.00.00" — so an ungoverned match can also eat a trailing separator before the next
// contact part. `trimTrailing` strips that noise off the match before substituting: the phone pass
// trims down to the last DIGIT (its whole match is separator-heavy by design), while the email pass
// keeps the default (trailing whitespace only) — an email match is already digit-sparse, so trimming
// to "last digit" would eat the entire local-part of a digit-free address ("jane@example.com" has no
// digit at all) and silently duplicate it instead of replacing it. `searchText` may differ from
// `text` (the phone pass searches a masked copy but splices into the real string, below).
function replaceMatch(
  text: string,
  searchText: string,
  re: RegExp,
  replacement: string,
  trimTrailing: RegExp = /\s+$/,
): string {
  const m = re.exec(searchText);
  if (!m) return text;
  const trimmedLength = m[0].replace(trimTrailing, "").length;
  return text.slice(0, m.index) + replacement + text.slice(m.index + trimmedLength);
}

// Code review must-fix: PHONE_RE (extract.ts's mine-time regex) matches ANY 8+ digit run, including
// digits inside an email local-part ("jane.12345678@example.com") — an ungoverned phone pass would
// splice the stored number into the middle of the address. Mask every email-shaped span to
// non-digit placeholders of the SAME length before the phone pass runs, so it structurally cannot
// see (and therefore cannot match) a single character that belongs to an email. Length-preserving
// means match indices found against the masked text point at the identical span in the real text.
const EMAIL_RE_GLOBAL = new RegExp(EMAIL_RE.source, "g");
const maskEmails = (text: string) => text.replace(EMAIL_RE_GLOBAL, (m) => "#".repeat(m.length));

// Code review must-fix 2: extract.ts's PHONE_RE has no dot separator, so a tailor that reformats the
// header phone as "+33.6.00.00.00.00" (a common French style) is invisible to it — the render pass
// would then find nothing to swap and APPEND the correction beside the unrecognised original,
// printing two phones. Widened HERE ONLY (never extract.ts's own PHONE_RE, which stays exact for
// mine-time parsing) so render-time swap-detection recognises more reformattings without loosening
// what gets captured as a person's canonical number.
// QA #190 blocking (extract.ts's PHONE_RE) applies symmetrically here: without a leading `\(?` a
// header phone written as "(852) 1234 5678" would match starting INSIDE the bracket, leaving a
// stray "(" behind after the swap. Same widening, same reasoning.
const PHONE_SWAP_RE = /\(?\+?\d[\d .()-]{7,}/;

/**
 * #190 render preference: swap the tailor's own header re-read of phone/email for the person's
 * stored, corrected values — the rest of the contact line (city, etc.) is untouched. Pure and
 * deterministic (regex substitution, no LLM call), so a corrected value provably wins every render,
 * never just "usually". A stored value with nothing to replace in the line is appended, not lost —
 * this is also how a value supplied for a CV that had none reaches the render, exactly like a
 * correction (ADR-0008 §3).
 */
export function applyStoredContact(contact: string, stored: StoredContact): string {
  let result = contact;
  if (stored.email) {
    result = EMAIL_RE.test(result)
      ? replaceMatch(result, result, EMAIL_RE, stored.email)
      : appendContactPart(result, stored.email);
  }
  if (stored.phone) {
    // Search on a masked copy (any email — the one just substituted, or an untouched original one
    // when stored.email is null — is never a valid phone-swap target) but splice into the REAL
    // string, so the substitution itself still carries the real surrounding characters.
    const masked = maskEmails(result);
    result = PHONE_SWAP_RE.test(masked)
      ? replaceMatch(result, masked, PHONE_SWAP_RE, stored.phone, /[^\d]+$/)
      : appendContactPart(result, stored.phone);
  }
  return result;
}

/** Pipeline step factory (JC-16). `minerOutput` is the mine step's `{doc}` payload. */
export function makePreviewStep(llm: LlmClient) {
  return async (minerOutput: unknown, targetTitles: string[], rawCv?: RawCv, contact?: StoredContact) => {
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
    if (contact) draft.contact = applyStoredContact(draft.contact, contact);
    return {
      html: renderPreviewHtml(draft, posting),
      postingTitle: posting.title,
      postingCompany: posting.company,
    };
  };
}
