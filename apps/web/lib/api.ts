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
    const message = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(message);
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

export interface BuildResult {
  stage: "ready" | "loopback";
  gate: { ok: boolean; errors: string[] };
  rootCv: { markdown: string; trace: unknown };
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
