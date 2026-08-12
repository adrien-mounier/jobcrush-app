import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Ratchet on routes/onboarding.ts (owner decision, 2026-08-09): the file may only
// shrink. It is the app's spine — it coordinates every subsystem — and the failure
// mode this guards against is helpers and business logic accumulating inside it.
//
// If this test fails because the file grew:
//   1. Do NOT raise MAX_LINES. Raising it requires the owner's explicit OK,
//      recorded in the commit message.
//   2. Put the new logic in its own module next to the subsystem it belongs to
//      (matchtick, judge, tailor, discovery, ...) and keep the route entry thin.
//      New endpoints are fine — their fat goes elsewhere.
//   3. If your ticket touched one of the in-file helpers (e.g. buildJobCard,
//      buildTailorState), move that helper out as part of the ticket, then
//      LOWER MAX_LINES to the new count. The ratchet only turns one way.
// #162 lowered this from 1282: the eligibility answer's whole write path moved out of the spine to
// eligibilityDiscovery.ts (answerEligibilityItem), and the new date-hole answer path went straight
// into yearsWorked.ts rather than in here.
// #165 lowered it again from 1184: the deck's withdrawal filter + per-language tally moved to
// withdrawal.ts (partitionByWithdrawal) and the language ladder's whole rule set went into its own
// module (languageLevel.ts), so the ticket's new endpoint landed while the spine still shrank.
const MAX_LINES = 1138;

describe("onboarding.ts ratchet", () => {
  it(`routes/onboarding.ts stays at or under ${MAX_LINES} lines`, () => {
    const path = fileURLToPath(new URL("../src/routes/onboarding.ts", import.meta.url));
    const lines = readFileSync(path, "utf8").replace(/\r?\n$/, "").split("\n").length;
    expect(
      lines,
      `routes/onboarding.ts is ${lines} lines (limit ${MAX_LINES}). ` +
        "Extract logic into its subsystem module instead of growing the spine — see the comment in this test.",
    ).toBeLessThanOrEqual(MAX_LINES);
  });
});
