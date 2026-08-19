import { PLACEMENT_SCHEMA_VERSION, type FamilyPlacement } from "@jobcrush/contracts";
// #63: deck-wired (retrieval seam + curated requirement sets) — see fixtureDeck.ts.
import { buildDeckServer as baseBuildServer } from "./fixtureDeck.js";

export const IT_PROJECT_DELIVERY_PLACEMENT: FamilyPlacement = {
  schemaVersion: PLACEMENT_SCHEMA_VERSION,
  outcome: "confirmed",
  families: [{ familyId: "it-project-delivery", version: 1 }],
  confidence: "certain",
};

export const buildItProjectDeliveryServer = (
  opts: NonNullable<Parameters<typeof baseBuildServer>[0]> = {},
) => baseBuildServer({ placeFamily: async () => IT_PROJECT_DELIVERY_PLACEMENT, ...opts });
