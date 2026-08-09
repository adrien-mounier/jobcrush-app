// #20 profile payload assembly, extracted from routes/onboarding.ts (the ratchet: route entries
// stay thin, logic lives beside its subsystem) — plus #179's search block, the data the profile
// rail's Job family section draws.
//
// Colour law (#20): a fact is gold iff its claim id appears in the rendered root CV's trace. That
// trace derives from the same confirmed renderable facts as /onboarding/build; grey otherwise
// means mined-but-not-yet-confirmed, i.e. still `pending` in the deck. Rejected/negative claims
// are stripped before this module is called (AC5): the profile never lists what the visitor
// lacks, while negatives still count in factCount.
import { buildClaimGraph, kindTag } from "./graph.js";
import { renderRootCv, SECTIONS } from "./rootcv.js";
import type { ClaimRecord } from "./claims.js";
import type { ContactRecord } from "./contact.js";

// The pinned frontend contract — apps/web/lib/api.ts mirrors these shapes.
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
/** #179: what the profile rail's Job family section draws. Until E5 (#86) places typed roles into
 *  families, `family` is null for EVERYONE — the rail shows the honest empty state (the role as
 *  typed + the "Not the job you meant?" door), never the resolveFamily() stub, which attributes
 *  the same family to every visitor. The stub keeps its internal jobs (floor selection,
 *  eligibility scoping); it must not reach a display again (#179 decision, 2026-08-09).
 *  When E5 lands, this is the seam that lights up: `family` from placement, `siblingTitles` from
 *  the family record (never containing `role` as typed), and `openJobs` from discovery.ts's
 *  promiseCount(family) — the same producer as the onboarding promise count, per #179's third
 *  falsifiable check. */
export interface ProfileSearch {
  role: string | null; // exactly as typed at Q1 (session.targetTitles[0]); null before Q1
  family: string | null;
  siblingTitles: string[];
  openJobs: number | null;
}
/** #190: one field of the profile's contact block — a value plus which kind of origin it has
 *  (ADR-0004 clause 1a), never the value alone, so the screen can render "you told us" vs "read
 *  from your CV" without a second lookup. */
export interface ProfileContactField {
  value: string;
  origin: "read" | "person-said";
}
export interface ProfileContact {
  phone: ProfileContactField | null;
  email: ProfileContactField | null;
}
export interface ProfileState {
  domains: ProfileDomain[];
  factCount: number;
  search: ProfileSearch;
  contact: ProfileContact;
}

export function profileSearch(role: string | null): ProfileSearch {
  return { role, family: null, siblingTitles: [], openJobs: null };
}

const toProfileContactField = (v: ContactRecord["phone"]): ProfileContactField | null =>
  v ? { value: v.value, origin: v.origin } : null;

export const EMPTY_PROFILE_CONTACT: ProfileContact = { phone: null, email: null };

/** Assembles GET /profile's payload: facts grouped by kind tag in SECTIONS order, coloured by the
 *  colour law above. `facts` excludes rejected/negative; `confirmed` is its confirmed subset
 *  (passed in rather than re-filtered so the route's one list() read serves both). */
export function buildProfileState(
  facts: ClaimRecord[],
  confirmed: ClaimRecord[],
  factCount: number,
  role: string | null,
  contact: ContactRecord = { phone: null, email: null },
): ProfileState {
  const rootCv = renderRootCv(buildClaimGraph(confirmed));
  const goldIds = new Set(rootCv.trace.entries.flatMap((e) => e.nodeIds));

  const byTag = new Map<string, ProfileFact[]>();
  for (const c of facts) {
    const tag = kindTag(c);
    const bucket = byTag.get(tag) ?? [];
    bucket.push({
      id: c.id,
      text: c.text,
      colour: goldIds.has(c.id) ? "gold" : "grey",
      source: c.origin === "user-authored" ? "told" : "read",
    });
    byTag.set(tag, bucket);
  }

  const domains: ProfileDomain[] = SECTIONS.filter(([tag]) => byTag.has(tag)).map(([tag, heading]) => ({
    tag,
    heading,
    facts: byTag.get(tag)!,
  }));
  return {
    domains,
    factCount,
    search: profileSearch(role),
    contact: { phone: toProfileContactField(contact.phone), email: toProfileContactField(contact.email) },
  };
}
