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

let cachedAdRequirements: unknown[] | null = null;
function loadAllAdRequirements(): unknown[] {
  if (!cachedAdRequirements) {
    cachedAdRequirements = JSON.parse(
      readFileSync(join(here, "..", "data", "sample-ad-requirements.json"), "utf8"),
    ) as unknown[];
  }
  return cachedAdRequirements;
}

// #114: found / missing / invalid — the three-way answer loadAdRequirements's old throw-or-value
// shape couldn't give. resolveAdRequirements (routes/onboarding.ts) needs to tell "nobody ever wrote
// a fixture for this adId" (fall through to the reader, unchanged) apart from "someone DID, and it
// fails to parse" (drop the card, count it, and make NO model call for an advert that was already
// hand-curated) — a bare try/catch around loadAdRequirements collapsed both into one branch.
export type FixtureLookup =
  | { status: "found"; requirements: AdRequirementsV1 }
  | { status: "missing" }
  | { status: "invalid" };

interface FixtureIndexEntry {
  // null marks an entry that failed AdRequirementsV1.safeParse. Kept IN the index (not dropped)
  // under its own adId so a lookup for that id answers "invalid", not "missing" — the whole reason
  // this index exists.
  requirements: AdRequirementsV1 | null;
}

let cachedFixtureIndex: Map<string, FixtureIndexEntry> | null = null;
// #114 test-only escape hatch (see withFixtureOverrideForTest below): when set, buildFixtureIndex
// parses THIS array instead of the real on-disk file. null (the default, and what production always
// sees) means "use the real file". Never read outside buildFixtureIndex.
let fixtureOverrideForTest: unknown[] | null = null;

// Same bound recordReadFailure uses (counters.ts's READ_FAILURE_MESSAGE_LIMIT) — a raw zod error
// message has no business unbounded in a log line (#115 finding 3's convention, applied here too).
const FIXTURE_ERROR_MESSAGE_LIMIT = 500;

/** Parses every hand-authored fixture entry exactly ONCE per process — #114: one parse, one count,
 *  one truth, shared by loadAdRequirements/lookupAdRequirements/listAdRequirements below.
 *
 *  Known limit, accepted for this slice: an entry found invalid here stays invalid for the rest of
 *  the process's life — nothing retries it. That is CORRECT for today's repo-baked, static fixture
 *  file: the bytes on disk don't change at runtime, so retrying would re-parse the identical broken
 *  JSON and fail identically every time; a corrected file only takes effect via a redeploy, which
 *  restarts the process and rebuilds this index from scratch anyway. It needs revisiting the moment
 *  a "fixture" can wrap something that changes without a redeploy — e.g. a live posting feed
 *  (#99-#101) — at which point "invalid forever, this process" stops accurately describing the
 *  underlying data's own lifecycle.
 *
 *  Duplicate adIds: an entry that fails validation is still indexed, under `requirements: null`,
 *  keyed by ITS OWN adId — UNLESS that adId is itself missing or the wrong type, in which case there
 *  is no key to index it under (still counted and logged below; just unfindable by id afterward — an
 *  honest limit of a KEYED index, not a bug). If the SAME adId appears more than once in the raw
 *  file, a VALID entry always wins over an INVALID one for that id, whatever order they appear in —
 *  #114 review: the first version of this function just called `index.set()` in a loop, so array
 *  order silently decided a duplicate's outcome (last entry wins); a broken copy-pasted duplicate
 *  appearing AFTER a good entry would shadow it and turn a resolvable card into a dropped one with
 *  no signal beyond a counter bump — exactly the "a winnable job silently disappears" failure #86
 *  names as this engine's worst case. Among two duplicates of the SAME validity, the FIRST one in
 *  the file wins, matching the pre-#114 `Array.find()` semantics this index replaced. */
function buildFixtureIndex(): Map<string, FixtureIndexEntry> {
  const index = new Map<string, FixtureIndexEntry>();
  for (const entry of fixtureOverrideForTest ?? loadAllAdRequirements()) {
    const parsed = AdRequirementsV1.safeParse(entry);
    if (parsed.success) {
      const existing = index.get(parsed.data.adId);
      // A valid entry always wins over whatever's already indexed for this id (nothing, or an
      // earlier invalid duplicate) — see this function's own doc above. Two valid duplicates: the
      // first one indexed (i.e. first in the file) is left in place.
      if (!existing || existing.requirements === null) {
        index.set(parsed.data.adId, { requirements: parsed.data });
      }
      continue;
    }
    incrementCounter("postings.fixture_invalid");
    const rawAdId =
      typeof entry === "object" && entry !== null && "adId" in entry
        ? (entry as { adId?: unknown }).adId
        : undefined;
    // Same log-plus-counter convention as recordReadFailure (counters.ts) — the counter says a
    // fixture broke, this says WHICH one and why, so it's diagnosable from Fly's logs. Unlike a read
    // failure there's nothing here to alarm on: the fixture set doesn't change at runtime, so a
    // human fixes the file once and it's done.
    console.error(
      `[ops] fixture invalid${typeof rawAdId === "string" ? ` for adId ${rawAdId}` : " (adId itself missing or unreadable)"}: ${parsed.error.message.slice(0, FIXTURE_ERROR_MESSAGE_LIMIT)}`,
    );
    // Never overwrites an id something ELSE already claimed — a valid entry must not be shadowed by
    // a later invalid duplicate (handled above), and among invalid duplicates the first one wins.
    if (typeof rawAdId === "string" && !index.has(rawAdId)) index.set(rawAdId, { requirements: null });
  }
  return index;
}

function fixtureIndex(): Map<string, FixtureIndexEntry> {
  if (!cachedFixtureIndex) cachedFixtureIndex = buildFixtureIndex();
  return cachedFixtureIndex;
}

/** #114: the three-way lookup resolveAdRequirements (routes/onboarding.ts) uses directly so it can
 *  act differently on each outcome — found/missing behave exactly as loadAdRequirements always did;
 *  invalid is new. */
export function lookupAdRequirements(adId: string): FixtureLookup {
  const entry = fixtureIndex().get(adId);
  if (!entry) return { status: "missing" };
  return entry.requirements ? { status: "found", requirements: entry.requirements } : { status: "invalid" };
}

/** Finds the stubbed requirements for `adId` (#102: the whole app reads v1 now). Throws for BOTH
 *  "never had a fixture" and "fixture failed to parse" — a coarser answer than lookupAdRequirements
 *  gives, kept because the remaining callers (this file's own tests, cards.test.ts's test helpers)
 *  only need throw-or-value and don't need those two apart the way resolveAdRequirements now does. */
export function loadAdRequirements(adId: string): AdRequirementsV1 {
  const result = lookupAdRequirements(adId);
  if (result.status === "found") return result.requirements;
  throw new Error(`no ad requirements stubbed for adId: ${adId}`);
}

/** Every stubbed ad's requirements that parsed cleanly. #19's card deck joins these against
 *  sample-postings.json by adId to find its scorable candidate cards. Built from the shared index
 *  loadAdRequirements/lookupAdRequirements also use — one parse, one count, one truth. #114 review:
 *  this used to call a separate parseAdRequirementsList helper that did its own independent pass
 *  over the raw array (and its own increment of postings.fixture_invalid) — a broken duplicate of
 *  what the index above already does, and production could reach both on the same request. Deleted
 *  outright rather than left as a test-only orphan: a second live implementation of the same count
 *  is exactly the "two independent counting paths" hazard this ticket exists to remove. Its one
 *  surviving behaviour proof (a broken entry doesn't take the whole list down) now lives in
 *  e5stub.test.ts against THIS function, via withFixtureOverrideForTest below, so it's proven
 *  against the code production actually runs. */
export function listAdRequirements(): AdRequirementsV1[] {
  return Array.from(fixtureIndex().values())
    .map((entry) => entry.requirements)
    .filter((r): r is AdRequirementsV1 => r !== null);
}

/** #114 test-only: rebuilds the fixture index from `buildRaw(realRawFixtures)` instead of the real
 *  on-disk file for the duration of `fn`, then restores the real index — lets a test exercise a
 *  corrupt hand-authored entry at the actual parse-and-count seam (buildFixtureIndex above) without
 *  ever touching sample-ad-requirements.json, which several other suites assert on directly. Follows
 *  the same test-only-hatch-beside-the-real-cache convention resetCountersForTest (counters.ts)
 *  established — not a literal mirror of its shape: that one is a zero-arg, synchronous reset;
 *  this one is async and higher-order because the thing being substituted (the raw fixture array)
 *  has to be in place for the whole duration of an async `fn`, not just reset-and-forget. Never
 *  called by production code. */
export async function withFixtureOverrideForTest<T>(
  buildRaw: (real: unknown[]) => unknown[],
  fn: () => Promise<T>,
): Promise<T> {
  fixtureOverrideForTest = buildRaw(loadAllAdRequirements());
  cachedFixtureIndex = null;
  try {
    return await fn();
  } finally {
    fixtureOverrideForTest = null;
    cachedFixtureIndex = null;
  }
}
