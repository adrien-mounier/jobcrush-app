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

## Accessibility (a11y)

- **Semantic HTML first.** A real `<button>`/`<a>`/`<label>` before a `<div>` with a click handler.
  Interactive elements are focusable and keyboard-operable.
- **Every interactive control has an accessible name** — visible label, `aria-label`, or
  `aria-labelledby`. Icon-only buttons must carry a name.
- **Form inputs are associated with labels** (`<label for>` or wrapping). Errors are announced, not
  conveyed by color alone.
- **Focus is managed** across route changes, modals, and dialogs (focus moves in, is trapped where
  appropriate, and returns on close).
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
  disagree, the port is wrong. Change contracts only by versioning, in both places.
- **Change a CV rule → update `docs/cv-brain/` too.** It's the reference, not a copy to let rot.
- **Errors that can lose data or corrupt state are handled**, not swallowed. Pipeline stages
  checkpoint LLM outputs so retries never re-spend.
