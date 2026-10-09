// #231 — the QA stack's canned answer for the family labeler, extracted from qa-main.ts for one
// reason: qa-main.ts starts a server on import, so nothing could ever test what its fake says.
//
// That gap cost a whole path. When #231 changed the labeler's answer shape (`familyId` string ->
// `familyIds` array, plus a required confidence), this fake kept speaking the old dialect. The real
// parser rejected every answer, retried once, and degraded to unmapped — so against the QA stack no
// job and no target role could be placed at all, while every CI tier stayed green, because nothing
// in any tier drives the fake. A fake that speaks a dialect the parser rejects does not fail
// loudly; it silently reports the feature missing.
//
// Living here, it is parsed by the real contract in qaFamilyAnswer.test.ts, so the next shape change
// breaks a test instead of going dark.
/** The families this QA stack can actually place into: qa-main runs the REAL production registry,
 *  which publishes it-project-delivery AND (since #255's pilot run) business-analysis. Naming any
 *  id outside the registry fails the closed-vocabulary check in familyLabeler.ts and degrades to
 *  unmapped — the same silent failure this module exists to prevent. #255's QA gate caught this
 *  module doing exactly that: the registry grew a second family and this fake kept answering
 *  unmapped for it, so the QA stack demonstrated the OPPOSITE of the publication's own AC. */
export const QA_FAMILY_ID = "it-project-delivery";
export const QA_SECOND_FAMILY_ID = "business-analysis";
/** #361: the third family. Same reason as the second: the registry grew, so the fake grows with it. */
export const QA_THIRD_FAMILY_ID = "product-management";

/** Reads the role out of a rendered family-labeler prompt. `\s+` rather than `\n\n`:
 *  prompts/family-labeler.md is read straight off disk, and this repo's git checkout rewrites line
 *  endings on Windows — a literal `\n\n` would quietly stop matching there and place every role as
 *  unmapped. */
export function roleFromLabelerPrompt(prompt: string): string {
  return (/## The role to place\s+(.+)/.exec(prompt) ?? [, ""])[1]!.trim().toLowerCase();
}

/**
 * What the QA fake answers for one role. Deliberately NOT always-confirmed: a QA journey has to be
 * able to walk both ends of this — discovery opening for a visitor the vocabulary covers, and the
 * honest "we don't cover this kind of work yet" for one it doesn't — and a fake that confirmed
 * everything would make the second path unreachable.
 *
 * "coordinator" is the one canned job title left UNPLACED (#221). Every other job in the canned CV
 * places cleanly. No journey types a coordinator TARGET role, so the target-role path is untouched.
 */
export function qaFamilyAnswer(role: string): string {
  if (/coordinator/.test(role)) return JSON.stringify({ outcome: "unmapped" });
  if (/project|programme|program|delivery|scrum|\bpm\b/.test(role)) {
    return JSON.stringify({ outcome: "confirmed", familyIds: [QA_FAMILY_ID], confidence: "certain" });
  }
  // #255: the registry's second family — analyst-shaped roles place here, so a journey can walk a
  // fresh placement into it (the publication AC's locally provable half).
  if (/business analy|requirements analy|process analy/.test(role)) {
    return JSON.stringify({ outcome: "confirmed", familyIds: [QA_SECOND_FAMILY_ID], confidence: "certain" });
  }
  // #361: product owner / product manager roles place in the third family. After the delivery check
  // on purpose: "product delivery manager" is delivery work whose subject is a product.
  if (/product owner|product manager|head of product/.test(role)) {
    return JSON.stringify({ outcome: "confirmed", familyIds: [QA_THIRD_FAMILY_ID], confidence: "certain" });
  }
  return JSON.stringify({ outcome: "unmapped" });
}
