// #63 — a journey names an advert by its fixture id; a card carries the id RETRIEVAL delivered.
//
// The deck is fed by retrieval and nothing else now (preview.ts's sessionPostings), and a retrieved
// advert's id is `posting:<canonicalKey>` by contract — PostingV1's own superRefine enforces it. The
// filename-shaped ids in `apps/api/data/sample-postings.json` are the pool's own keys and never
// appear on a card again, so a journey matching on one silently finds nothing and reports a missing
// advert as a product defect.
//
// Resolved through the real `canonicalKeyOf`, never a re-implementation of its normalisation: two
// copies of that rule would drift, and the whole failure mode this file exists to prevent is a
// journey looking for an id nothing will ever answer to.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalKeyOf } from "@jobcrush/contracts";

const here = dirname(fileURLToPath(import.meta.url));
const POOL_PATH = join(here, "..", "..", "api", "data", "sample-postings.json");

let cached = null;
function pool() {
  if (!cached) cached = JSON.parse(readFileSync(POOL_PATH, "utf8"));
  return cached;
}

/** The id a card carries for the pool advert with this fixture id. Throws rather than returning a
 *  string nothing matches — a journey that mistypes an id should fail loudly at its own setup, not
 *  half an hour later as an unexplained empty deck. */
export function liveAdId(fixtureAdId) {
  const posting = pool().find((p) => p.id === fixtureAdId);
  if (!posting) throw new Error(`live-ad-id: no posting in sample-postings.json with id ${fixtureAdId}`);
  return `posting:${canonicalKeyOf(posting.company, posting.location, posting.title)}`;
}

/** Same, for a list. */
export const liveAdIds = (fixtureAdIds) => fixtureAdIds.map(liveAdId);
