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
import {
  SLUG,
  type AdRequirementsV1,
  type CandidateClaims,
  type PostingRetrievalResultV1,
} from "@jobcrush/contracts";
import type { JobBlockView } from "./jobBlockStore.js";
import { extractJson } from "./miner.js";
import type { LlmClient } from "./llm.js";
import { EMAIL_RE, PHONE_RE, type RawCv } from "./extract.js";
import { detectLanguage, languageEligible, SERVED_LANGUAGES } from "./language.js";
import { incrementCounter } from "./counters.js";
import type { SessionRecord } from "./sessions.js";
import { isReusableRetrievalSnapshot, sessionDeckIsAuthorized } from "./postingRetrieval.js";

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

/** The authoritative posting pool for one session — **retrieved live adverts and nothing else**.
 *
 * #63: this used to seed the pool from loadPostings() and let a live snapshot merge on top, so an
 * unauthorized session, a failed provider and a genuinely empty market all handed back the same 17
 * hand-maintained rows and the reveal counted them. That is the one thing #63's own context forbids
 * — *"fixtures … can never authorize reveal"* — and it made AC2 (the server refuses when a gate is
 * absent) and AC3 (no zero-match reward) false in the shipped product: every visitor's deck was
 * 100% fixtures with a confident "17 jobs just matched you" on top of it.
 *
 * So there is now exactly one way a posting reaches a session: a currently reusable, authorized,
 * relevant-postings snapshot. Every other state is an EMPTY pool, which is what the caller must
 * render an honest empty/waiting state from.
 *
 * What this costs, stated plainly rather than left to be discovered: a deployment with no working
 * provider now has NO deck at all, for anyone. `sample-postings.json` has a legitimate route back —
 * curated-pool's own driver serves those rows through the same gate as any provider
 * (postingRetrieval.ts's StoreBackedCuratedPostingProvider) — but that provider is operationally
 * disabled today (postings.ts's OPERATIONALLY_DISABLED_PROVIDER_IDS: it has no production
 * region-refresh caller), so in practice the live provider is the only source. That is the
 * deliberate trade — a dark deck is honest, a fixture deck presented as "17 jobs just matched you"
 * is not — and it is why the owner's "no dev-only fixture escape hatch" decision means a real
 * provider key, not a flag.
 *
 * #248: the reveal check belongs HERE, not only on the retrieval status the deck route reads. This
 * is the one door all three posting readers pass through — the deck, the want route and the tailor
 * target — so a guard here cannot be forgotten by a caller, and it is what keeps #246 honest: once
 * the promise fetches at question 1, a real relevant-postings snapshot exists BEFORE she has earned
 * anything, and only this stops it becoming her deck. */
export function sessionPostings(
  session: Pick<SessionRecord, "retrieval" | "discovery">,
  requestFingerprint: string,
): Posting[] {
  if (
    !sessionDeckIsAuthorized(session) ||
    !isReusableRetrievalSnapshot(session.retrieval, requestFingerprint)
  ) return [];
  return retrievedPostings(session.retrieval?.result ?? null);
}

/** The adverts one retrieval result actually delivered. Keyed by canonical identity so two providers
 *  describing the same advert cannot both become a card; the later row wins, matching the authority
 *  order retrieval already sorted them into. Any other outcome is an empty pool. */
export function retrievedPostings(result: PostingRetrievalResultV1 | null): Posting[] {
  if (result?.outcome !== "relevant_postings") return [];
  const byCanonicalKey = new Map<string, Posting>();
  for (const posting of result.postings) {
    byCanonicalKey.set(posting.canonicalKey, {
      id: posting.id,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      keywords: posting.skills,
      excerpt: posting.excerpt,
      language: posting.language,
    });
  }
  return [...byCanonicalKey.values()];
}

/** #246 — the number the discovery promise states: how many adverts THIS visitor's own search
 *  returned, counted through the same language gate her deck applies.
 *
 *  Takes a RESULT, not a session, and that is the safety property: there is no reveal check here
 *  (#248 — fetching postings and being allowed to SEE them are different decisions, and the promise
 *  is stated at question 1 before she has earned anything), so this must never be reachable from a
 *  stored snapshot the way `sessionPostings` is. Counting is not showing; it returns a number, never
 *  a card, and it can only count a result its caller already holds.
 *
 *  `null` for anything that is not a completed search, kept distinct from 0. Null means "we could
 *  not look" and the screen says nothing rather than a number it cannot stand behind.
 *
 *  What this number is, precisely, so the promise is not read as more than it says: the CATCH — the
 *  adverts her query returned, deduplicated and language-filtered. The deck applies more after this
 *  (withdrawal of expired adverts, and for a visitor with a search family, deletion of adverts that
 *  are not in it), so a mapped visitor's deck can be smaller than her promise. Her own search is
 *  what the owner chose to count (option 3, 2026-08-19); counting the post-filter deck instead would
 *  mean reading every advert with the model before she has answered anything. */
export function retrievedPostingCount(
  result: PostingRetrievalResultV1 | null,
  languages: string[],
): number | null {
  if (result?.outcome !== "relevant_postings") return null;
  return eligiblePostings(languages, retrievedPostings(result)).length;
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
  // #154: the result a multi-claim line keeps, and it must appear verbatim in `text`. Declaring it
  // in a field the page never prints would let a scope list pass the check, so conservationIssues()
  // checks containment, not presence. Absent/"" is correct for a single-claim bullet — the lane for
  // a merged bullet that omits it is the LOSSY one (ship + tell), never a parse failure, because a
  // person with a duty-only CV must still get a CV (#154 Q8).
  outcome: z.string().default(""),
});

export const Draft = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  contact: z.string().default(""),
  // A MISSING key must still fail parse — that's what drives the retry in tailorDraft() below.
  // Only an explicit "" ("nothing earns the section a place", cv-authoring-rules.md "Professional
  // Summary", #143/#159) is a deliberate omission; renderPreviewHtml() then omits the whole
  // section, heading included. z.string().default("") would also accept an ABSENT key, so a
  // truncated/retried response that drops the field would parse clean and ship a CV with no
  // summary, byte-identical to a correct omission (code review must-fix 1, #159).
  summary: z.string(),
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

// A job-block decision value is `unknown` once corrected — format tolerantly: MinedDate-shaped
// objects print as year (or month/year), strings print as themselves.
const fmtDateValue = (v: unknown): string => {
  if (v && typeof v === "object" && "year" in (v as Record<string, unknown>)) {
    const d = v as { year: number; month: number | null };
    return d.month ? `${String(d.month).padStart(2, "0")}/${d.year}` : String(d.year);
  }
  return String(v);
};
const fmtEndValue = (v: unknown): string => {
  const e = v as { state?: string; date?: unknown };
  if (e?.state === "ongoing") return "present";
  if (e?.state === "ended") return fmtDateValue(e.date);
  return "end not stated";
};

/** The stored-record role line the tailor is fed (ADR-0002: the corrected value is what the tailor
 *  receives — a JobBlockView's decision values already carry a person's corrections over the
 *  miner's read). Education blocks aren't work-history roles and stay out of the Roles: block. */
export function jobBlockRoleLines(jobBlocks: JobBlockView[]): string[] {
  return jobBlocks
    .filter((b) => b.kind !== "education")
    .map(
      (b) =>
        `- ${String(b.title.value)} at ${String(b.employer.value)} ` +
        `(${fmtDateValue(b.start.value)} - ${fmtEndValue(b.end.value)})`,
    );
}

export interface TailorInputOpts {
  /** #163: the stored, corrected job records. Non-empty ⇒ the Roles: block is built from these
   *  instead of the miner's original read, so a correction reaches every later CV. */
  jobBlocks?: JobBlockView[];
  /** #163 / ADR-0002 clause 4: the dimensions the advert gates on (blocking requirements from the
   *  ad-requirements store). A declared fact matching one must also rise into the summary. */
  advertTests?: string[];
}

export function buildTailorInput(
  claims: CandidateClaims,
  posting: Posting,
  headerText = "",
  opts: TailorInputOpts = {},
): string {
  // Each line leads with the claim's own id so the tailor can cite it back in a printed
  // bullet's "claimIds" (#153, #158) — previously stripped here, which made a merge, a silent
  // drop, and an invention indistinguishable downstream.
  const claimLines = claims.claims.map((c) => `- ${c.id} [${c.role}] ${c.text}`).join("\n");
  const roles = opts.jobBlocks?.length
    ? jobBlockRoleLines(opts.jobBlocks).join("\n")
    : claims.roles
        .map((r) => `- ${r.title} at ${r.employer} (${r.dates_as_written || "dates not stated"})`)
        .join("\n");
  const advertTests = opts.advertTests?.length
    ? `===ADVERT-TESTS===\nThis advert gates on:\n${opts.advertTests.map((t) => `- ${t}`).join("\n")}\n` +
      `A declared fact of the candidate's (a language, a certification, an "additional" entry) that ` +
      `matches one of these must ALSO be woven into the summary — it stays in its usual section too. ` +
      `Never invent a fact to satisfy a gate.\n\n`
    : "";
  return (
    `${tailorPrompt()}\n` +
    `===CANDIDATE-HEADER===\n${headerText.slice(0, 600) || "(none captured)"}\n\n` +
    `Roles:\n${roles}\n\nClaims:\n${claimLines}\n\n` +
    advertTests +
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

/** One lint finding, in both registers: `message` is retry feedback for the LLM; `visitor` is the
 *  plain-words version the person sees when the draft still ships lossy (ADR-0002 clause 5 — a
 *  console-only warning made the no-silent-loss rule unfalsifiable). */
export interface ConservationIssue {
  message: string;
  visitor: string;
  /** #154: this issue's visitor surface is the draft screen's per-job block, which says the same
   *  thing with the person's own profile wording beside it. Kept out of `conservationNotices` so
   *  the same sentence does not appear twice on one screen; it still drives the retry. */
  blockCovered?: true;
}

/**
 * Conservation lint — the "never destroy" gate. The tailor may rephrase, reorder, merge, and
 * emphasize for the posting; it may not silently delete a fact class the miner extracted — nor,
 * since #163, a fact the person declared or corrected (the stored job records). Returned issues
 * are fed back to the LLM on retry; a draft that still fails ships WITH its visitor notices
 * (the facts gate is the candidate's review — our failure is told, never hidden).
 */
export function conservationIssues(
  claims: CandidateClaims,
  draft: Draft,
  jobBlocks: JobBlockView[] = [],
  advertTests: string[] = [],
): ConservationIssue[] {
  const issues: ConservationIssue[] = [];

  const certs = claims.claims.filter(isCertClaim);
  if (certs.length > draft.certifications.length) {
    issues.push({
      message:
        `certifications lost: source has ${certs.length}, draft renders ${draft.certifications.length}. ` +
        `Every mined certification must appear in "certifications" (exact name + date).`,
      visitor:
        `Your CV lists ${certs.length} certification${certs.length === 1 ? "" : "s"} but only ` +
        `${draft.certifications.length} made it onto this draft. You can retry the draft or add the missing one when you review.`,
    });
  }

  const langs = claims.claims.filter(isLanguageClaim);
  if (langs.length > 0 && !draft.additional.some((a) => /language/i.test(a.label))) {
    issues.push({
      message:
        `languages lost: the source lists languages but "additional" has no Languages entry. ` +
        `Add { "label": "Languages", "value": "..." } with the candidate's languages verbatim.`,
      visitor:
        "Your languages could not be placed on this draft. You can retry the draft or add them when you review.",
    });
  }

  // #163 / ADR-0002 clause 5: a corrected fact is a declared fact — the lint watches it too. The
  // corrected value must be what prints, and the value it superseded must be gone.
  for (const block of jobBlocks) {
    if (block.kind === "education") continue;
    for (const [key, decision] of [
      ["title", block.title],
      ["employer", block.employer],
    ] as const) {
      if (decision.origin.kind !== "corrected" || typeof decision.value !== "string") continue;
      const corrected = decision.value.toLowerCase();
      const printed = draft.experience.some(
        (e) => e.role.toLowerCase().includes(corrected) || e.employer.toLowerCase().includes(corrected),
      );
      if (!printed) {
        issues.push({
          message:
            `corrected ${key} lost: the candidate corrected a role's ${key} to "${decision.value}" ` +
            `but no experience entry prints it. The corrected value is the true one and must print.`,
          visitor:
            `Your corrected ${key} "${decision.value}" is not on this draft. You can retry the draft or fix it when you review.`,
        });
      }
      const superseded = decision.origin.supersededValue;
      if (
        typeof superseded === "string" &&
        draft.experience.some(
          (e) =>
            e.role.toLowerCase() === superseded.toLowerCase() ||
            e.employer.toLowerCase() === superseded.toLowerCase(),
        )
      ) {
        issues.push({
          message:
            `superseded ${key} printed: "${superseded}" was corrected to "${decision.value}" by the ` +
            `candidate, but an experience entry still prints the old value. Print the corrected value.`,
          visitor:
            `This draft shows "${superseded}", but you corrected that to "${decision.value}". Retry the draft to pick up your correction.`,
        });
      }
    }
  }

  // #163 / ADR-0002 clause 4, made falsifiable: a declared language the advert tests must ALSO
  // appear in the summary, not only in its usual section — otherwise the promotion instruction is
  // a hint the tailor can silently ignore. Mechanical and narrow: only capitalized words from
  // language claims (language names are proper nouns — "Mandarin") that an advert-tested dimension
  // mentions. ponytail: word-match promotion check, languages only; widen per element as ADR-0001
  // elements land.
  if (advertTests.length > 0) {
    const testedText = advertTests.join(" ").toLowerCase();
    const summary = draft.summary.toLowerCase();
    for (const lang of claims.claims.filter(isLanguageClaim)) {
      for (const word of lang.text.match(/[A-Z][a-z]{3,}/g) ?? []) {
        if (!testedText.includes(word.toLowerCase())) continue;
        if (summary.includes(word.toLowerCase())) continue;
        issues.push({
          message:
            `advert-tested fact not promoted: the advert gates on "${word}" and the candidate declares ` +
            `it, but the summary does not mention it. Weave it into the summary (it stays in its usual section too).`,
          visitor: `This job tests for ${word}, which you have — but it is not in your draft's summary.`,
        });
      }
    }
  }

  // #163: a corrected start/end date must reach the printed entry for that job. Narrow on purpose:
  // only checked when an experience entry is identifiable by the block's employer — otherwise the
  // corrected-title/employer checks above already speak.
  for (const block of jobBlocks) {
    if (block.kind === "education") continue;
    const employer = typeof block.employer.value === "string" ? block.employer.value.toLowerCase() : "";
    const entries = employer
      ? draft.experience.filter((e) => e.employer.toLowerCase().includes(employer))
      : [];
    if (entries.length === 0) continue;
    for (const [key, decision] of [
      ["start", block.start],
      ["end", block.end],
    ] as const) {
      if (decision.origin.kind !== "corrected") continue;
      const v = decision.value as { year?: number; state?: string; date?: { year?: number } };
      const year = typeof v?.year === "number" ? v.year : v?.state === "ended" ? v.date?.year : undefined;
      if (year === undefined) continue;
      if (entries.some((e) => e.dates.includes(String(year)))) continue;
      issues.push({
        message:
          `corrected ${key} date lost: the candidate corrected this job's ${key} at "${block.employer.value}" ` +
          `to ${year}, but the printed dates do not carry it. The corrected date is the true one and must print.`,
        visitor: `Your corrected ${key} date (${year}) for ${block.employer.value} is not on this draft. Retry the draft to pick up your correction.`,
      });
    }
  }

  // Claim-id provenance: every id a bullet or an "unprinted" list cites must be a real source
  // claim id. This is the actual mechanical check behind the header comment's claim — without
  // it, a tailor could cite a fabricated id (e.g. "made-up") and pass validation untouched.
  const realIds = new Set(claims.claims.map((c) => c.id));
  for (const role of draft.experience) {
    for (const b of role.bullets) {
      for (const id of b.claimIds) {
        if (!realIds.has(id)) {
          issues.push({
            message:
              `unknown claim id "${id}" cited by a bullet in "${role.role}" — every claimIds ` +
              `entry must be a real source claim id, never invented.`,
            visitor: `One line under "${role.role}" could not be traced back to your CV — check it before sending.`,
          });
        }
      }
    }
    for (const id of role.unprinted) {
      if (!realIds.has(id)) {
        issues.push({
          message:
            `unknown claim id "${id}" in "${role.role}"'s unprinted list — every unprinted ` +
            `entry must be a real source claim id, never invented.`,
          visitor: `One held-back line under "${role.role}" could not be traced back to your CV.`,
        });
      }
    }
  }

  // #208 division guards. Printing ONE claim as TWO bullets is legal — it is how a compound CV line
  // reaches a posting that tests two of its actions — but unlike a merge it declares nothing, so
  // without these two limits it is unchecked in both directions (ADR-0012 clause 4a). Counted PER
  // ROLE on purpose: the same fact printed under two different job headings is #207's open question,
  // not a division, and must not be flagged as one here.
  //   (1) At most TWO bullets per claim. Three lines out of one source line is padding on its face,
  //       and padding is the shape splitting newly made possible.
  //   (2) A split claims completeness — "I am rendering this whole line across two bullets" — so the
  //       claim's own numbers must survive somewhere across them. Numbers are the cheapest honest
  //       proxy for the result a division must not amputate (same technique as audit.ts's
  //       no-new-facts guard). Applied ONLY when every citing bullet is single-claim: once a merge
  //       is involved, #154 below owns the line and deliberately guarantees just ONE surviving
  //       result, so demanding all of them here would fire on lines that rule calls fine.
  // ⚠️ Honest limit, kept out of the docs' promises: a result carrying no digit ("strengthening
  // customer security") is invisible to this check. Covering that needs a division to declare what
  // it dropped, which is its own ticket, not a patch.
  const numbersIn = (s: string) => s.match(/\d+(?:[.,]\d+)*/g) ?? [];
  for (const role of draft.experience) {
    const citedBy = new Map<string, { text: string; single: boolean }[]>();
    for (const b of role.bullets) {
      for (const id of new Set(b.claimIds)) {
        const entry = { text: b.text, single: b.claimIds.length === 1 };
        const seen = citedBy.get(id);
        if (seen) seen.push(entry);
        else citedBy.set(id, [entry]);
      }
    }
    for (const [id, printedAs] of citedBy) {
      if (printedAs.length < 2) continue;
      const claim = claims.claims.find((c) => c.id === id);
      if (!claim) continue; // a fabricated id is already reported by the provenance loop above
      if (printedAs.length > 2) {
        issues.push({
          message:
            `"${role.role}": claim "${id}" is printed on ${printedAs.length} separate bullets. One ` +
            `source line may split into at most two — beyond that it is padding the role, not ` +
            `serving the posting. Print two and hold the rest back in "unprinted".`,
          visitor:
            `One line from your CV was spread across ${printedAs.length} bullets under ` +
            `"${role.role}". Check that section before you send this draft.`,
        });
      }
      if (!printedAs.every((b) => b.single)) continue;
      const printed = printedAs.map((b) => b.text).join(" ");
      const lost = numbersIn(claim.text).filter((n) => !printed.includes(n));
      if (lost.length > 0) {
        issues.push({
          message:
            `"${role.role}": claim "${id}" is split across ${printedAs.length} bullets but ${lost.join(", ")} ` +
            `from "${claim.text.slice(0, 120)}" appears on none of them. Splitting a line renders it ` +
            `in full — keep its figures, or print the claim as one bullet instead.`,
          visitor:
            `A line from your CV was split into ${printedAs.length} bullets and "${lost[0]}" from it did not ` +
            `make either one. Check that line before you send this draft.`,
        });
      }
    }
  }

  // #154: the merge/outcome arbitration. Two failures, ONE issue per bullet — a line that trips
  // both would otherwise produce two near-identical notices about one sentence.
  //   (1) a line built from >1 claim must keep a result, and the declared result must appear
  //       verbatim in the printed text (a result named in a field the page never prints is a
  //       result the employer never reads);
  //   (2) a line built from 4+ claims is squished on its face. The RULE is two
  //       (cv-authoring-rules.md); the ALARM is four, because a false warning costs the reader's
  //       trust in every true one. (#208 ended atomic mining — a claim now holds a whole printed
  //       line — so the "three is often one sentence reassembled" reason is gone; the gap was kept
  //       on the false-alarm argument alone.)
  // The reverse shape is deliberately NOT an issue: ONE claim id cited by TWO bullets is the tailor
  // splitting a compound claim at writing time (#208), each bullet single-claim, so neither trips
  // the check below. A division is guarded instead by the #208 block above — a two-bullet cap and a
  // numbers-survive check — because it declares no `outcome` for this one to read. What that block
  // cannot see is a result with no digit in it; that gap is ADR-0012 clause 4a and its own ticket.
  // Honest limit: this guarantees ONE surviving result per line, not all of them. The rest of the
  // loss is disclosed by draftDisclosure() below, not prevented.
  for (const role of draft.experience) {
    for (const b of role.bullets) {
      if (b.claimIds.length < 2) continue;
      const outcome = b.outcome.trim();
      const lostResult = outcome === "" || !b.text.toLowerCase().includes(outcome.toLowerCase());
      const tooMany = b.claimIds.length >= 4;
      if (!lostResult && !tooMany) continue;
      const n = b.claimIds.length;
      issues.push({
        blockCovered: true,
        message: lostResult
          ? `"${role.role}": the bullet "${b.text.slice(0, 120)}" combines ${n} claims ` +
            `(${b.claimIds.join(", ")}) but ` +
            (outcome === ""
              ? `declares no surviving outcome.`
              : `its declared outcome "${outcome}" is not in the bullet's own text.`) +
            ` Rewrite it so the result is IN the sentence, or print one claim and put the ` +
            `other id(s) in "unprinted" — never invent a result.`
          : `"${role.role}": the bullet "${b.text.slice(0, 120)}" combines ${n} claims ` +
            `(${b.claimIds.join(", ")}). The rule is two. Print the claims this posting most ` +
            `rewards whole and put the rest in "unprinted".`,
        visitor: lostResult
          ? `We could not fit ${n} facts from your profile into one line under "${role.role}" ` +
            `and keep what they achieved. Check that line before you send this draft.`
          : `We packed ${n} facts from your profile into one line under "${role.role}". A line ` +
            `carrying this much loses detail. Check it before you send this draft.`,
      });
    }
  }

  return issues;
}

/** #154: what one job block on the draft screen has to say for itself. Only jobs with something to
 *  disclose appear — "your profile holds N facts, they cannot all print" is a false statement about
 *  a job that printed everything. */
export interface JobDisclosure {
  employer: string;
  role: string;
  /** Facts the profile holds about this job — the denominator the person is shown. */
  factCount: number;
  /** Held-back facts in the profile's OWN wording, never shortened: trimming a person's own
   *  sentence to fit a panel misrepresents what they wrote (#154 Q10). */
  heldBack: string[];
  /** Printed lines carrying more than one fact that we owe an explanation for. */
  overfull: { text: string; count: number; lostResult: boolean; sources: string[] }[];
}

/**
 * #154: the disclosure behind each job on the draft screen. A choice (facts held back for this
 * posting) and a fault (a line that took on too much) are explained differently and deliberately —
 * dressing the fault up as a relevance decision is the very thing ADR-0004 clause 1 forbids.
 */
export function draftDisclosure(claims: CandidateClaims, draft: Draft): JobDisclosure[] {
  const byId = new Map(claims.claims.map((c) => [c.id, c.text]));
  const resolve = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((t): t is string => typeof t === "string");
  return draft.experience
    .map((role) => {
      // The miner writes a claim's `role` as "employer + title as written", so the employer
      // substring is the only stable join back to a printed entry — the same match
      // conservationIssues() already uses for corrected job blocks above. When it finds nothing
      // (a reworded employer), fall back to the ids this entry itself accounts for, so the count
      // shown is never smaller than the lists under it.
      const employer = role.employer.trim().toLowerCase();
      const owned = employer
        ? claims.claims.filter((c) => c.role.toLowerCase().includes(employer)).length
        : 0;
      const accounted = new Set([...role.bullets.flatMap((b) => b.claimIds), ...role.unprinted]);
      const overfull = role.bullets
        .filter((b) => b.claimIds.length >= 2)
        .map((b) => {
          const outcome = b.outcome.trim();
          return {
            text: b.text,
            count: b.claimIds.length,
            lostResult: outcome === "" || !b.text.toLowerCase().includes(outcome.toLowerCase()),
            sources: resolve(b.claimIds),
          };
        })
        // Same thresholds as conservationIssues() above: a result that did not print, or four.
        .filter((b) => b.lostResult || b.count >= 4);
      return {
        employer: role.employer,
        role: role.role,
        factCount: Math.max(owned, accounted.size),
        heldBack: resolve(role.unprinted),
        overfull,
      };
    })
    .filter((d) => d.heldBack.length > 0 || d.overfull.length > 0);
}

export interface TailoredDraft {
  draft: Draft;
  /** Plain-words notices for the person when the draft shipped lossy after retry — empty on a
   *  clean draft. ADR-0002 clause 5: our failures are visible to the visitor, never console-only. */
  conservationNotices: string[];
}

export async function tailorDraft(
  claims: CandidateClaims,
  posting: Posting,
  llm: LlmClient,
  headerText = "",
  opts: TailorInputOpts = {},
): Promise<TailoredDraft> {
  let lastError = "";
  let fallback: Draft | null = null;
  let fallbackNotices: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildTailorInput(claims, posting, headerText, opts)
        : `${buildTailorInput(claims, posting, headerText, opts)}\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const raw = await llm.complete(input);
    let draft: Draft;
    try {
      draft = Draft.parse(extractJson(raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
      continue;
    }
    const issues = conservationIssues(claims, draft, opts.jobBlocks ?? [], opts.advertTests ?? []);
    if (issues.length === 0) return { draft, conservationNotices: [] };
    fallback = draft;
    fallbackNotices = issues.filter((i) => !i.blockCovered).map((i) => i.visitor);
    lastError = issues.map((i) => i.message).join("\n");
  }
  if (fallback) {
    // Schema-valid but conservation-lossy after retry: ship it, tell the visitor (the notices
    // travel with the draft), and keep the ops-side warning for observability.
    console.warn(`[preview] draft ships with conservation issues:\n${lastError}`);
    return { draft: fallback, conservationNotices: fallbackNotices };
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
 * (_docx_build/build_cv.mjs): Calibri, #1F4E79 accent, left-aligned two-line header (name, then
 * role + contact folded onto one line, #157 item 1 variant C "one spine" — binding on #159),
 * uppercase bordered section heads, bold employer + italic role title, categorized skills.
 * Sections with no content (certifications, education, additional, and summary when nothing
 * earns it a place) are omitted entirely, heading included — never a heading over nothing.
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
    padding:34px 44px 36px;line-height:1.4;font-size:14px;${
      watermark ? `\n    background-image:url("data:image/svg+xml,${WATERMARK_SVG}");` : ""
    }}
  .banner{background:#fbeaea;border:1px solid #d99;color:#8a1f1f;
    font-size:12px;padding:8px 14px;border-radius:6px;margin-bottom:24px;}
  h1{font-size:23px;margin:0;color:#1F4E79;text-align:left;letter-spacing:.01em;}
  .headline{font-weight:normal;text-transform:none;text-align:left;margin:5px 0 0;font-size:12.5px;color:#444;}
  .headline .role-word{font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#1d2126;}
  h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#1F4E79;
    border-bottom:1.5px solid #1F4E79;padding-bottom:3px;margin:18px 0 7px;}
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
<p class="headline"><span class="role-word">${esc(draft.headline)}</span>${
  draft.contact ? ` - ${esc(draft.contact)}` : ""
}</p>
${draft.summary.trim() ? section("Professional Summary", `<p>${esc(draft.summary)}</p>`) : ""}
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

export interface PreviewStepExtras {
  /** #163 / ADR-0002 clause 4: a presentation read of the ad-requirements store — which dimensions
   *  the matched posting gates on. Optional; a missing/failed read just means no promotion hint. */
  getAdRequirements?: (adId: string) => Promise<{ requirements: AdRequirementsV1 } | null>;
}

/** Pipeline step factory (JC-16). `minerOutput` is the mine step's `{doc}` payload. */
export function makePreviewStep(llm: LlmClient, extras: PreviewStepExtras = {}) {
  return async (
    minerOutput: unknown,
    targetTitles: string[],
    rawCv?: RawCv,
    contact?: StoredContact,
    jobBlocks?: JobBlockView[],
  ) => {
    const doc = (minerOutput as { doc: CandidateClaims }).doc;
    const posting = matchPosting(targetTitles);
    // Header (name/contact) isn't a "claim" — it's the CV's own letterhead. Feed the
    // contact/preamble blocks to the tailor so the draft carries the candidate's identity.
    const headerText = (rawCv?.blocks ?? [])
      .filter((b) => b.kind === "contact" || b.kind === "other")
      .slice(0, 2)
      .map((b) => b.text)
      .join("\n");
    // Which dimensions the advert gates on — best-effort: a failed store read never fails a preview.
    let advertTests: string[] | undefined;
    if (extras.getAdRequirements) {
      try {
        const record = await extras.getAdRequirements(posting.id);
        advertTests = record?.requirements.requirements
          .filter((r) => r.kind === "blocking")
          .map((r) => r.requirement);
      } catch (err) {
        console.warn("[preview] ad-requirements read failed; tailoring without advert-tested dimensions", err);
        advertTests = undefined;
      }
    }
    const { draft, conservationNotices } = await tailorDraft(doc, posting, llm, headerText, {
      jobBlocks,
      advertTests,
    });
    if (contact) draft.contact = applyStoredContact(draft.contact, contact);
    return {
      html: renderPreviewHtml(draft, posting),
      postingTitle: posting.title,
      postingCompany: posting.company,
      conservationNotices,
      // #154: the per-job block. Built here, where the claims are still in hand — the browser only
      // ever receives the finished document, so a claim id it was handed instead would be
      // unresolvable and the disclosure would be a list of slugs.
      disclosure: draftDisclosure(doc, draft),
    };
  };
}
