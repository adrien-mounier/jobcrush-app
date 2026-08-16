import { PLACEMENT_SCHEMA_VERSION, type FamilyPlacement } from "@jobcrush/contracts";
import { buildServer as baseBuildServer } from "../src/server.js";

export const IT_PROJECT_DELIVERY_PLACEMENT: FamilyPlacement = {
  schemaVersion: PLACEMENT_SCHEMA_VERSION,
  outcome: "confirmed",
  families: [{ familyId: "it-project-delivery", version: 1 }],
  confidence: "certain",
};

export const buildItProjectDeliveryServer = (
  opts: NonNullable<Parameters<typeof baseBuildServer>[0]> = {},
) => baseBuildServer({ placeFamily: async () => IT_PROJECT_DELIVERY_PLACEMENT, ...opts });
