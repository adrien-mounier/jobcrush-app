# S2 kickoff — "Own your facts" (decisions, 2026-07-18)

Product decisions agreed before starting S2 dev. Per-ticket ACs remain in the archived
`dev-plan-v01-hosted.md` (JobCrush repo); where this doc and the archive disagree, this doc wins.

## The flow

Anonymous preview (S1, unchanged) → **signup wall** → **confirm deck** → **grill** → **root CV** →
**review** → **audit** → **gate** → profile `ready`, claim graph v1 in Postgres.

## Decisions

1. **S2's user-facing reward is the downloadable root CV.** "You now own your facts — here is your
   verified master CV." The renderer + PDF must be polished; it can reuse the S1 preview renderer.
   Without this payoff, S2 is 15 minutes of homework with nothing at the end.

2. **Signup wall sits immediately after the preview** (JC-18/19/20). The only anonymous assets that
   ever exist are the uploaded CV + its preview job — so the anon→account merge is a single ownership
   update, and purge is one rule (delete anon uploads older than N days). If wall drop-off proves
   brutal, moving the wall later is the easy direction; the reverse is not.

3. **Deck tiering = stakes × uncertainty** (JC-21/22/23). Each mined claim carries a source quote and
   a quoted-vs-inferred flag. Individual-card score = damage-if-wrong (fixed weights per claim type:
   titles/employers/dates/metrics high, skills/tools low) × miner uncertainty. Top ≤15 get individual
   **yes / edit / reject** cards; the rest are batch cards grouped by CV section with tap-to-remove.
   An edited claim becomes a **user-authored claim, auto-confirmed** (the user typed it).

4. **Grill = gap-filling only, hard cap ~5–8 questions** (JC-24/26). Gaps (missing dates, metrics-less
   achievements, timeline holes) are detected mechanically from the claim graph; the LLM only phrases
   the questions. Answers persist as confirmed claims immediately (`source: user-authored`). The deck
   is the truth mechanism — the grill never re-verifies. Verification-style and open-ended mining
   grills are S4 (voice grill).

5. **The gate judges our work, never the user's career** (JC-31). Checks are mechanical: graph passes
   the ported validator (JC-32), every rendered sentence traces to a confirmed claim, conservation
   holds, must-fill gaps were at least asked. A thin-but-honest profile passes and flips to `ready`.
   Failures are auto-retryable or a precise loop-back to one card/question — never a dead end, never
   a judgment. (Profile-strength feedback is the future advisory "improve your profile" feature —
   see roadmap "Later".)

6. **Audit vs gate:** the audit is the LLM re-reading the finished root CV against `docs/cv-brain/`
   rules (AI tells, formatting, conservation) and fixing wording; the gate is the mechanical
   checklist after it. Audit polishes; gate certifies.

7. **Root-CV review is read-only + "fix this" loop-backs** (JC-27). Every rendered sentence keeps
   pointers to the claim(s) behind it (needed for conservation checks anyway). "Something wrong?"
   reopens the claim card or grill question; the fix flows through the claims store and the CV
   re-renders. **Never a freeform text editor** — freeform edits are unverified content and break
   traceability. Same pointer machinery serves the gate's loop-backs.

8. **Path B ("I don't have a CV", JC-55) is a stub in S2** — a polite "coming soon" door. The real
   guided interview ships in S4 with the voice grill.

## Build order

E4 spine first (riskiest): JC-32 validator port → claims store schema → JC-31 gate → JC-27 renderer.
Then E3 deck + grill, then E2 auth.

## Open checks before building

- Does the S1 miner (`apps/api/prompts/claim-miner.md`) already emit a source quote +
  quoted-vs-inferred flag per claim? Deck tiering needs both.
- Confirm while porting `validate_graph.mjs` that it checks structure/consistency, not richness —
  "validator-clean" must be achievable by any honest user.
