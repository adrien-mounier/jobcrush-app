# Session log — jobcrush-app

Newest first. One entry per working session. Ticket + commit refs so the plan stays honest.

## 2026-07-18 (session 3) — E3 deck UI + tiering, browser e2e, two latent bugs fixed

Continued E3 on the slice-A loop, then made the whole onboarding flow self-verifiable in a real browser.

**JC-22 deck tiering** (`3681824`): the deck response stamps each claim with a `tier` — verbatim →
batch, machine-touched → individual. Policy lives in the deck route (`claimTier`), not the store.
Deliberately the simple `machine_touch` split, not stakes-weighted ranking — the miner eval already
keeps the touched count under ~15, so there is nothing to rank yet (ponytail note left for the upgrade).

**JC-23 browser deck UI** (`c9efe8d`): `/deck/[jobId]` — individual yes/edit/remove cards (saved on the
spot; edit → user-authored auto-confirmed), batch-by-section tap-to-remove chips (committed at build),
then build → the verified root CV or a loop-back. The preview page's placeholder "Notify me" dead-end
now links into the deck. Typed deck helpers in `lib/api.ts`.

**Self-verification via Playwright** (`2c4f93d`), after the user asked why I don't test it myself: a
real-browser onboarding smoke over the true pipeline. This environment runs it end to end (headless
Chromium + outbound net + `ANTHROPIC_API_KEY`), against local servers or staging.

**Two latent bugs the e2e caught that typecheck + build never would:**
1. `jfetch` set `content-type: application/json` on every request; Fastify rejects an empty body with
   that header (`FST_ERR_CTP_EMPTY_JSON_BODY`), so every no-body POST 400'd — broke staging upload
   (`/complete`), would have broken deck confirm/build. One guard in the shared helper (`8680fea`).
2. `/import` uploaded without `ensureSession()`, so a direct visit / refresh 401'd on `POST /uploads`
   (it only worked when reached via the landing page). Self-ensures now, matching `/paste` (`10991aa`).

**Loop-back made reachable + guarded** (`3e65843`): `ClaimGraph.nodes` has no min-1, so "reject
everything" built a valid empty graph the gate passed as `ready`. The build route now loops back on an
empty confirmed set ("keep at least one fact") instead of certifying an empty CV.

**E2E suite now (all browser-verified):** happy path, loop-back, paste-too-short, unparseable upload.
`lessons.md` updated (self-verify UI; pages self-ensure session).

Gate at each push: `pnpm test` 102 pass / 5 skipped, `pnpm typecheck` 7/7, web build clean, 4/4 e2e green.

**Next:** the grill (JC-24 gap detection + LLM phrasing, JC-26 persistence via `claims.add`) — the last
feature in E3 — then JC-55 Path B stub, then E2 auth (JC-18/19/20). Looming infra: everything is still
in-memory; the S2 "graph v1 in Postgres" goal needs the JC-6 Postgres drivers.

## 2026-07-18 (session 2) — E4 spine finished + E3 deck/build loop closed

**E4 spine completed** (commit `8cd246a`): the three items the previous session queued all shipped —
claims store (JC-21), gate (JC-31), root-CV renderer (JC-27). Per-session confirmed-claims store (same
record + async-interface + `InMemory*` pattern as `sessions.ts`); `runGate` = the `ClaimGraph` zod port
(≡ `validate_graph.mjs`) + trace-to-confirmed (every rendered bullet → a renderable, user-confirmed
node; errors name the node for precise loop-backs); `renderRootCv` renders only over
`nodes.filter(renderable)`, bucketed by the kind tag. 11 tests. Not yet wired to routes.

**E3 slice A — the onboarding loop now closes end to end** (commit `7994b29`). Grilled the plan first,
then built a deliberately thin vertical slice to exercise the 405 lines of untouched spine through a
real HTTP request before building the deck's intelligence:

- `routes/onboarding.ts`: `POST /onboarding/deck` seeds the per-session claim store from the job's
  mined claims (idempotent, session-scoped like `/previews/:jobId`); confirm/reject/edit are plain
  synchronous store writes; `POST /onboarding/build` runs `buildClaimGraph → renderRootCv → runGate`
  inline and returns the root CV + gate result. **No job/SSE — the spine is pure arithmetic** (verified).
- `sessions.ts`: one `stage` field (`deck | ready | loopback`) + `setStage` — the entire "state machine"
  for this slice; the client reads it on load.
- `server.ts`: wires an `InMemoryClaimStore`, registers the routes.
- `onboarding.test.ts`: walks paste → mine → deck → confirm/edit/reject → build → `ready` over
  `app.inject`, asserting the root CV traces clean through the gate + a session-scoping 404.

Four grill decisions: (a) vertical slice over a fully-featured deck; (b) synchronous saves + a `stage`
field over a background job; (c) ride the anonymous session, defer **all** auth to E2; (d) prove with
the API + one integration test, browser UI as the next slice. Risk flagged in the grill — graph node
IDs vs claim IDs — turned out moot: `graph.ts` reuses claim IDs 1:1, so the gate reads confirmed claim
IDs directly.

Gate green before ship: `pnpm test` = 100 pass / 5 skipped, `pnpm typecheck` = 7/7. Pushed to `main`.

**Next:** E3 continues — deck tiering (JC-22/23), then the grill (JC-24/26), then the browser deck UI
on this API; then E2 auth (JC-18/19/20) drops the signup wall in front of the deck.

## 2026-07-18 — S2 kickoff + E4 keystone shipped

**S2 design locked (grill session).** Eight product decisions fixed before writing code, recorded in
[`docs/s2-kickoff.md`](docs/s2-kickoff.md) (commit `6aef176`):

1. S2's user-facing reward is the **downloadable root CV** → the renderer must be polished.
2. Signup wall sits **immediately after the preview**; the only anonymous assets are the upload +
   preview job, so anon→account merge is one ownership update and purge is one rule.
3. Deck tiering = **stakes × uncertainty**; top ≤15 get individual yes/edit/reject cards, rest batch
   by section; an edit becomes a user-authored, auto-confirmed claim.
4. **Grill = gap-filling only**, hard-capped ~5–8 Qs; gaps detected mechanically, LLM only phrases;
   answers are confirmed facts immediately.
5. The **gate judges our pipeline, never the user's career**; thin-but-honest profiles pass; failures
   are auto-retries or precise loop-backs, never dead ends.
6. **Audit polishes / gate certifies** (audit = LLM against the cv-brain rules; gate = mechanical).
7. Root-CV review is **read-only + "fix this" loop-backs**, never a freeform editor.
8. **Path B ("no CV") is a stub in S2**; the real guided interview moved to S4 (roadmap updated).

Also added an unscheduled roadmap item: the advisory **"improve your profile"** feature (never blocks
applying) — the home for profile-strength feedback the gate deliberately withholds.

**E4 spine started — JC-32 shipped** (commit `a77f974`):

- Ran the two pre-build checks and both came back favorable: the claim miner already emits everything
  deck tiering needs (`source_quote`, `machine_touch`, `classification`, `needs_grill`/`grill_hint`,
  `role`/id-prefixes); `validate_graph.mjs` checks **structure only, no richness gate** — so a sparse
  but well-formed graph passes, exactly as decision #5 needs.
- Discovered the E4 **contract layer already existed** (oracle, `ClaimGraph` zod port, schema JSON,
  goldens — all passing). So JC-32's real gap was the **server-side builder**, not the validator port.
- Wrote `apps/api/src/graph.ts` — `buildClaimGraph(confirmedClaims, opts)` maps the deck's confirmed
  claims 1:1 into a Contract-1 `ClaimGraph` the frozen oracle accepts. Conservative by construction
  (every confirmed claim → one renderable source node, nothing dropped/invented); fills the graph-only
  fields the deck doesn't carry (provenance label, per-class risk floor so Partially-Supported keeps
  invariant 8, `confirmed_date`, one kind tag). 4 tests via the zod port (goldens prove zod ≡ oracle).
- Gate green before ship: `pnpm test` = 91 pass / 5 skipped, `pnpm typecheck` = 7/7. Pushed to `main`.

**Next:** E4 continues — claims store (JC-21, same interface + `InMemory*` pattern as `SessionStore`),
then the gate (JC-31 = `validateGraph` + trace-to-confirmed), then the root-CV renderer (JC-27).
