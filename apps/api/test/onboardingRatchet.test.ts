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
// #220 lowered it from 1138: the production discovery route's non-confirmed 409 body moved out to
// familyLabeler.ts (placementRejection) — what an unconfirmed placement offers a visitor next is the
// labeler's business, not the spine's.
// #234 lowered it from 1135: the route's own "is this publication usable?" helper moved to
// familyFloors.ts (eligiblePublication), where the discovery plan reuses it — the ticket's new
// floor-selection seam landed in adaptiveDiscovery.ts and the spine still shrank.
// #235 lowered it from 1132: the per-floor coverage computation moved to adaptiveDiscovery.ts
// (planDiscoveryState / questionFloorItem) and the empty-deck question rule to deck.ts
// (hasOpenDiscoveryQuestions) — the word-search path landed while the spine shrank again.
// #236 lowered it from 1119: the deck's claim-tiering policy (DeckTier / claimTier) moved to
// deck.ts, where the rest of the card-shaping policy already lives, and the miner's `minedRoles`
// accessor to jobs.ts, beside the record it reads — the background family-candidate screen landed
// as one injected dep call and the spine still shrank.
// #243 lowered it from 1110: the deck's card-provenance tally moved to deck.ts
// (tallyCardProvenance), beside the rest of the card-shaping policy — the family-fit deletion +
// confidence ranking landed as deck.ts calls and the spine still shrank.
// #228 lowered it from 1108: the deck's whole card-assembly pass (read → delete wrong-family →
// withdraw → judge → shape + order) moved to deck.ts (buildDeckCards), beside the card-shaping
// policy it composes — the widening offer landed as a new endpoint plus one deckFallback.ts call,
// and the spine shrank by fifty lines.
// #216 lowered it from 1058: the parallel /onboarding/discovery/production/* interview — a second
// discovery engine no client ever called — is gone outright, and the reconciliation it alone
// performed moved to discoveryEngine.ts (reconcileSessionDiscovery), beside the routes the visitor
// actually walks. One engine, and the spine shrank by nearly 150 lines.
const MAX_LINES = 910;

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
