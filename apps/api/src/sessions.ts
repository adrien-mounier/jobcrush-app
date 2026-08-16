// JC-10 anonymous device sessions. Behind an interface with two drivers: in-memory (dev/tests) and
// Postgres (JC-6 — `DATABASE_URL` set). TTL fields feed the JC-20 purge job later; claimedByUserId is
// the JC-19 merge hook.
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  PostingRetrievalResultV1,
  type PostingRetrievalResultV1 as PostingRetrievalResultV1Value,
} from "@jobcrush/contracts";
import { getPool, iso } from "./db.js";
import { resolveSearchArea } from "./postingRetrieval.js";

// Techmap's worst bounded call is two 10s attempts plus one 1s retry backoff and pacing. A 60s
// lease leaves headroom while still recovering an abandoned background claim promptly.
export const RETRIEVAL_CLAIM_LEASE_MS = 60_000;

export function retrievalClaimWindow(nowMs = Date.now()): { claimedAt: string; staleBefore: string } {
  return {
    claimedAt: new Date(nowMs).toISOString(),
    staleBefore: new Date(nowMs - RETRIEVAL_CLAIM_LEASE_MS).toISOString(),
  };
}

// Where a session sits in the onboarding loop; the client reads it on load to pick a screen.
// front-door (screen 0) → discovery (#16) → deck → tailor (#21/#23) → grill (JC-24) → ready | loopback.
export type OnboardingStage = "front-door" | "discovery" | "deck" | "tailor" | "grill" | "ready" | "loopback";
export type SourceEntry =
  | null
  | { checkpoint: "invited"; choice: null }
  | { checkpoint: "source_selected"; choice: "cv" | "questions" };

/** #214 — one target location, the ADR-0004 place shape plus #124's timestamp decision: the words
 *  as typed, the resolved country-level marketKey, and statedAt (when we learned it — a preference
 *  goes stale like "Present" does; no other fact machinery). The city, when the words name one, is
 *  derived from `text` through resolveSearchArea — never stored twice. */
export interface SearchAreaEntry {
  text: string;
  marketKey: string;
  statedAt: string;
}

export interface SearchIntent {
  targetRole: string | null;
  /** Up to 3 covered target locations; the deck is one deck over the union of their regions. */
  searchAreas: SearchAreaEntry[];
}

function searchAreaEntries(value: unknown): SearchAreaEntry[] {
  if (typeof value === "string") {
    try {
      return searchAreaEntries(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const entries: SearchAreaEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.text === "string" &&
      entry.text.length > 0 &&
      typeof entry.marketKey === "string" &&
      entry.marketKey.length > 0 &&
      typeof entry.statedAt === "string" &&
      Number.isFinite(Date.parse(entry.statedAt))
    ) {
      entries.push({ text: entry.text, marketKey: entry.marketKey, statedAt: entry.statedAt });
    }
  }
  return entries;
}

/** #214 back-compat: a pre-existing single search_area reads as a one-entry list (no migration,
 *  pre-launch). An uncovered legacy value is dropped — the new model never keeps a refused place —
 *  and statedAt falls back to the session's createdAt, the honest lower bound for when we learned it. */
function legacySearchAreaEntries(text: string | null, createdAt: string): SearchAreaEntry[] {
  if (!text) return [];
  const resolution = resolveSearchArea(text);
  return resolution.covered ? [{ text, marketKey: resolution.marketKey, statedAt: createdAt }] : [];
}

/** One published family floor, named by id and the version it was chosen at. */
export type FamilyReference = { familyId: string; version: number };

/** #234 (#230's decision, spec #233 decision 1) — the two facts one stored reference used to do at
 *  once. It selected the family floor whose essential items discovery asks AND named the family
 *  retrieval searches with; for a mapped target role those are the same family, so nothing ever
 *  separated them. They are separate here so a visitor whose target role we cannot place can be
 *  interviewed on the families her CV proves and searched on her own typed words (#235).
 *    - `questionFloors` — the floors the interview asks, in the order they are asked;
 *    - `searchFamily`   — the family retrieval searches with, or null for the word search.
 *  adaptiveDiscovery.ts's `discoveryPlan` is the one function that decides both. */
export interface DiscoveryPlan {
  questionFloors: FamilyReference[];
  searchFamily: FamilyReference | null;
}

const sameReference = (a: FamilyReference | null | undefined, b: FamilyReference | null | undefined) =>
  a == null || b == null
    ? a == null && b == null
    : a.familyId === b.familyId && a.version === b.version;

/** The "floor already pinned" invariant, extended from the single floor to the pair: a plan counts
 *  as chosen the moment anything is in it, and once chosen it does not change under the session. */
export const planPinned = (plan: DiscoveryPlan): boolean =>
  plan.questionFloors.length > 0 || plan.searchFamily !== null;

export const samePlan = (a: DiscoveryPlan, b: DiscoveryPlan): boolean =>
  a.questionFloors.length === b.questionFloors.length &&
  a.questionFloors.every((reference, index) => sameReference(reference, b.questionFloors[index])) &&
  sameReference(a.searchFamily, b.searchFamily);

/** #235 — the ONE exception to the pin: a word-search plan (no search family) may be replaced by a
 *  plan that HAS one. This is the returning visitor whose role has since been published as a family:
 *  re-entering discovery re-derives the better plan, and she answers its floor before the family
 *  search runs (the coverage checkpoint resets with the plan). It only ever fires on her own
 *  discovery entry — nothing re-derives a plan while she is browsing a deck — and it is one-way:
 *  a family plan never downgrades to a word plan, and never swaps to a different family. */
export const planUpgradable = (current: DiscoveryPlan, next: DiscoveryPlan): boolean =>
  current.searchFamily === null && next.searchFamily !== null;

/** #236 — the other side of that one-way rule. A stored family pin OUTRANKS a fresh derivation that
 *  lost it: the candidate screen pins families the labeler still cannot place (that is the whole
 *  point of covered_role), so re-deriving from the labeler alone would answer "unmapped" forever and
 *  turn the invariant into a 409 on the visitor's own interview. The pin holds and she carries on;
 *  a derivation naming a DIFFERENT family is still a real conflict and still fails closed.
 *  #237 — publishing a newer version of the SAME family also leaves each pinned reference intact. */
const pinnedVersionsOrDerived = (stored: DiscoveryPlan, derived: DiscoveryPlan): DiscoveryPlan => {
  const pinnedReference = (reference: FamilyReference) =>
    stored.questionFloors.find((pinned) => pinned.familyId === reference.familyId) ?? reference;
  return {
    questionFloors: derived.questionFloors.map(pinnedReference),
    searchFamily:
      stored.searchFamily?.familyId === derived.searchFamily?.familyId
        ? stored.searchFamily
        : derived.searchFamily,
  };
};

export const pinnedOrDerived = (stored: DiscoveryPlan, derived: DiscoveryPlan): DiscoveryPlan =>
  stored.searchFamily !== null && derived.searchFamily === null
    ? stored
    : pinnedVersionsOrDerived(stored, derived);

/** #228 (spec #241 decisions 1/7) — the widening the visitor was OFFERED at the dead end and what
 *  she answered. `declined` is remembered so a reload never re-raises a question she has already
 *  said no to (the offer stays reachable on the screen instead). `family` is set only by an explicit
 *  acceptance and is a ONE-WAY LATCH for the session: it names the family the fallback deck is
 *  searched with, which keeps the retrieval fingerprint stable — so a reload returns the same deck
 *  and a second acceptance buys no second search. */
export interface DiscoveryFallback {
  declined: boolean;
  family: FamilyReference | null;
}

export interface ProductionDiscoveryState extends DiscoveryPlan {
  coveredItemIds: string[];
  checkpoint: "family_confirmed" | "essential_floor_covered" | null;
  fallback: DiscoveryFallback;
}

export interface RetrievalSnapshot {
  requestFingerprint: string;
  recordedAt: string;
  result: PostingRetrievalResultV1Value;
}

function retrievalSnapshot(value: unknown): RetrievalSnapshot | null {
  if (typeof value === "string") {
    try {
      return retrievalSnapshot(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    Object.keys(snapshot).sort().join(",") !== "recordedAt,requestFingerprint,result" ||
    typeof snapshot.requestFingerprint !== "string" ||
    snapshot.requestFingerprint.length === 0 ||
    typeof snapshot.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.recordedAt))
  ) {
    return null;
  }
  const result = PostingRetrievalResultV1.safeParse(snapshot.result);
  return result.success
    ? { requestFingerprint: snapshot.requestFingerprint, recordedAt: snapshot.recordedAt, result: result.data }
    : null;
}

function familyReference(value: unknown): FamilyReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "familyId,version" &&
    typeof record.familyId === "string" &&
    record.familyId.length > 0 &&
    Number.isInteger(record.version) &&
    (record.version as number) > 0
    ? { familyId: record.familyId, version: record.version as number }
    : null;
}

const emptyDiscovery = (): ProductionDiscoveryState => ({
  questionFloors: [],
  searchFamily: null,
  coveredItemIds: [],
  checkpoint: null,
  fallback: { declined: false, family: null },
});

/** #228: read leniently, unlike its siblings — a row written before the fallback existed simply has
 *  no offer on it, which is exactly "not offered, not declined". Anything malformed reads the same
 *  way, so a corrupt value can never pin a session into a family she never accepted. */
function discoveryFallback(value: unknown): DiscoveryFallback {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { declined: false, family: null };
  const record = value as Record<string, unknown>;
  return {
    declined: record.declined === true,
    family: record.family == null ? null : familyReference(record.family),
  };
}

/** #234: a row written before the split carries `floor` and no plan, so it fails the key check here
 *  and reads as the empty state — which is the whole migration (the product has no live users, so
 *  the shape changes outright and a session re-derives its plan on the next touch). */
function discoveryState(value: unknown): ProductionDiscoveryState {
  if (typeof value === "string") {
    try {
      return discoveryState(JSON.parse(value));
    } catch {
      // Fall through to the safe empty state.
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyDiscovery();
  const state = value as Record<string, unknown>;
  const stateKeys = Object.keys(state).sort();
  const rawFloors = state.questionFloors;
  const parsedFloors = Array.isArray(rawFloors) ? rawFloors.map(familyReference) : null;
  const questionFloors =
    parsedFloors !== null &&
    parsedFloors.every((reference) => reference !== null) &&
    // One family cannot be its own second floor — the same fail-closed reading coveredItemIds gets.
    new Set(parsedFloors.map((reference) => reference?.familyId)).size === parsedFloors.length
      ? (parsedFloors as FamilyReference[])
      : null;
  const searchFamily = state.searchFamily === null ? null : familyReference(state.searchFamily);
  const validSearchFamily = state.searchFamily === null || searchFamily !== null;
  const coveredItemIds = state.coveredItemIds;
  const checkpoint = state.checkpoint;
  const validCovered =
    Array.isArray(coveredItemIds) &&
    coveredItemIds.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(coveredItemIds).size === coveredItemIds.length;
  const validCheckpoint =
    checkpoint === null ||
    checkpoint === "family_confirmed" ||
    checkpoint === "essential_floor_covered";
  const chosen = questionFloors !== null && planPinned({ questionFloors, searchFamily });
  const coherent =
    questionFloors !== null &&
    validSearchFamily &&
    validCovered &&
    (chosen
      ? checkpoint !== null
      : checkpoint === null && (coveredItemIds as string[]).length === 0);
  if (
    // #228: `fallback` is OPTIONAL in this key check — a row written before it existed is a valid
    // pinned plan with no offer on it, not a corrupt one to be reset (the checked keys are unchanged
    // for every other field, so a genuinely malformed row still fails closed).
    stateKeys.filter((key) => key !== "fallback").join(",") !==
      "checkpoint,coveredItemIds,questionFloors,searchFamily" ||
    !validCheckpoint ||
    !coherent
  ) {
    return emptyDiscovery();
  }
  return {
    questionFloors: questionFloors!,
    searchFamily,
    coveredItemIds: coveredItemIds as string[],
    checkpoint: checkpoint as ProductionDiscoveryState["checkpoint"],
    fallback: discoveryFallback(state.fallback),
  };
}

export interface ImportProof {
  outcome: "success" | "partial" | "failed" | "no_useful_facts";
  usefulFactCount: number;
  skippedQuestionCount: number;
  representativeFacts: Array<{ id: string; text: string; provenance: "cv" }>;
  conflict: null | { fieldId: string; label: string; userResolvedValue: string | null };
}

function resolutionMap(value: unknown): Record<string, string> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }
  return (value as Record<string, string> | null) ?? {};
}

function resolvedProof(proof: ImportProof, fieldId: string, value: string): ImportProof {
  return {
    ...proof,
    representativeFacts: proof.representativeFacts.map((fact) =>
      fact.id === fieldId ? { ...fact, text: value } : fact,
    ),
    conflict: proof.conflict?.fieldId === fieldId ? null : proof.conflict,
  };
}

export interface SessionRecord {
  id: string;
  token: string;
  createdAt: string;
  lastSeenAt: string;
  claimedByUserId: string | null;
  targetTitles: string[];
  stage: OnboardingStage;
  tailorAdId: string | null;
  /** #23 the monotonic re-score floor for the current tailor target: the highest match tick ever
   *  posted this job, so a correction/"no" can never make the visible % regress. setTailorTarget
   *  resets it to 0 only when the ad actually changes — keyed to tailorFloorAdId below (#31), so
   *  re-entering the SAME job, drop + re-swipe included, keeps its floor (D2). */
  tailorFloorPct: number;
  /** #31 the ad tailorFloorPct was earned on. Keyed separately from tailorAdId because drop
   *  (clearTailorTarget) nulls tailorAdId but must NOT forget whose floor this is — re-swiping the
   *  same ad after a drop compares against this, not against tailorAdId, so the floor survives. */
  tailorFloorAdId: string | null;
  /** #33 the monotonic floor for the profile badge's factCount: the highest factCount ever shown
   *  this session, so a rejected claim in the S2 deck can lower the raw confirmed+negatives count
   *  without the badge ever visibly shrinking. Session-wide (unlike tailorFloorPct) — there's no
   *  ad to key it to, so raiseFactFloor is unconditional, unlike setTailorTarget's reset. */
  factFloor: number;
  sourceEntry: SourceEntry;
  importProof: ImportProof | null;
  importResolutions: Record<string, string>;
  intent: SearchIntent;
  discovery: ProductionDiscoveryState;
  retrieval: RetrievalSnapshot | null;
  /** Raw CAS coordinate stored separately from the parsed snapshot. An old snapshot may no longer
   * validate, but its durable coordinate must still be replaceable rather than wedging retrieval. */
  retrievalCoordinationFingerprint: string | null;
  retrievalGeneration: number;
}

export interface SessionStore {
  /** Create the backing table if needed (no-op for in-memory). Call once at startup. */
  init(): Promise<void>;
  create(): Promise<SessionRecord>;
  getByToken(token: string): Promise<SessionRecord | null>;
  getById(id: string): Promise<SessionRecord | null>;
  touch(id: string): Promise<void>;
  setTargetTitles(id: string, titles: string[]): Promise<void>;
  setStage(id: string, stage: OnboardingStage): Promise<void>;
  setSourceEntry(id: string, sourceEntry: Exclude<SourceEntry, null>): Promise<void>;
  setImportProof(id: string, proof: ImportProof): Promise<void>;
  setImportResolution(id: string, fieldId: string, value: string): Promise<void>;
  setIntent(
    id: string,
    intent: { targetRole?: string; searchAreas?: SearchAreaEntry[] },
  ): Promise<SearchIntent>;
  beginRetrievalState(
    id: string,
    generation: number,
    requestFingerprint: string,
    expectedSnapshotFingerprint: string | null,
    ownerToken: string,
    claimedAt: string,
    staleBefore: string,
  ): Promise<boolean>;
  reconcileRetrievalState(
    id: string,
    generation: number,
    requestFingerprint: string,
    ownerToken: string,
    snapshot: RetrievalSnapshot,
  ): Promise<boolean>;
  reconcileDiscoveryState(
    id: string,
    plan: DiscoveryPlan,
    coveredItemIds: string[],
    complete: boolean,
  ): Promise<ProductionDiscoveryState>;
  /** #228: record the visitor's answer to the widening offer. Writes what it is given — the one-way
   *  latch (an accepted family is never re-chosen, never unset) is deckFallback.ts's rule. */
  setDiscoveryFallback(id: string, fallback: DiscoveryFallback): Promise<ProductionDiscoveryState>;
  resolveImport(id: string, fieldId: string, value: string): Promise<ImportProof>;
  setTailorTarget(id: string, adId: string): Promise<void>;
  /** #23 drop: exit tailor back to the deck, clearing the target. Never touches claims. */
  clearTailorTarget(id: string): Promise<void>;
  /** #23: raises the tailor floor only — Math.max/GREATEST — so a correction can't lower it. */
  raiseTailorFloor(id: string, pct: number): Promise<void>;
  /** #33: raises the factCount floor only — Math.max/GREATEST — so a deck reject can't lower it. */
  raiseFactFloor(id: string, n: number): Promise<void>;
  /** JC-19 merge: claim this anonymous session for a user (the whole merge is this one update). */
  setClaimedByUserId(id: string, userId: string): Promise<void>;
}

function newSession(): SessionRecord {
  const now = new Date().toISOString();
  return {
    id: randomBytes(8).toString("hex"),
    token: randomBytes(32).toString("base64url"),
    createdAt: now,
    lastSeenAt: now,
    claimedByUserId: null,
    targetTitles: [],
    stage: "deck",
    tailorAdId: null,
    tailorFloorPct: 0,
    tailorFloorAdId: null,
    factFloor: 0,
    sourceEntry: null,
    importProof: null,
    importResolutions: {},
    intent: { targetRole: null, searchAreas: [] },
    discovery: emptyDiscovery(),
    retrieval: null,
    retrievalCoordinationFingerprint: null,
    retrievalGeneration: 0,
  };
}

export class InMemorySessionStore implements SessionStore {
  private byToken = new Map<string, SessionRecord>();
  private byId = new Map<string, SessionRecord>();
  private retrievalsInFlight = new Map<
    string,
    { requestFingerprint: string; ownerToken: string; claimedAtMs: number }
  >();

  async init(): Promise<void> {}

  async create(): Promise<SessionRecord> {
    const session = newSession();
    this.byToken.set(session.token, session);
    this.byId.set(session.id, session);
    return session;
  }

  async getByToken(token: string): Promise<SessionRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async getById(id: string): Promise<SessionRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async touch(id: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.lastSeenAt = new Date().toISOString();
  }

  async setTargetTitles(id: string, titles: string[]): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.targetTitles = titles;
  }

  async setStage(id: string, stage: OnboardingStage): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.stage = stage;
  }

  async setSourceEntry(id: string, sourceEntry: Exclude<SourceEntry, null>): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.sourceEntry = sourceEntry;
  }

  async setImportProof(id: string, proof: ImportProof): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.importProof = proof;
  }

  async setImportResolution(id: string, fieldId: string, value: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.importResolutions = { ...s.importResolutions, [fieldId]: value };
  }

  async setIntent(
    id: string,
    intent: { targetRole?: string; searchAreas?: SearchAreaEntry[] },
  ): Promise<SearchIntent> {
    const s = this.byId.get(id);
    if (!s) throw new Error("session not found");
    const next = {
      targetRole: intent.targetRole ?? s.intent.targetRole,
      searchAreas: intent.searchAreas ?? s.intent.searchAreas,
    };
    if (
      next.targetRole !== s.intent.targetRole ||
      JSON.stringify(next.searchAreas) !== JSON.stringify(s.intent.searchAreas)
    ) {
      s.retrieval = null;
      s.retrievalCoordinationFingerprint = null;
      s.retrievalGeneration += 1;
      this.retrievalsInFlight.delete(id);
    }
    s.intent = structuredClone(next);
    return structuredClone(s.intent);
  }

  async beginRetrievalState(
    id: string,
    generation: number,
    requestFingerprint: string,
    expectedSnapshotFingerprint: string | null,
    ownerToken: string,
    claimedAt: string,
    staleBefore: string,
  ): Promise<boolean> {
    const s = this.byId.get(id);
    if (!s) throw new Error("session not found");
    if (
      s.retrievalGeneration !== generation ||
      s.retrievalCoordinationFingerprint !== expectedSnapshotFingerprint
    ) {
      return false;
    }
    const claimedAtMs = Date.parse(claimedAt);
    const staleBeforeMs = Date.parse(staleBefore);
    if (!ownerToken || !Number.isFinite(claimedAtMs) || !Number.isFinite(staleBeforeMs)) return false;
    const active = this.retrievalsInFlight.get(id);
    if (active && active.claimedAtMs > staleBeforeMs) return false;
    this.retrievalsInFlight.set(id, { requestFingerprint, ownerToken, claimedAtMs });
    return true;
  }

  async reconcileRetrievalState(
    id: string,
    generation: number,
    requestFingerprint: string,
    ownerToken: string,
    snapshot: RetrievalSnapshot,
  ): Promise<boolean> {
    if (snapshot.requestFingerprint !== requestFingerprint) return false;
    const s = this.byId.get(id);
    if (!s) throw new Error("session not found");
    if (
      s.retrievalGeneration !== generation ||
      this.retrievalsInFlight.get(id)?.requestFingerprint !== requestFingerprint ||
      this.retrievalsInFlight.get(id)?.ownerToken !== ownerToken
    ) {
      return false;
    }
    s.retrieval = structuredClone(snapshot);
    s.retrievalCoordinationFingerprint = requestFingerprint;
    this.retrievalsInFlight.delete(id);
    return true;
  }

  async reconcileDiscoveryState(
    id: string,
    plan: DiscoveryPlan,
    coveredItemIds: string[],
    complete: boolean,
  ): Promise<ProductionDiscoveryState> {
    const s = this.byId.get(id);
    if (!s) throw new Error("session not found");
    const reconciledPlan = pinnedVersionsOrDerived(s.discovery, plan);
    if (planPinned(s.discovery) && !samePlan(s.discovery, reconciledPlan) && !planUpgradable(s.discovery, reconciledPlan)) {
      throw new Error("production discovery plan already pinned");
    }
    const discovery: ProductionDiscoveryState = {
      questionFloors: structuredClone(reconciledPlan.questionFloors),
      searchFamily: structuredClone(reconciledPlan.searchFamily),
      coveredItemIds: [...coveredItemIds],
      checkpoint: complete ? "essential_floor_covered" : "family_confirmed",
      // #228: the fallback answer is the VISITOR's, not the plan's — re-deriving the plan (she
      // answers another question) must never quietly undo the widening she asked for.
      fallback: structuredClone(s.discovery.fallback),
    };
    if (JSON.stringify(discovery) !== JSON.stringify(s.discovery)) {
      s.retrieval = null;
      s.retrievalCoordinationFingerprint = null;
      s.retrievalGeneration += 1;
      this.retrievalsInFlight.delete(id);
    }
    s.discovery = discovery;
    return structuredClone(s.discovery);
  }

  async setDiscoveryFallback(id: string, fallback: DiscoveryFallback): Promise<ProductionDiscoveryState> {
    const s = this.byId.get(id);
    if (!s) throw new Error("session not found");
    s.discovery = { ...s.discovery, fallback: structuredClone(fallback) };
    return structuredClone(s.discovery);
  }

  async resolveImport(
    id: string,
    fieldId: string,
    value: string,
  ): Promise<ImportProof> {
    const s = this.byId.get(id);
    if (s?.importProof) {
      s.importProof = resolvedProof(s.importProof, fieldId, value);
      s.importResolutions = { ...s.importResolutions, [fieldId]: value };
      return s.importProof;
    }
    throw new Error("import proof not ready");
  }

  async setTailorTarget(id: string, adId: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) {
      s.stage = "tailor";
      // #31: the floor is keyed to tailorFloorAdId, not tailorAdId — drop nulls tailorAdId, but the
      // floor earned on this ad must survive a drop + re-swipe of the SAME ad. Only a genuinely
      // different ad resets it.
      if (s.tailorFloorAdId !== adId) s.tailorFloorPct = 0;
      s.tailorFloorAdId = adId;
      s.tailorAdId = adId;
    }
  }

  async clearTailorTarget(id: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) {
      s.stage = "deck";
      s.tailorAdId = null;
    }
  }

  async raiseTailorFloor(id: string, pct: number): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.tailorFloorPct = Math.max(s.tailorFloorPct, pct);
  }

  async raiseFactFloor(id: string, n: number): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.factFloor = Math.max(s.factFloor, n);
  }

  async setClaimedByUserId(id: string, userId: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.claimedByUserId = userId;
  }
}

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id                 text PRIMARY KEY,
  token              text UNIQUE NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  claimed_by_user_id text,
  target_titles      jsonb NOT NULL DEFAULT '[]',
  stage              text NOT NULL DEFAULT 'deck',
  tailor_ad_id       text,
  tailor_floor_pct   integer NOT NULL DEFAULT 0,
  tailor_floor_ad_id text,
  fact_floor         integer NOT NULL DEFAULT 0,
  source_entry       jsonb,
  target_role        text,
  search_area        text,
  search_areas       jsonb,
  production_discovery jsonb NOT NULL DEFAULT '{"questionFloors":[],"searchFamily":null,"coveredItemIds":[],"checkpoint":null}',
  retrieval                       jsonb,
  retrieval_fingerprint           text,
  retrieval_generation            integer NOT NULL DEFAULT 0,
  retrieval_in_flight_fingerprint text,
  retrieval_in_flight_owner       text,
  retrieval_in_flight_claimed_at  timestamptz
)`;

const SESSIONS_ALTERS = [
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tailor_ad_id text",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tailor_floor_pct integer NOT NULL DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tailor_floor_ad_id text",
  // #31 backfill (deviates from this file's plain ADD COLUMN idiom, deliberately): without it, a
  // live session mid-tailor gets tailor_floor_ad_id = NULL on this deploy, and NULL = $2 is unknown
  // in SQL — not false — so setTailorTarget's CASE falls to ELSE 0 on the very next re-swipe, zeroing
  // the floor once for every in-flight session. Idempotent and inert after the first run: post-change
  // setTailorTarget always writes both columns together, so this WHERE can never match again.
  "UPDATE sessions SET tailor_floor_ad_id = tailor_ad_id WHERE tailor_floor_ad_id IS NULL AND tailor_ad_id IS NOT NULL",
  // #33: no backfill needed, unlike #31 above — fact_floor defaults to 0 and only ever rises, so an
  // existing row just starts at 0 and gets raised back up to its true peak on the very first read.
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fact_floor integer NOT NULL DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source_entry jsonb",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS target_role text",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS search_area text",
  // #214: the up-to-3 target locations. The legacy search_area column stays readable — toSession
  // falls back to it as a one-entry list whenever search_areas is still NULL (no migration, pre-launch).
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS search_areas jsonb",
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS production_discovery jsonb NOT NULL
   DEFAULT '{"questionFloors":[],"searchFamily":null,"coveredItemIds":[],"checkpoint":null}'`,
  // #234: ADD COLUMN IF NOT EXISTS leaves an already-created column's default alone, so a deployed
  // database would keep stamping new rows with the pre-split `floor` shape. Those rows read as the
  // empty state and re-derive, so nothing breaks — this just stops them being born malformed. No
  // backfill of existing rows: the shape changes outright (no live users), by decision.
  `ALTER TABLE sessions ALTER COLUMN production_discovery SET
   DEFAULT '{"questionFloors":[],"searchFamily":null,"coveredItemIds":[],"checkpoint":null}'`,
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval jsonb",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval_fingerprint text",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval_generation integer NOT NULL DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval_in_flight_fingerprint text",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval_in_flight_owner text",
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval_in_flight_claimed_at timestamptz",
];

function toSession(r: Record<string, unknown>): SessionRecord {
  const titles = r.target_titles;
  return {
    id: r.id as string,
    token: r.token as string,
    createdAt: iso(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
    claimedByUserId: (r.claimed_by_user_id as string) ?? null,
    targetTitles: Array.isArray(titles) ? (titles as string[]) : JSON.parse((titles as string) ?? "[]"),
    stage: (r.stage as OnboardingStage) ?? "deck",
    tailorAdId: (r.tailor_ad_id as string) ?? null,
    tailorFloorPct: (r.tailor_floor_pct as number) ?? 0,
    tailorFloorAdId: (r.tailor_floor_ad_id as string) ?? null,
    factFloor: (r.fact_floor as number) ?? 0,
    sourceEntry: (r.source_entry as SourceEntry) ?? null,
    importProof: (r.import_proof as ImportProof) ?? null,
    importResolutions: resolutionMap(r.import_resolutions),
    intent: {
      targetRole: (r.target_role as string) ?? null,
      searchAreas:
        r.search_areas != null
          ? searchAreaEntries(r.search_areas)
          : legacySearchAreaEntries((r.search_area as string) ?? null, iso(r.created_at)),
    },
    discovery: discoveryState(r.production_discovery),
    retrieval: retrievalSnapshot(r.retrieval),
    retrievalCoordinationFingerprint: (r.retrieval_fingerprint as string) ?? null,
    retrievalGeneration: (r.retrieval_generation as number) ?? 0,
  };
}

export class PgSessionStore implements SessionStore {
  private resolutionWrites = new Map<string, Promise<unknown>>();

  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(SESSIONS_TABLE);
    for (const alter of SESSIONS_ALTERS) await this.pool.query(alter);
    await this.pool.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS import_proof jsonb");
    await this.pool.query(
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS import_resolutions jsonb NOT NULL DEFAULT '{}'",
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS session_import_resolutions (
        session_id text NOT NULL,
        field_id text NOT NULL,
        value text NOT NULL,
        PRIMARY KEY (session_id, field_id)
      )
    `);
  }

  async create(): Promise<SessionRecord> {
    const s = newSession();
    await this.pool.query(
      `INSERT INTO sessions (id, token, created_at, last_seen_at, claimed_by_user_id, target_titles, stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.id, s.token, s.createdAt, s.lastSeenAt, s.claimedByUserId, JSON.stringify(s.targetTitles), s.stage],
    );
    return s;
  }

  private async one(column: "id" | "token", value: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM sessions WHERE ${column} = $1`, [value]);
    if (!rows[0]) return null;
    const session = toSession(rows[0]);
    const resolutions = await this.pool.query(
      "SELECT field_id, value FROM session_import_resolutions WHERE session_id = $1",
      [session.id],
    );
    session.importResolutions = Object.fromEntries(
      resolutions.rows.map((row) => [row.field_id as string, row.value as string]),
    );
    return session;
  }
  getByToken(token: string) { return this.one("token", token); }
  getById(id: string) { return this.one("id", id); }

  async touch(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [id]);
  }
  async setTargetTitles(id: string, titles: string[]): Promise<void> {
    await this.pool.query(`UPDATE sessions SET target_titles = $2 WHERE id = $1`, [id, JSON.stringify(titles)]);
  }
  async setStage(id: string, stage: OnboardingStage): Promise<void> {
    await this.pool.query(`UPDATE sessions SET stage = $2 WHERE id = $1`, [id, stage]);
  }
  async setSourceEntry(id: string, sourceEntry: Exclude<SourceEntry, null>): Promise<void> {
    await this.pool.query(`UPDATE sessions SET source_entry = $2 WHERE id = $1`, [
      id,
      JSON.stringify(sourceEntry),
    ]);
  }

  async setImportProof(id: string, proof: ImportProof): Promise<void> {
    await this.pool.query(`UPDATE sessions SET import_proof = $2 WHERE id = $1`, [
      id,
      JSON.stringify(proof),
    ]);
  }

  async setImportResolution(id: string, fieldId: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO session_import_resolutions (session_id, field_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
      [id, fieldId, value],
    );
  }

  async setIntent(
    id: string,
    intent: { targetRole?: string; searchAreas?: SearchAreaEntry[] },
  ): Promise<SearchIntent> {
    // #214: the change condition compares search_areas as jsonb (semantic equality). A legacy row
    // (search_areas still NULL) compares against '[]', so its FIRST list-shaped save always counts
    // as changed and resets the retrieval cache once — one wasted re-fetch, accepted pre-launch;
    // after that, re-saving an identical list is a no-op. Only ever resets a cache, never loses data.
    const changed = `(
      ($2::text IS NOT NULL AND (target_role IS NULL OR target_role <> $2::text))
      OR ($3::jsonb IS NOT NULL AND COALESCE(search_areas, '[]'::jsonb) <> $3::jsonb)
    )`;
    const { rows } = await this.pool.query(
      `UPDATE sessions
       SET target_role = COALESCE($2, target_role),
           search_areas = COALESCE($3, search_areas),
           retrieval = CASE WHEN ${changed} THEN NULL ELSE retrieval END,
           retrieval_fingerprint = CASE WHEN ${changed} THEN NULL ELSE retrieval_fingerprint END,
           retrieval_generation = CASE WHEN ${changed} THEN retrieval_generation + 1 ELSE retrieval_generation END,
           retrieval_in_flight_fingerprint = CASE WHEN ${changed} THEN NULL ELSE retrieval_in_flight_fingerprint END,
           retrieval_in_flight_owner = CASE WHEN ${changed} THEN NULL ELSE retrieval_in_flight_owner END,
           retrieval_in_flight_claimed_at = CASE WHEN ${changed} THEN NULL ELSE retrieval_in_flight_claimed_at END
       WHERE id = $1
       RETURNING target_role, search_areas, search_area, created_at`,
      [id, intent.targetRole ?? null, intent.searchAreas ? JSON.stringify(intent.searchAreas) : null],
    );
    if (!rows[0]) throw new Error("session not found");
    return {
      targetRole: (rows[0].target_role as string) ?? null,
      searchAreas:
        rows[0].search_areas != null
          ? searchAreaEntries(rows[0].search_areas)
          : legacySearchAreaEntries((rows[0].search_area as string) ?? null, iso(rows[0].created_at)),
    };
  }

  async beginRetrievalState(
    id: string,
    generation: number,
    requestFingerprint: string,
    expectedSnapshotFingerprint: string | null,
    ownerToken: string,
    claimedAt: string,
    staleBefore: string,
  ): Promise<boolean> {
    if (!ownerToken || !Number.isFinite(Date.parse(claimedAt)) || !Number.isFinite(Date.parse(staleBefore))) {
      return false;
    }
    const result = await this.pool.query(
      `UPDATE sessions SET retrieval_in_flight_fingerprint = $3,
         retrieval_in_flight_owner = $5, retrieval_in_flight_claimed_at = $6
       WHERE id = $1 AND retrieval_generation = $2
         AND (retrieval_in_flight_fingerprint IS NULL OR retrieval_in_flight_claimed_at IS NULL
              OR retrieval_in_flight_claimed_at <= $7)
         AND ((retrieval_fingerprint IS NULL AND $4::text IS NULL) OR retrieval_fingerprint = $4::text)`,
      [id, generation, requestFingerprint, expectedSnapshotFingerprint, ownerToken, claimedAt, staleBefore],
    );
    return result.rowCount === 1;
  }

  async reconcileRetrievalState(
    id: string,
    generation: number,
    requestFingerprint: string,
    ownerToken: string,
    snapshot: RetrievalSnapshot,
  ): Promise<boolean> {
    if (snapshot.requestFingerprint !== requestFingerprint) return false;
    const result = await this.pool.query(
      `UPDATE sessions SET retrieval = $4, retrieval_fingerprint = $3,
         retrieval_in_flight_fingerprint = NULL, retrieval_in_flight_owner = NULL,
         retrieval_in_flight_claimed_at = NULL
       WHERE id = $1 AND retrieval_generation = $2 AND retrieval_in_flight_fingerprint = $3
         AND retrieval_in_flight_owner = $5`,
      [id, generation, requestFingerprint, JSON.stringify(snapshot), ownerToken],
    );
    return result.rowCount === 1;
  }

  async reconcileDiscoveryState(
    id: string,
    plan: DiscoveryPlan,
    coveredItemIds: string[],
    complete: boolean,
  ): Promise<ProductionDiscoveryState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT production_discovery FROM sessions WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) throw new Error("session not found");
      const current = discoveryState(rows[0].production_discovery);
      const reconciledPlan = pinnedVersionsOrDerived(current, plan);
      if (planPinned(current) && !samePlan(current, reconciledPlan) && !planUpgradable(current, reconciledPlan)) {
        throw new Error("production discovery plan already pinned");
      }
      const discovery: ProductionDiscoveryState = {
        questionFloors: reconciledPlan.questionFloors,
        searchFamily: reconciledPlan.searchFamily,
        coveredItemIds: [...coveredItemIds],
        checkpoint: complete ? "essential_floor_covered" : "family_confirmed",
        fallback: current.fallback, // #228: the visitor's own answer survives a plan re-derivation.
      };
      const changed = JSON.stringify(discovery) !== JSON.stringify(current);
      await client.query(
        `UPDATE sessions SET production_discovery = $2,
           retrieval = CASE WHEN $3 THEN NULL ELSE retrieval END,
           retrieval_fingerprint = CASE WHEN $3 THEN NULL ELSE retrieval_fingerprint END,
           retrieval_generation = CASE WHEN $3 THEN retrieval_generation + 1 ELSE retrieval_generation END,
           retrieval_in_flight_fingerprint = CASE WHEN $3 THEN NULL ELSE retrieval_in_flight_fingerprint END,
           retrieval_in_flight_owner = CASE WHEN $3 THEN NULL ELSE retrieval_in_flight_owner END,
           retrieval_in_flight_claimed_at = CASE WHEN $3 THEN NULL ELSE retrieval_in_flight_claimed_at END
         WHERE id = $1`,
        [id, JSON.stringify(discovery), changed],
      );
      await client.query("COMMIT");
      return discovery;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setDiscoveryFallback(id: string, fallback: DiscoveryFallback): Promise<ProductionDiscoveryState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT production_discovery FROM sessions WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) throw new Error("session not found");
      const discovery: ProductionDiscoveryState = { ...discoveryState(rows[0].production_discovery), fallback };
      await client.query("UPDATE sessions SET production_discovery = $2 WHERE id = $1", [
        id,
        JSON.stringify(discovery),
      ]);
      await client.query("COMMIT");
      return discovery;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveImport(
    id: string,
    fieldId: string,
    value: string,
  ): Promise<ImportProof> {
    const previous = this.resolutionWrites.get(id) ?? Promise.resolve();
    const operation = previous.then(() => this.resolveImportNow(id, fieldId, value));
    this.resolutionWrites.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.resolutionWrites.get(id) === operation) this.resolutionWrites.delete(id);
    }
  }

  private async resolveImportNow(
    id: string,
    fieldId: string,
    value: string,
  ): Promise<ImportProof> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT import_proof FROM sessions WHERE id = $1 FOR UPDATE",
        [id],
      );
      const current = rows[0]?.import_proof as ImportProof | null;
      if (!current) throw new Error("import proof not ready");
      await client.query(
        `INSERT INTO session_import_resolutions (session_id, field_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
        [id, fieldId, value],
      );
      const proof = resolvedProof(current, fieldId, value);
      await client.query("UPDATE sessions SET import_proof = $2 WHERE id = $1", [
        id,
        JSON.stringify(proof),
      ]);
      await client.query("COMMIT");
      return proof;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setTailorTarget(id: string, adId: string): Promise<void> {
    // #31: tailor_floor_ad_id on the right of the CASE reads the PRE-update row (standard SQL: every
    // SET expression in one UPDATE sees the old row, not siblings' new values) — so this resets the
    // floor only when the ad the floor was earned on is actually changing. Keyed to tailor_floor_ad_id
    // (not tailor_ad_id) so a drop (which nulls tailor_ad_id) doesn't lose the floor on re-swipe.
    // NULL = $2 is unknown, not false, so it also falls to ELSE 0 — correct for a first-ever target,
    // which is exactly why the backfill in SESSIONS_ALTERS exists for rows that predate this column.
    await this.pool.query(
      `UPDATE sessions SET stage = 'tailor', tailor_ad_id = $2, tailor_floor_ad_id = $2,
         tailor_floor_pct = CASE WHEN tailor_floor_ad_id = $2 THEN tailor_floor_pct ELSE 0 END
       WHERE id = $1`,
      [id, adId],
    );
  }

  async clearTailorTarget(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET stage = 'deck', tailor_ad_id = NULL WHERE id = $1`, [id]);
  }

  async raiseTailorFloor(id: string, pct: number): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET tailor_floor_pct = GREATEST(tailor_floor_pct, $2) WHERE id = $1`,
      [id, pct],
    );
  }

  async raiseFactFloor(id: string, n: number): Promise<void> {
    await this.pool.query(`UPDATE sessions SET fact_floor = GREATEST(fact_floor, $2) WHERE id = $1`, [id, n]);
  }

  async setClaimedByUserId(id: string, userId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET claimed_by_user_id = $2 WHERE id = $1`, [id, userId]);
  }
}

/** Postgres when DATABASE_URL is set (JC-6), in-memory otherwise (dev/tests). */
export function sessionStoreFromEnv(databaseUrl?: string): SessionStore {
  return databaseUrl ? new PgSessionStore(getPool(databaseUrl)) : new InMemorySessionStore();
}

// Per-IP creation rate limit: a dozen per hour is plenty (s1-kickoff). Fixed window.
// ponytail: in-memory fixed window; move to Redis alongside the BullMQ driver if multi-instance.
export class IpRateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private limit = 12,
    private windowMs = 60 * 60 * 1000,
  ) {}

  allow(ip: string): boolean {
    const now = Date.now();
    const w = this.windows.get(ip);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(ip, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}
