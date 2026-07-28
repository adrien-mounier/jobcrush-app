import { FamilyFloorV1, type FamilyFloorV1 as FamilyFloorV1Value } from "@jobcrush/contracts";

const keyOf = (familyId: string, version: number) => `${familyId}@${version}`;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * Isolated catalog for deterministic contract/integration fixtures.
 * It deliberately has no production publication path and cannot authorize a reward.
 */
export class TestFixtureFamilyFloorStore {
  private readonly floors = new Map<string, FamilyFloorV1Value>();

  add(input: unknown): FamilyFloorV1Value {
    const floor = deepFreeze(structuredClone(FamilyFloorV1.parse(input)));
    const key = keyOf(floor.familyId, floor.version);
    if (this.floors.has(key)) {
      throw new Error(`family floor version already exists: ${key}`);
    }
    this.floors.set(key, floor);
    return floor;
  }

  get(familyId: string, version: number): FamilyFloorV1Value | null {
    return this.floors.get(keyOf(familyId, version)) ?? null;
  }

  canUnlockProductionDiscoveryReward(): false {
    return false;
  }
}
