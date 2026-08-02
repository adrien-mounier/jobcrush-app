// E5 boundary stub (#12): hand-authored fixtures standing in for the real cluster engine
// (S3/JC-31). Mirrors preview.ts's loadPostings() cache + read pattern. Per the spec, the E5
// boundary is the pinned fixture, not a third test seam — every value returned here is parsed
// through its zod schema before the caller sees it, so callers always get a validated value.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FamilyFloor, AdRequirementsV1 } from "@jobcrush/contracts";
import { incrementCounter } from "./counters.js";

const here = dirname(fileURLToPath(import.meta.url));

let cachedFamilyFloors: FamilyFloor[] | null = null;
function loadFamilyFloors(): FamilyFloor[] {
  if (!cachedFamilyFloors) {
    cachedFamilyFloors = JSON.parse(
      readFileSync(join(here, "..", "data", "sample-family-floors.json"), "utf8"),
    ) as FamilyFloor[];
  }
  return cachedFamilyFloors;
}

/** Finds the stubbed floor for `family` and validates it against the FamilyFloor schema. */
export function loadFamilyFloor(family: string): FamilyFloor {
  const found = loadFamilyFloors().find((f) => f.family === family);
  if (!found) throw new Error(`no family floor stubbed for family: ${family}`);
  return FamilyFloor.parse(found);
}

/** Every known family name — the closed list #104's ad-reader prompt offers the model, so it picks
 *  from real families instead of inventing free-form ones. */
export function knownFamilies(): string[] {
  return loadFamilyFloors().map((f) => f.family);
}

let cachedAdRequirements: AdRequirementsV1[] | null = null;
function loadAllAdRequirements(): AdRequirementsV1[] {
  if (!cachedAdRequirements) {
    cachedAdRequirements = JSON.parse(
      readFileSync(join(here, "..", "data", "sample-ad-requirements.json"), "utf8"),
    ) as AdRequirementsV1[];
  }
  return cachedAdRequirements;
}

/** Finds the stubbed requirements for `adId` and validates them against the AdRequirementsV1 schema
 *  (#102: the whole app reads v1 now). */
export function loadAdRequirements(adId: string): AdRequirementsV1 {
  const found = loadAllAdRequirements().find((r) => r.adId === adId);
  if (!found) throw new Error(`no ad requirements stubbed for adId: ${adId}`);
  return AdRequirementsV1.parse(found);
}

/** Parses a raw ad-requirements array defensively — one broken advert must never take the whole
 *  list down. #104 carry-forward from the #102 review: `.map(parse)` throwing out of the map is
 *  exactly the failure mode this slice makes real once requirements start arriving from a model
 *  instead of hand-authored, test-validated fixtures. Dropped entries count against
 *  postings.fixture_invalid — its OWN counter (#104 review finding 6), not postings.read_failed: a
 *  broken hand-authored fixture has nothing to do with the model and must not move the read-failure
 *  alarm's rate. */
export function parseAdRequirementsList(raw: unknown[]): AdRequirementsV1[] {
  return raw.flatMap((r) => {
    const parsed = AdRequirementsV1.safeParse(r);
    if (!parsed.success) {
      incrementCounter("postings.fixture_invalid");
      return [];
    }
    return [parsed.data];
  });
}

let cachedValidAdRequirements: AdRequirementsV1[] | null = null;
/** Every stubbed ad's requirements, each validated against the AdRequirementsV1 schema. #19's card
 *  deck joins these against sample-postings.json by adId to find its scorable candidate cards.
 *  Cached (like loadPostings()'s language labelling) so a bad fixture is counted ONCE per process
 *  lifetime, not once per call — #104 review finding 6: the pool doesn't change at runtime, so
 *  re-parsing and re-counting on every read would inflate postings.fixture_invalid every time this
 *  is called, unlike every other ingest-time counter in this file. */
export function listAdRequirements(): AdRequirementsV1[] {
  if (!cachedValidAdRequirements) cachedValidAdRequirements = parseAdRequirementsList(loadAllAdRequirements());
  return cachedValidAdRequirements;
}
