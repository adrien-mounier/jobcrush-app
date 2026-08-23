// Thin client for the S1 API. Everything goes through the /api rewrite (same-origin),
// so the httpOnly session cookie rides along automatically.

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    // Only advertise a JSON body when we actually send one. Fastify rejects an empty body that
    // carries content-type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY) — which is what our
    // no-body POSTs are (upload /complete, deck confirm/reject, build).
    headers: {
      ...(init?.body != null ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const envelope = (body as { error?: { code?: string; message?: string } }).error;
    const err = new Error(envelope?.message ?? res.statusText) as Error & { code?: string };
    err.code = envelope?.code; // callers branch on this (e.g. login_required → the wall)
    throw err;
  }
  return body as T;
}

export async function ensureSession(): Promise<void> {
  const me = await fetch("/api/sessions/me");
  if (me.ok) return;
  const created = await fetch("/api/sessions/anonymous", { method: "POST" });
  if (!created.ok) throw new Error("could not start a session — please try again");
}

export function saveTargetTitles(targetTitles: string[]): Promise<{ ok: boolean }> {
  return jfetch("/api/sessions/me/targets", {
    method: "PUT",
    body: JSON.stringify({ targetTitles }),
  });
}

// #15 front door → discovery handoff (both the Ready? path and the CV path land here).
export function setStage(stage: "front-door" | "discovery"): Promise<{ ok: boolean }> {
  return jfetch("/api/sessions/me/stage", {
    method: "PUT",
    body: JSON.stringify({ stage }),
  });
}

export async function uploadCv(file: File): Promise<{ jobId: string }> {
  const created = await jfetch<{ id: string; putUrl: string }>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ filename: file.name }),
  });
  // R2 presigns an absolute bucket URL (browser PUTs straight to storage); the local-disk
  // driver returns an API-relative path that goes through the /api proxy.
  const target = created.putUrl.startsWith("http") ? created.putUrl : `/api${created.putUrl}`;
  const put = await fetch(target, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  });
  if (!put.ok) {
    const body = await put.json().catch(() => ({}));
    throw new Error(
      (body as { error?: { message?: string } }).error?.message ?? "upload failed",
    );
  }
  const complete = await jfetch<{ jobId: string | null }>(
    `/api/uploads/${created.id}/complete`,
    { method: "POST" },
  );
  if (!complete.jobId) throw new Error("upload accepted but no job started");
  return { jobId: complete.jobId };
}

export function pasteCv(text: string): Promise<{ jobId: string }> {
  return jfetch("/api/cv/paste", { method: "POST", body: JSON.stringify({ text }) });
}

export interface JobSnapshot {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  progress: {
    feed?: string[];
    importProof?: ImportProof;
    [k: string]: unknown;
  };
}

export interface ImportProof {
  outcome: "success" | "partial" | "failed" | "no_useful_facts";
  usefulFactCount: number;
  skippedQuestionCount: number;
  representativeFacts: Array<{
    id: string;
    text: string;
    provenance: "cv";
  }>;
  conflict: null | {
    fieldId: string;
    label: string;
    userResolvedValue: string | null;
  };
}

export function saveImportResolution(fieldId: string, value: string) {
  return jfetch<{ importProof: ImportProof }>("/api/sessions/me/import-resolution", {
    method: "PUT",
    body: JSON.stringify({ fieldId, value }),
  });
}

// --- S2 onboarding deck (JC-21/22/27/31) ---

export interface DeckClaim {
  id: string;
  text: string;
  role: string; // employer+title as written, or "profile" — batch claims group by this
  source_quote: string;
  machine_touch: "verbatim" | "reworded" | "inferred";
  classification: "Verified" | "Derived" | "Partially-Supported";
  decision: "pending" | "confirmed" | "rejected";
  origin: "mined" | "user-authored";
  tier: "individual" | "batch"; // JC-22: verbatim → batch, machine-touched → individual
}

export interface DeckState {
  stage: "deck" | "ready" | "loopback";
  claims: DeckClaim[];
}

// One rendered CV line + the confirmed claim(s) behind it — the review's "fix this" pointers
// (kickoff decision 7): a fix reopens the claim via editClaim/rejectClaim, never edits the CV text.
export interface TraceEntry {
  bullet: string;
  section: string;
  nodeIds: string[];
  classifications: string[];
}

export interface BuildResult {
  stage: "ready" | "loopback";
  gate: { ok: boolean; errors: string[] };
  rootCv: { markdown: string; trace: { entries: TraceEntry[] } };
}

export function openDeck(jobId: string): Promise<DeckState> {
  return jfetch("/api/onboarding/deck", { method: "POST", body: JSON.stringify({ jobId }) });
}

export function confirmClaim(id: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/onboarding/claims/${id}/confirm`, { method: "POST" });
}

export function rejectClaim(id: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/onboarding/claims/${id}/reject`, { method: "POST" });
}

export function editClaim(id: string, text: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/onboarding/claims/${id}`, { method: "PUT", body: JSON.stringify({ text }) });
}

export function buildRootCv(): Promise<BuildResult> {
  return jfetch("/api/onboarding/build", { method: "POST" });
}

export interface GrillQuestion {
  gapId: string;
  type: "missing-dates" | "needs-info";
  question: string;
}

export function openGrill(jobId: string): Promise<{ stage: string; questions: GrillQuestion[] }> {
  return jfetch("/api/onboarding/grill", { method: "POST", body: JSON.stringify({ jobId }) });
}

export function answerGrill(jobId: string, gapId: string, answer: string): Promise<{ ok: boolean }> {
  return jfetch("/api/onboarding/grill/answer", {
    method: "POST",
    body: JSON.stringify({ jobId, gapId, answer }),
  });
}

// --- S3 discovery (screen 1a, #16): Q1 (free-text role) -> promise -> tap-first floor loop.
// composeCvLine runs server-side — every cvLines entry below arrives already composed; the
// client only decides when to reveal it (ticket #16's reconciliation note).

export type CvSection = "summary" | "experience" | "skills" | "education";

// #106: an eligibility ask — a fact that doesn't vary by advert (years in the role, work rights,
// language, a certification, a degree), asked once and reused across every posting (CONTEXT.md
// "Eligibility fact"). `declineOption` is always the last entry of `options` — "not answering" is a
// first-class, always-available choice, never a forced pick.
export interface EligibilityAsk {
  dimension: "years-experience" | "work-rights" | "language" | "certification" | "degree";
  familyId: string; // the pinned family id, or "*" when the question holds regardless of role
  scopeLabel: string | null; // e.g. "IT project delivery"; null when global
  declineOption: string; // the exact option string meaning "not answering"
}

export interface DiscoveryQuestion {
  itemId: string;
  question: string;
  options: string[]; // may be empty — a free-text floor item (never empty when `eligibility` is set)
  cvSection: CvSection;
  eligibility?: EligibilityAsk; // present ⇔ this is an eligibility question, not a CV-line floor item
  // #123: the language question only. Typed locally (not yet added to the shared contract) — its
  // presence is the client's branch into the checkbox-group UI (design spec §1).
  multiSelect?: true;
  // #165: `options` are COMPLETIONS, not the legal answers — the person may keep a word none of them
  // offered, and the client renders a type-ahead rather than a checkbox list.
  typeAhead?: true;
  // #123: the consequence of leaving an option unticked, stated in the question itself (AC5).
  // Rendered at full ink weight, never muted like `.sub` — see eligibilitySub's exclusion below.
  consequence?: string;
}

export interface DiscoveryCvLine {
  itemId: string; // "role" = the CV lead line; anything else is a section body line
  section: CvSection;
  text: string;
}

// #246: a number and nothing else — how many adverts HER OWN search returned. The sentence around
// it names no job family and no place, so neither is sent; `promise: null` is the server saying it
// could not count, and the line is dropped rather than shown without one.
export interface DiscoveryPromise {
  count: number;
}

export interface DiscoveryState {
  stage: "discovery" | "deck"; // "deck" once the essential band is fully asked (#18) — the client
  // shows the handoff placeholder and nothing else; the reveal itself is #19's.
  role: string | null;
  family: string | null;
  city: string | null;
  promise: DiscoveryPromise | null;
  questions: DiscoveryQuestion[]; // remaining floor items, rank order; [] before Q1
  railFill: Record<CvSection, number>; // 0..1 per section
  essentialRemaining: number; // the countdown
  cvLines: DiscoveryCvLine[]; // role lead line first, then answered lines — for resume
  factCount: number; // #17's profile badge count — every recorded answer, a "no" included, never decreases
}

// jobId (#18, AC6): when a CV was uploaded via the front-door shortcut, the server composes a
// reader-only first question from it — a plain call (no jobId) behaves exactly as before.
export function getDiscovery(jobId?: string): Promise<DiscoveryState> {
  return jfetch(`/api/onboarding/discovery${jobId ? `?job=${encodeURIComponent(jobId)}` : ""}`);
}

// Q1 typing lookup — caller debounces (~250ms). Silent no-match comes back as suggestions: [].
export function lookupFamily(q: string): Promise<{ family: string | null; suggestions: string[] }> {
  return jfetch(`/api/onboarding/discovery/family?q=${encodeURIComponent(q)}`);
}

export function startDiscovery(role: string): Promise<DiscoveryState> {
  return jfetch("/api/onboarding/discovery/start", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function answerDiscovery(itemId: string, answer: string): Promise<DiscoveryState> {
  return jfetch("/api/onboarding/discovery/answer", {
    method: "POST",
    body: JSON.stringify({ itemId, answer }),
  });
}

// #123: the language question's multi-select confirm — same route, `answers` instead of `answer`.
// `answers: []` is legal (the "I can't work in any of these" confirm); a decline still goes through
// plain answerDiscovery with the declineOption string, never through here.
export function answerDiscoveryMulti(itemId: string, answers: string[]): Promise<DiscoveryState> {
  return jfetch("/api/onboarding/discovery/answer", {
    method: "POST",
    body: JSON.stringify({ itemId, answers }),
  });
}

// --- #19 the reveal + the job card (screen 2a) ---
// #117: GET /onboarding/cards returns every card already correctly ordered — judged first, then
// estimated, then pending, score-sorted within each group, curated-opener promotion applied. A
// client re-sort would both fail to type-check (matchPct is null on a pending card) and destroy
// that order — deck/page.tsx renders `cards` as-is for exactly that reason. The bubble's two
// clauses, the fit/dontYet/askedClosed lists, and their rank order are all composed server-side
// (matchtick.ts) — this client only renders the shape as-is, never re-derives it.

// 2026-08-12 (architecture pass candidate 2): the card shapes below come from @jobcrush/contracts —
// the same zod-inferred definitions the API composes cards from (apps/api/src/deck.ts), golden-tested
// against the .mjs oracle. Type-only imports, so nothing of zod reaches the client bundle. The local
// aliases keep every existing page/e2e import path (`../lib/api`) working unchanged.
//
// On the union itself: a discriminated union on `scored`, not four nullable fields on one interface —
// narrowing on `card.scored` (or on `card.breakdown`/`card.matchPct` being non-null) gives real
// non-null types for the other fields, with no `!`/`as` anywhere that reads a card.
// - Scored: judged against the candidate's evidence, or — only when scoring is switched off entirely
//   (local dev without a key) — the deterministic fallback scorer. The two render identically;
//   `scored` is a QA/e2e hook (`data-scored`) only, never a UI affordance.
// - Pending (#117): cost bounds judging to the first N cards server-side; the rest arrive with no
//   number yet and fill in via the client's poll (deck/page.tsx). Never render 0 or omit the number
//   silently — jobcard.tsx's PendingRing em dash is the only honest way to say "not yet".
// - Unscored (#117b addendum §11): we have not bought a score for this job and will not until the
//   visitor shows interest — distinct from `pending`, which IS coming, just not yet. Never polled,
//   never flips to gaveUp (deck/page.tsx's applyMerge only ever swaps a locally-`pending` slot).
//   Swiping right judges it on demand (see deck/page.tsx's §11.7 handoff fix).
import type {
  CardFact as ContractCardFact,
  CardRequirement as ContractCardRequirement,
  JobCardV1,
  PendingJobCardV1,
  ScoredJobCardV1,
  UnscoredJobCardV1,
} from "@jobcrush/contracts";

export type CardFact = ContractCardFact;
export type CardRequirement = ContractCardRequirement;
export type MatchBreakdown = ScoredJobCardV1["breakdown"];
export type ScoredJobCard = ScoredJobCardV1;
export type PendingJobCard = PendingJobCardV1;
export type UnscoredJobCard = UnscoredJobCardV1;
export type JobCard = JobCardV1;

// #123 addendum (2026-08-04): what #107's withdrawal engine dropped on a language ground, so the
// reveal can say so instead of silently shrinking the count. Typed locally (not yet on the shared
// contract) — the backend is building this exact shape. `byLanguage` is desc by count, then name
// asc, and names only languages that actually caused a removal — never the full unticked set.
// `total: 0` with an empty `byLanguage` means nothing was withdrawn; render nothing for that case.
export interface WithdrawnSummary {
  total: number;
  byLanguage: Array<{ language: string; count: number }>;
}

// #165 — the ladder question THIS advert triggers, when the person's level for a language it names
// is still unknown (apps/api/src/languageLevel.ts). Rides on the card rather than the ask dock
// because that is the moment it earns its interruption: the reason is this advert, and `why` quotes
// it. `options` are ordered rungs of concrete situations, lowest first; the lowest ("not-at-all") is
// the only answer that ever removes jobs, and it takes a deliberate tap. Skipping is "not now" —
// a later advert testing the same language asks again (ADR-0011 clause 4).
export interface LanguageLevelAsk {
  language: string;
  question: string;
  why: string;
  /** What answering costs, shown BEFORE the rungs — #125 decision 4. */
  consequence: string;
  options: Array<{ value: string; situation: string }>;
  skipOption: string;
}

export function answerLanguageLevel(language: string, level: string): Promise<{ ok: true }> {
  return jfetch("/api/onboarding/language-level", {
    method: "POST",
    body: JSON.stringify({ language, level }),
  });
}

/** A card as the deck actually receives it: the frozen JobCardV1 contract plus whatever this
 *  session-specific advert happens to trigger. Kept separate from JobCard so the contract type stays
 *  exactly the contract. */
export type DeckCard = JobCard & { levelAsk?: LanguageLevelAsk };

export interface CardsResponse {
  stage: string;
  cards: DeckCard[];
  // #22: true once the session is claimed (signed in) — false only for a still-anonymous visitor.
  // Gates the account wall at the reveal: authed ? straight to the deck : the wall.
  authed: boolean;
  // #117: how many cards in `cards` are still `scored === "pending"`. The client's only use of this
  // number is as the poll's start/stop condition — it is deliberately never rendered (design §6).
  pendingCount: number;
  withdrawn?: WithdrawnSummary;
  // #245: true only while the server is actively retrieving the first deck. An empty response with
  // false/absent is a finished empty result and keeps the existing dead end unchanged.
  searching?: boolean;
  // #235: whether any discovery question is genuinely still open for this session. The empty deck's
  // "answer a few more questions" line is only honest when one exists; otherwise the empty state
  // invites a different job title instead. Optional defensively — an absent field falls back to the
  // pre-#235 line, never a dead-end invitation.
  moreQuestions?: boolean;
  // #229: true when this deck's family is a known zero for her while her CV holds years elsewhere —
  // a change of direction. Copy only: the deck says one sentence; scores are never touched by it.
  // Optional defensively — an absent field never claims a change of direction.
  newToFamily?: boolean;
  // #228: the widening offered at the dead end. Server-owned — this screen renders it and never
  // decides. Optional defensively: an absent field is "no offer", today's dead end unchanged.
  fallback?: DeckFallbackState;
  // #63: what actually happened when we went looking. The screen needs this because an empty deck
  // has more than one honest meaning, and they are NOT interchangeable words: `empty_pool` is "we
  // asked and there was nothing", `provider_unavailable` is "we could not ask". Collapsing the
  // second into the first tells someone their market is empty when in fact our only supplier was
  // offline — the failure mode #174 recorded and this ticket exists to avoid. Optional defensively:
  // an absent field keeps the pre-#63 dead end, never an invented outage.
  retrieval?: { outcome: RetrievalOutcome };
}

/** The outcomes the server's retrieval boundary reports (PostingRetrievalResultV1). */
export type RetrievalOutcome =
  | "relevant_postings"
  | "empty_pool"
  | "provider_unavailable"
  | "stale_data"
  | "invalid_request";

/** #228 — whether to offer the work her CV proves, and what she has already answered. */
export interface DeckFallbackState {
  offered: boolean;
  declined: boolean;
  active: boolean;
  /** Her own typed words — the only thing the offer is allowed to name. */
  targetRole: string | null;
}

export function getCards(): Promise<CardsResponse> {
  return jfetch("/api/onboarding/cards");
}

/** #228: her yes/no to the widening. Nothing is retrieved here — accepting only records the choice,
 *  and the next deck read carries the one extra search it implies. */
export function chooseFallback(accepted: boolean): Promise<{ fallback: DeckFallbackState }> {
  return jfetch("/api/onboarding/cards/fallback", {
    method: "POST",
    body: JSON.stringify({ accepted }),
  });
}

export interface WantCardResult {
  stage: "tailor";
  adId: string;
}

export function wantCard(adId: string): Promise<WantCardResult> {
  return jfetch(`/api/onboarding/cards/${encodeURIComponent(adId)}/want`, { method: "POST" });
}

// --- #23 tailor (screen 3): re-score, the live card, and the exits ---
// Every field below is server-composed (matchtick.ts). Within one session matchPct only rises as
// requirements close (§8) — a separate invariant from #117's judged/estimated swap, which CAN move
// a card's number either way between two page views. The two never collide: /deck's want flow
// judges an advert on demand before a tailor target opens (its own full budget, #117's design §0
// trap 2), so `card` below is always ScoredJobCard, never the deck's PendingJobCard variant. The
// fit/dontYet/askedClosed lists carry a requirement between them (the ?->check flip), and
// ledger/bubble text is rendered verbatim, never re-derived here. cvLines is the same shape
// discovery already sends.

export interface TailorQuestion {
  requirementId: string;
  question: string;
  options: string[]; // may be empty — a free-text question, same convention as discovery
}

export interface TailorLedgerEntry {
  requirementId: string;
  text: string;
}

export interface TailorState {
  // #117: narrowed to the scored variant, not the full JobCard union — see the comment block above.
  // This is the "discriminated union on scored" the ticket asked for: it lets every existing use of
  // `tailor.card.matchPct` etc. in this file keep type-checking as a plain number, with no `!`/`as`,
  // because the type itself states the invariant instead of the caller assuming it card-by-card.
  card: ScoredJobCard;
  questions: TailorQuestion[]; // empty ⇒ the ending
  ledger: TailorLedgerEntry[];
  cvLines: DiscoveryCvLine[];
  closedGaps: { closed: number; asked: number };
  done: boolean;
  factCount: number; // #17's profile badge count, on the tailor screen too
}

export function getTailor(): Promise<TailorState> {
  return jfetch("/api/onboarding/tailor");
}

export function answerTailor(requirementId: string, answer: string): Promise<TailorState> {
  return jfetch("/api/onboarding/tailor/answer", {
    method: "POST",
    body: JSON.stringify({ requirementId, answer }),
  });
}

export function dropTailor(): Promise<{ stage: "deck" }> {
  return jfetch("/api/onboarding/tailor/drop", { method: "POST" });
}

// --- E2 auth (magic-link) ---

// `job` rides along so the emailed link can route back to the deck even when opened in another
// browser (the mail-app webview) — where localStorage from the original tab isn't available.
export function requestLink(email: string, job?: string): Promise<{ ok: boolean; devLink?: string }> {
  return jfetch("/api/auth/request-link", {
    method: "POST",
    body: JSON.stringify({ email, ...(job ? { job } : {}) }),
  });
}

export function verifyToken(token: string): Promise<{ user: { id: string; email: string } }> {
  return jfetch("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
}

export function logout(): Promise<{ ok: boolean }> {
  return jfetch("/api/auth/logout", { method: "POST" });
}

// --- #20 the profile screen (Sorted + Constellation) ---
// The colour law (gold = on the rendered CV right now, grey = saved in reserve) is a pure
// server-side derivation over the claim graph + root-CV trace — this client only renders what
// arrives, never re-derives it (design-20-profile-screen.md §3).

export interface ProfileFact {
  id: string;
  text: string;
  colour: "gold" | "grey";
  source: "told" | "read";
  // #186: experience facts carry the job line they belong to (rendered verbatim as a job block's
  // header — never parsed for dates/employer); null for every other domain.
  job: string | null;
  // #193: pinned additively — true only for a Languages chip synthesised from the stored answer,
  // with no CV-mined detail behind it (absent/undefined on every other fact). Never derived
  // client-side from `id` shape; the API is the one source of this flag.
  answerOnly?: true;
}

export interface ProfileDomain {
  tag: string;
  heading: string;
  facts: ProfileFact[];
}

// #179: what the profile rail's Job family section draws. `family` is null for everyone until E5
// places typed roles into families — the rail renders the honest empty state (role as typed + the
// "Not the job you meant?" door), never a family the machine cannot attribute. When family is
// non-null: siblingTitles never contains `role` as typed, and openJobs comes from the same server
// producer as the onboarding promise count.
export interface ProfileSearch {
  role: string | null; // exactly as typed at Q1; null before Q1
  family: string | null;
  siblingTitles: string[];
  openJobs: number | null;
}

// #190 "contact info is a fact" — mirrors apps/api/src/profile.ts's ProfileContactField/
// ProfileContact exactly. `origin` is the same "you told us" vs "read from your CV" distinction
// ProfileFact.source already carries, spelled with the contact record's own two origin kinds —
// never re-derived here.
export interface ProfileContactField {
  value: string;
  origin: "read" | "person-said";
}
export interface ProfileContact {
  phone: ProfileContactField | null;
  email: ProfileContactField | null;
}

// #214: the rail's Location data is a LIST now — mirrors apps/api/src/profile.ts's ProfileLocation.
// `areas` are the target-location chips (`label` is what the chip shows — city when a city was
// typed, else the market); `workRights` is one row per unique covered market.
export interface ProfileWorkRights {
  market: string;
  answer: string | null;
  questionId: string;
  question: string;
  options: string[];
}
export interface ProfileLocation {
  areas: Array<{ text: string; market: string; label: string }>;
  workRights: ProfileWorkRights[];
}

// #186 review round 2 (must-fix) — the eligibility store's own languages answer, always present on
// the payload. The Languages *domain* (chips in the main list) is CV-mined claim text — a different
// provenance that never matches this question's options and must never be used to pre-tick it (a
// claim like "Fluent in English and Mandarin." matches no option; deriving ticks from it opens the
// door wrong and a save would silently flip real eligibility answers to "no", withdrawing jobs).
export interface ProfileLanguagesQuestion {
  questionId: string;
  question: string;
  consequence: string | null;
  options: string[]; // verbatim, including the trailing decline option
  answer: string[] | null; // the eligibility store's current set; null = never answered
}

export interface ProfileState {
  factCount: number;
  domains: ProfileDomain[];
  search: ProfileSearch;
  contact: ProfileContact;
  location: ProfileLocation;
  languagesQuestion: ProfileLanguagesQuestion;
}

// Mirrors apps/api/src/contact.ts's ContactValue/ContactRecord — the PUT /contact response shape.
// The profile door never reads this response directly (same #183 pattern as the Job family door):
// it saves, then re-fetches /api/profile so the screen always renders from one payload shape.
export type ContactOrigin = "read" | "person-said";
export interface ContactValue {
  value: string;
  origin: ContactOrigin;
  sourceText: string;
}
export interface ContactRecord {
  phone: ContactValue | null;
  email: ContactValue | null;
}

export function saveContact(field: "phone" | "email", value: string): Promise<ContactRecord> {
  return jfetch("/api/contact", {
    method: "PUT",
    body: JSON.stringify({ field, value }),
  });
}

export type SourceEntry =
  | null
  | { checkpoint: "invited"; choice: null }
  | { checkpoint: "source_selected"; choice: "cv" | "questions" };

export interface SessionCheckpoint {
  sourceEntry: SourceEntry;
  importProof?: ImportProof;
  stage?: string;
}

export async function getSessionCheckpoint(): Promise<SessionCheckpoint | null> {
  const response = await fetch("/api/sessions/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("restore failed");
  const session = (await response.json()) as SessionCheckpoint;
  return {
    sourceEntry: session.sourceEntry,
    ...(session.importProof ? { importProof: session.importProof } : {}),
    ...(session.stage ? { stage: session.stage } : {}),
  };
}

export function saveSourceEntry(sourceEntry: Exclude<SourceEntry, null>) {
  return jfetch<{ sourceEntry: Exclude<SourceEntry, null> }>("/api/sessions/me/source-entry", {
    method: "PUT",
    body: JSON.stringify(sourceEntry),
  });
}

// #214: a stored target location plus its display resolution — mirrors routes/sessions.ts's
// searchAreaStateSchema. `label` is what the chip shows (city when a city was typed, else market).
export interface SearchAreaState {
  text: string;
  marketKey: string;
  statedAt: string;
  market: string;
  label: string;
}

export interface SearchIntent {
  targetRole: string | null;
  searchAreas: SearchAreaState[];
}

export interface IntentState {
  intent: SearchIntent;
  missing: Array<"targetRole" | "searchArea">;
  checkpoint: "intent_needed" | "intent_known";
  /** Entries from the LAST write the server refused as uncovered, with the live coverage list. */
  refused: Array<{ text: string; coverage: string[] }>;
  /** The live covered-market names, for the early-access line — never hard-coded client-side. */
  coverage: string[];
  /** The completion vocabulary the type-ahead draws from — the server's own matching aliases. */
  areaVocabulary: Array<{ alias: string; market: string; label: string }>;
}

export function getIntent(): Promise<IntentState> {
  return jfetch("/api/sessions/me/intent");
}

export function saveIntent(intent: { targetRole?: string; searchAreas?: string[] }): Promise<IntentState> {
  return jfetch("/api/sessions/me/intent", {
    method: "PUT",
    body: JSON.stringify(intent),
  });
}

export function getProfile(): Promise<ProfileState> {
  return jfetch("/api/profile");
}

// --- #161 job blocks (structured work-history records) + #157 Design A confirm deck ---
// #163: the view shapes now live once in @jobcrush/contracts (jobBlockView.ts) instead of being
// hand-mirrored here — re-exported type-only under the names this app already uses, so drift
// fails typecheck instead of rendering undefined (same pattern as JobCardV1, 85c0b19).
export type {
  Kind as JobBlockKind,
  MinedDate,
  MinedEndValue,
  DecisionOrigin,
  DecisionView,
  JobBlockView,
  ReadStatus as JobBlocksReadStatus,
  DeckSummary as JobBlocksSummary,
  HeldSentence,
  FamilyPlacement,
  IndustryPlacement,
  // #281 — one entry of the published industry vocabulary. Re-exported type-only from the contract,
  // never hand-mirrored here: the API composes it, the web reads it, and drift fails typecheck
  // instead of rendering undefined (this file's own header rule).
  PublishedIndustryChoice as PublishedIndustry,
} from "@jobcrush/contracts";
import type {
  IndustryPlacement,
  Kind as JobBlockKind,
  MinedDate,
  MinedEndValue,
  HeldSentence,
  JobBlockView,
  DeckSummary as JobBlocksSummary,
} from "@jobcrush/contracts";

export function getJobBlocks(): Promise<{
  blocks: JobBlockView[];
  summary: JobBlocksSummary;
  /** Optional on purpose, not by oversight: the server always sends it, but during a rolling
   *  deploy this client can be talking to an API that predates it, and a screen that renders
   *  "we couldn't work this out" beats one that throws. */
  industries?: import("@jobcrush/contracts").PublishedIndustryChoice[];
}> {
  return jfetch("/api/job-blocks");
}

export function confirmJobBlock(id: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/job-blocks/${id}/confirm`, { method: "POST" });
}

// The server-side reverse of confirmJobBlock — lets undo actually unwind a confirm rather than
// only hiding it locally (a reload would otherwise resurrect the "undone" decision).
export function unconfirmJobBlock(id: string): Promise<{ ok: boolean }> {
  return jfetch(`/api/job-blocks/${id}/unconfirm`, { method: "POST" });
}

export type JobBlockCorrection =
  | { key: "employer"; value: string }
  | { key: "title"; value: string }
  | { key: "start"; value: MinedDate }
  | { key: "end"; value: MinedEndValue }
  | { key: "kind"; value: JobBlockKind }
  // #221: the person's own answer to "what kind of work is this?" — a reference into the published
  // list, never free text. #231 removed the screen that ASKED it; the family stays a correctable
  // fact, so this door stays open for the correction surface that #128's machinery already has.
  | { key: "family"; value: { familyId: string; version: number } }
  // #281: her own answer to "what industry was this job in?" — a reference into the published
  // vocabulary, never free text. Unlike the family, this one HAS a surface (the correction panel's
  // industry picker), because the screen shows the machine's answer and a shown answer must be
  // correctable.
  // The value is either a published reference (her pick) or a WHOLE placement (the undo, which has
  // to put back an unmapped, or two industries at their own confidence, exactly as they were).
  // See the API's CorrectBody for the full reasoning.
  | { key: "industry"; value: { industryId: string; version: number } | IndustryPlacement };

// #163: `held` — confirmed sentences this correction contradicted, now held aside with a precise
// question each (ADR-0002 clause 3); they return to the CV when the person answers. `downstream`
// tells the person, in plain words, what the correction changes on later CVs.
export function correctJobBlock(
  id: string,
  correction: JobBlockCorrection,
): Promise<{ ok: boolean; held: HeldSentence[]; downstream: string | null }> {
  return jfetch(`/api/job-blocks/${id}/correct`, {
    method: "POST",
    body: JSON.stringify(correction),
  });
}

export type JobBlockMatchResolution = { resolution: "same"; matchedBlockId: string } | { resolution: "different" };

export function resolveJobBlockMatch(id: string, resolution: JobBlockMatchResolution): Promise<{ ok: boolean }> {
  return jfetch(`/api/job-blocks/${id}/resolve-match`, {
    method: "POST",
    body: JSON.stringify(resolution),
  });
}
