// E5 boundary stub (#12): hand-authored fixtures standing in for the real cluster engine
// (S3/JC-31). Mirrors preview.ts's loadPostings() cache + read pattern. Per the spec, the E5
// boundary is the pinned fixture, not a third test seam — every value returned here is parsed
// through its zod schema before the caller sees it, so callers always get a validated value.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FamilyFloor, AdRequirementsV1 } from "@jobcrush/contracts";

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

/** Every stubbed ad's requirements, each validated against the AdRequirementsV1 schema. #19's card
 *  deck joins these against sample-postings.json by adId to find its scorable candidate cards. */
export function listAdRequirements(): AdRequirementsV1[] {
  return loadAllAdRequirements().map((r) => AdRequirementsV1.parse(r));
}
