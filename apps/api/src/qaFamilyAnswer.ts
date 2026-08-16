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
/** The family this QA stack can actually place into: qa-main runs the REAL production registry, and
 *  it publishes exactly one family. Naming any other id (even a plausible second family) fails the
 *  closed-vocabulary check in familyLabeler.ts and degrades to unmapped — the same silent failure
 *  this module exists to prevent. A live drive that needs a two-family placement must inject a
 *  second published family as well as the answer. */
export const QA_FAMILY_ID = "it-project-delivery";

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
  return /project|programme|program|delivery|scrum|\bpm\b/.test(role)
    ? JSON.stringify({ outcome: "confirmed", familyIds: [QA_FAMILY_ID], confidence: "certain" })
    : JSON.stringify({ outcome: "unmapped" });
}
