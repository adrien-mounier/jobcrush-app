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
    [k: string]: unknown;
  };
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
// GET /onboarding/cards returns every card already sorted by matchPct desc (best first); the
// bubble's two clauses, the fit/dontYet/askedClosed lists, and their rank order are all composed
// server-side (matchtick.ts) — this client only renders the shape as-is, never re-derives it.

export interface CardFact {
  id: string;
  text: string;
}

export interface CardRequirement {
  id: string;
  band: "must" | "should" | "nice";
  requirement: string;
}

export interface JobCard {
  adId: string;
  title: string;
  company: string;
  place: string;
  salary: string | null;
  pattern: string | null;
  matchPct: number;
  bubble: { hit: string; open: string };
  fit: CardFact[];
  dontYet: CardRequirement[];
  askedClosed: CardFact[];
  adExcerpt: string;
}

export interface CardsResponse {
  stage: string;
  cards: JobCard[];
  // #22: true once the session is claimed (signed in) — false only for a still-anonymous visitor.
  // Gates the account wall at the reveal: authed ? straight to the deck : the wall.
  authed: boolean;
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
// Every field below is server-composed (matchtick.ts) — matchPct never decreases, the fit/dontYet/
// askedClosed lists carry a requirement between them (the ?->check flip), and ledger/bubble text is
// rendered verbatim, never re-derived here. cvLines is the same shape discovery already sends.

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
  card: JobCard;
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

export function getProfile(): Promise<ProfileState> {
  return jfetch("/api/profile");
}
