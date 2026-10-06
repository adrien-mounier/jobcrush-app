# Coding standards

The Standards axis of `/code-review` reads this file and cites its rules by name. Rules are phrased so
a reviewer can cite one against a specific hunk. This is repo-tunable — trim, rename, and extend as the
stack evolves.

The repo-wide discipline in `CLAUDE.md` (simplest thing that works, surgical diffs, server-side
confirmation gates, `.mjs` oracles are the contract spec, conservation of CV facts) is authoritative
and cited alongside these.

---

## Security & tenant isolation

- **Every data access is scoped to the authenticated principal.** A query that can return another
  user's rows is a defect. Scope by owner id in the query itself, not by filtering after the fetch.
- **Authorization is checked on every mutation**, at the boundary that performs it — not assumed from
  a prior read or from the UI having hidden a button.
- **Confirmation gates are server-side** (spec §8-3). No export/submit route may exist for unverified
  content; the check lives on the route, never only in the client.
- **Validate input at trust boundaries.** Request bodies, query params, headers, file uploads:
  validate shape and range before use. Prefer the zod contracts; never interpolate untrusted input
  into SQL, shell, or file paths.
- **Secrets never reach logs, error messages, or client responses.** No tokens, keys, or full PII in
  log lines.
- **Fail closed.** On an authz/validation error, deny — don't fall through to the permissive branch.
- **Guard where every caller converges**, not on the path you were editing: grep every caller of the
  underlying loader, and read what the refusal branch returns — a fallback as good as the success
  branch (the default pool) is no guard.
- **Every route declares a response schema for every status it sends** — it keeps the typed
  handler honest, and it is what strips internal fields from a spread store record (`...c` once
  leaked a table-global `seq`).
- **Spend is bounded per visitor/session, not per request.** Polls and retries void a per-request
  cap (or make that cap idempotent); a paid call on an anonymous route needs a per-session/IP
  bound and a counting test; size a batch cap for the pool it will have; an in-memory budget window
  must be shorter than the process lifetime (every green push restarts the API) or be durable.

## React correctness

- **All four async states are handled**: loading, error, empty, and success — each renders something
  intentional (this is a house rule for the preview/progress flows).
- **Effect dependency arrays are exhaustive and honest.** Every value read inside an effect/callback is
  in its deps, or deliberately excluded with a stated reason.
- **No state mutation.** Update state immutably; never mutate props or state objects in place.
- **List items have stable, unique keys** — not array indices when the list can reorder or items can
  be inserted/removed.
- **Effects clean up** subscriptions, timers, listeners, and SSE/EventSource connections in teardown.
- **No derived state stored in state** — compute during render (or `useMemo`) instead of duplicating a
  source value into another `useState`.
- **Inputs are controlled** (value + onChange) or uncontrolled deliberately, not accidentally switching.
- **Event-ordering guards live in refs, not state** — a drag-vs-click flag in state is already
  stale when the synthetic click fires.
- **Every page that calls the API ensures its own session** (`ensureSession()`) — it must work
  reached cold (deep link, refresh), not only via the nav that precedes it.

## Accessibility (a11y)

- **Semantic HTML first.** A real `<button>`/`<a>`/`<label>` before a `<div>` with a click handler.
  Interactive elements are focusable and keyboard-operable.
- **Every interactive control has an accessible name** — visible label, `aria-label`, or
  `aria-labelledby`. Icon-only buttons must carry a name.
- **Form inputs are associated with labels** (`<label for>` or wrapping). Errors are announced, not
  conveyed by color alone.
- **Focus is managed** across route changes, modals, and dialogs (focus moves in, is trapped where
  appropriate, and returns on close). Focus a conditionally-rendered target from an effect keyed to
  the committed state — never synchronously or in `requestAnimationFrame`/a timer — and prove it in
  a real browser; a code trace can't.
- **Meaning is not carried by color alone**; text/icons back it up, and contrast meets WCAG AA.
- **Images and media have text alternatives** (`alt`, captions) unless decorative (`alt=""`).

## General (any stack)

- **Built for one user, designed for many** (owner decision 2026-09-26, see `CLAUDE.md`). No
  schema, contract, or code path hardcodes the owner's case: job families stay plural and growable,
  markets stay a parameter, vocabularies stay lists that grow. Narrowing to the owner's profession
  is allowed only in the quality bar and test data — a hunk that special-cases a single
  family/market/role in a data model or code path gets cited against this rule.
- **Match the surrounding code** — naming, structure, error handling, and test idioms of the module
  you're editing.
- **Minimal surgical diffs.** No unrequested refactors, abstractions for one caller, or speculative
  config riding along in a feature change.
- **The `.mjs` oracles are the contract spec.** If a zod port and `packages/contracts/oracle/*`
  disagree, the port is wrong. Change contracts only by versioning, in both places. A new shape in
  `packages/contracts/src` joins `golden.test.ts`'s mutation list in the same change; when touching
  an oracle, run it standalone with `node` once (vitest hides a missing named export).
- **A version bump is a stored-data decision.** Tolerant readers turn an old-shape row into
  "absent": fine for values the system regenerates, silent loss for anything a person authored —
  that needs an upgrade-on-read. Publishing a new version of versioned data *adds* it beside the old.
- **Change a CV rule → update `docs/cv-brain/` too.** It's the reference, not a copy to let rot.
- **Errors that can lose data or corrupt state are handled**, not swallowed. Pipeline stages
  checkpoint LLM outputs so retries never re-spend — so never persist a fallback or degraded value
  into a field that marks a step done; leave it absent so the retry runs.
- **Found nothing, did not run, and refused are different states** (ADR-0010) with different
  representations — a failure, skip or degraded answer must never look like an empty result, and
  "still working" is a server-owned state, not an empty list. On an LLM boundary, never `.default()`
  a field the producer must state.
- **A rule over "every record" first checks there are records** — it is vacuously true on zero.
- **Derive a cache/version key from exactly what it versions** — for a stored LLM answer, the
  rendered prompt including substituted data — never a hand-bumped constant.
- **Every SSE route sends `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`** — a
  compressing proxy otherwise buffers the whole stream (and `curl` without gzip won't show it).

## Tests

- **Prove a new test or gate can fail**: revert the fix (or break the guarded code), watch it go
  red for the right reason, restore. Green proves the assertions ran, not that they matter.
- **Test the value that must get *through* a guard**, not only the one it stops; before asserting
  something is excluded, show it would otherwise have been included. A new blocking check ships
  with a table of real-world inputs it must let through, over fixtures that carry the shape it keys
  on; a reviewer's false-block finding is fixed in the same slice (#337 cost three QA rounds).
- **Pair every negative assertion with a positive one** — renaming the hunted string makes "X never
  appears" pass silently.
- **Pin exact values and deltas.** `expect.any(Number)` and `toBeGreaterThanOrEqual` pass for the
  wrong reason; assert "did not move" against a snapshot you took, not against a zero state.
- **Fakes derive every asserted-on value from their input and expose the seam's failure modes**; a
  fixture standing in for a contract payload goes through that contract's `.parse`. When an answer
  shape changes, grep every fake that produces it — `qa-main.ts` first, since no unit test runs it.
- **Tests read product-owned ids and vocabulary** off the live surface or derive them from the
  product — never re-typed literals that decay when the product moves.
- **Select controls by role or structural selector, never by copy**; when a change adds or reorders
  a rendered element, grep the journeys for that screen's selectors and positional reads (`first()`, `nth()`).
- **Time and timers:** seed time-dependent tests relative to `now()` or a faked clock, never a
  literal date; a shared helper waits on `setImmediate`, never on a timer a test may fake.
- **Isolated stacks construct local implementations directly** (`new LocalDiskStorage`, `new
  DevMailer`) — a `*FromEnv()` helper finds production infrastructure in an ops shell.
- **`apps/api/data/*.json` is product data served at runtime** — a test injects the world it needs
  (e.g. `judgeMaxCards`); it never edits product data.
- **A gate never reports success for work it didn't do** — "did nothing" or "skipped" and "passed"
  never share an exit code or summary line.
