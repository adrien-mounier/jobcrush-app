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
    preview?: { postingTitle: string; postingCompany: string };
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

export interface DiscoveryQuestion {
  itemId: string;
  question: string;
  options: string[]; // may be empty — a free-text floor item
  cvSection: CvSection;
}

export interface DiscoveryCvLine {
  itemId: string; // "role" = the CV lead line; anything else is a section body line
  section: CvSection;
  text: string;
}

export interface DiscoveryPromise {
  family: string;
  city: string | null;
  count: number | null; // null = count failed but the family placed (C11 fallback)
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

// --- #19 the reveal + the job card (screen 2a) ---
// #117: GET /onboarding/cards returns every card already correctly ordered — judged first, then
// estimated, then pending, score-sorted within each group, curated-opener promotion applied. A
// client re-sort would both fail to type-check (matchPct is null on a pending card) and destroy
// that order — deck/page.tsx renders `cards` as-is for exactly that reason. The bubble's two
// clauses, the fit/dontYet/askedClosed lists, and their rank order are all composed server-side
// (matchtick.ts) — this client only renders the shape as-is, never re-derives it.

export interface CardFact {
  id: string;
  text: string;
}

export interface CardRequirement {
  id: string;
  // #102: unified band vocabulary (was "must" | "should" | "nice") — not rendered anywhere in this
  // app (jobcard.tsx renders only .requirement), so the rename here is type-only.
  band: "essential" | "standard" | "nice-to-have";
  requirement: string;
}

export interface MatchBreakdown {
  essential: { met: number; total: number };
  desirable: { met: number; total: number };
}

// #117: fields every card shape carries, scored or not.
interface JobCardCommon {
  schemaVersion: "1";
  adId: string;
  title: string;
  company: string;
  place: string;
  salary: string | null;
  pattern: string | null;
  fit: CardFact[];
  dontYet: CardRequirement[];
  askedClosed: CardFact[];
  adExcerpt: string;
}

// A real score: either judged against the candidate's evidence, or — only when scoring is switched
// off entirely (local dev without a key, every existing test) — the deterministic fallback scorer.
// The two render identically; `scored` is a QA/e2e hook (`data-scored`) only, never a UI affordance.
export interface ScoredJobCard extends JobCardCommon {
  scored: "judged" | "estimated";
  matchPct: number;
  breakdown: MatchBreakdown;
  bubble: { hit: string; open: string };
}

// #117: cost bounds judging to the first N cards server-side; the rest arrive with no number yet
// and fill in via the client's poll (deck/page.tsx). Never render 0 or omit the number silently —
// jobcard.tsx's PendingRing em dash is the only honest way to say "not yet".
export interface PendingJobCard extends JobCardCommon {
  scored: "pending";
  matchPct: null;
  breakdown: null;
  bubble: null;
}

// #117b (addendum §11): we have not bought a score for this job and will not until the visitor
// shows interest — distinct from `pending`, which IS coming, just not yet. Same null shape as
// `pending`. Never polled, never flips to gaveUp (deck/page.tsx's applyMerge only ever swaps a
// locally-`pending` slot, so an `unscored` card is structurally outside that machinery, not just
// by convention). Swiping right judges it on demand (see deck/page.tsx's §11.7 handoff fix).
export interface UnscoredJobCard extends JobCardCommon {
  scored: "unscored";
  matchPct: null;
  breakdown: null;
  bubble: null;
}

// A discriminated union on `scored`, not four nullable fields on one interface: narrowing on
// `card.scored` (or on `card.breakdown`/`card.matchPct` being non-null) then gives real non-null
// types for the other fields too, with no `!`/`as` anywhere that reads a card.
export type JobCard = ScoredJobCard | PendingJobCard | UnscoredJobCard;

export interface CardsResponse {
  stage: string;
  cards: JobCard[];
  // #22: true once the session is claimed (signed in) — false only for a still-anonymous visitor.
  // Gates the account wall at the reveal: authed ? straight to the deck : the wall.
  authed: boolean;
  // #117: how many cards in `cards` are still `scored === "pending"`. The client's only use of this
  // number is as the poll's start/stop condition — it is deliberately never rendered (design §6).
  pendingCount: number;
}

export function getCards(): Promise<CardsResponse> {
  return jfetch("/api/onboarding/cards");
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
}

export interface ProfileDomain {
  tag: string;
  heading: string;
  facts: ProfileFact[];
}

export interface ProfileState {
  factCount: number;
  domains: ProfileDomain[];
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

export interface SearchIntent {
  targetRole: string | null;
  searchArea: string | null;
}

export interface IntentState {
  intent: SearchIntent;
  missing: Array<"targetRole" | "searchArea">;
  checkpoint: "intent_needed" | "intent_known";
}

export function getIntent(): Promise<IntentState> {
  return jfetch("/api/sessions/me/intent");
}

export function saveIntent(intent: Partial<Record<keyof SearchIntent, string>>): Promise<IntentState> {
  return jfetch("/api/sessions/me/intent", {
    method: "PUT",
    body: JSON.stringify(intent),
  });
}

export function getProfile(): Promise<ProfileState> {
  return jfetch("/api/profile");
}
