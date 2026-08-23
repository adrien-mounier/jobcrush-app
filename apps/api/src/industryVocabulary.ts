// #280 — the closed INDUSTRY vocabulary: the words the second label axis speaks, published as
// reviewed data and read as data forever after. An agent drafted the first list from real evidence,
// the owner approved it, and what ships is this file plus a JSON publication. Nothing here asks a
// model how close two industries are: closeness falls out of the group tree the owner approved
// (ADR-0014 decision 2, as amended by #279), which is why it can be tested at all.
//
// Deliberately NOT in packages/contracts: like the family registry it mirrors, this is published
// app data, not a stored or wire shape. The industry PLACEMENT that lands on a job record is the
// contract, and it arrives with its own oracle in #281.
import { readFileSync } from "node:fs";
import { SLUG } from "@jobcrush/contracts";
import { z } from "zod";

const IndustryGroup = z
  .object({
    groupId: z.string().regex(SLUG),
    label: z.string().trim().min(1),
    // What this group covers, and where its edge is. Load-bearing rather than decorative: a group
    // is the whole definition of `near`, so a group wide enough to swallow unrelated businesses
    // makes near-credit free credit. The sentence is what an owner reads when deciding to split it.
    scope: z.string().trim().min(1),
  })
  .strict();

const Industry = z
  .object({
    industryId: z.string().regex(SLUG),
    label: z.string().trim().min(1),
    // Same reason the family registry publishes a scope (familyFloors.ts): a closed vocabulary the
    // labeler cannot find the boundary of swings between taking in strangers and turning away
    // members on the same evidence. The edge belongs in the words, not in the eval grid.
    scope: z.string().trim().min(1),
    version: z.number().int().positive(),
    // Exactly one — a single group id, not a list. Two groups would make `near` transitive through
    // an industry nobody compared, which is the pairwise-table failure #279 rejected.
    groupId: z.string().regex(SLUG),
  })
  .strict();

export const IndustryVocabularyDocument = z
  .object({
    schemaVersion: z.literal("1"),
    reviewedBy: z.string().trim().min(1),
    reviewedAt: z.string().datetime(),
    groups: z.array(IndustryGroup).min(1),
    industries: z.array(Industry).min(1),
  })
  .strict();

export type IndustryGroup = z.infer<typeof IndustryGroup>;
export type Industry = z.infer<typeof Industry>;
export type IndustryVocabularyDocumentValue = z.infer<typeof IndustryVocabularyDocument>;

/** Three answers and no others (#279). `far` is the honest default, including for an id we never
 *  published — a caller holding an unpublished id has an untestable bar, and #284 decides that
 *  before it ever gets here. */
export type IndustryCloseness = "exact" | "near" | "far";

const keyOf = (industryId: string, version: number) => `${industryId}@${version}`;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

const sameEntry = (a: Industry, b: Industry) =>
  a.label === b.label && a.scope === b.scope && a.groupId === b.groupId;

/**
 * The published vocabulary, and the closeness rule read off it.
 *
 * A publication is the WHOLE list at once, not one entry at a time: the group tree only means
 * anything as a set, and half a tree cannot be checked for a group nobody defined.
 */
export class IndustryVocabulary {
  private readonly versions = new Map<string, Industry>();
  private readonly activeVersions = new Map<string, number>();
  private groups = new Map<string, IndustryGroup>();

  publish(input: unknown): IndustryVocabularyDocumentValue {
    const document = IndustryVocabularyDocument.parse(structuredClone(input));

    const groupIds = document.groups.map((group) => group.groupId);
    const duplicateGroup = groupIds.find((id, index) => groupIds.indexOf(id) !== index);
    if (duplicateGroup !== undefined) {
      throw new Error(`duplicate industry group id: ${duplicateGroup}`);
    }

    const industryIds = document.industries.map((industry) => industry.industryId);
    const duplicateIndustry = industryIds.find((id, index) => industryIds.indexOf(id) !== index);
    if (duplicateIndustry !== undefined) {
      throw new Error(`duplicate industry id: ${duplicateIndustry}`);
    }

    // Checked over every version we can still READ, not just the ones being published: an older
    // version stays retrievable by `get` (decision 7), so a republication that quietly drops a
    // group would strand it pointing at a group nobody can look up. The gate refuses instead — a
    // group is retired by first moving every industry that names it.
    const undefinedGroup = [...this.versions.values(), ...document.industries].find(
      (industry) => !groupIds.includes(industry.groupId),
    );
    if (undefinedGroup !== undefined) {
      throw new Error(
        `industry names a group that is not defined: ${undefinedGroup.industryId} -> ${undefinedGroup.groupId}`,
      );
    }

    // ADR-0014 decision 7, enforced rather than promised: a stored placement keeps the version it
    // was made under and reads its words back by that version, so an id@version must mean the same
    // thing forever. An entry may keep its version only while nothing about it changed; the moment
    // it says something different it needs a new number. A version going BACKWARDS is refused by
    // the same test, which is the case an editor hits by hand.
    for (const industry of document.industries) {
      const previousVersion = this.activeVersions.get(industry.industryId);
      if (previousVersion === undefined) continue;
      const previous = this.versions.get(keyOf(industry.industryId, previousVersion));
      const unchanged =
        industry.version === previousVersion && previous !== undefined && sameEntry(previous, industry);
      if (industry.version <= previousVersion && !unchanged) {
        throw new Error(
          `industry version must increase: ${industry.industryId} (${previousVersion} -> ${industry.version})`,
        );
      }
    }

    const frozen = deepFreeze(document);
    this.groups = new Map(frozen.groups.map((group) => [group.groupId, group]));
    for (const industry of frozen.industries) {
      this.versions.set(keyOf(industry.industryId, industry.version), industry);
      this.activeVersions.set(industry.industryId, industry.version);
    }
    return frozen;
  }

  active(industryId: string): Industry | null {
    const version = this.activeVersions.get(industryId);
    return version === undefined ? null : this.get(industryId, version);
  }

  /** Read back by version, for a placement stored under an older publication. */
  get(industryId: string, version: number): Industry | null {
    return this.versions.get(keyOf(industryId, version)) ?? null;
  }

  /** Every industry at its ACTIVE version — the closed list a labeler places into and an advert
   *  reader picks from. Superseded versions stay retrievable by `get` and are never offered. */
  activeIndustries(): Industry[] {
    return Array.from(this.activeVersions.keys(), (id) => this.active(id))
      .filter((industry): industry is Industry => industry !== null);
  }

  group(groupId: string): IndustryGroup | null {
    return this.groups.get(groupId) ?? null;
  }

  /** Same industry is `exact`, a different industry in the same group is `near`, everything else
   *  is `far`. Read off today's active group tree: a republished vocabulary can move an industry
   *  between groups, and closeness is then answered by the tree we currently believe — which
   *  changes no stored placement, only how a live comparison reads.
   *
   *  Symmetric: the parameter names describe the ordinary call site (a person's industry against
   *  an advert's bar), not a direction the answer depends on. */
  closeness(held: string, required: string): IndustryCloseness {
    if (held === required && this.active(held) !== null) return "exact";
    const heldGroup = this.active(held)?.groupId;
    const requiredGroup = this.active(required)?.groupId;
    return heldGroup !== undefined && heldGroup === requiredGroup ? "near" : "far";
  }
}

/** The production vocabulary. Every publication is loaded oldest first, for the same reason the
 *  family registry loads every version: a placement stored against v1 is read back by v1.
 *  v2 (2026-08-23, owner arbitration of grid pair near-07): the public-and-social group is split —
 *  healthcare and education each hold their own group, so a hospital career no longer credits a
 *  school advert's bar. The labeler never sees groups, so v2 changes no placement, only closeness. */
export function publishedIndustryVocabulary(): IndustryVocabulary {
  const vocabulary = new IndustryVocabulary();
  for (const file of ["../research/industry-vocabulary-v1.json", "../research/industry-vocabulary-v2.json"]) {
    vocabulary.publish(JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")));
  }
  return vocabulary;
}
