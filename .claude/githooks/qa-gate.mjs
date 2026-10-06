#!/usr/bin/env node
// The QA gate on main, as git's own hooks (core.hooksPath → this folder; .claude/hooks/require-qa-gate.mjs
// keeps that wired and refuses the bypasses). Git runs these at the moment of the commit or push, with
// the real staged files and the real refs being pushed — so no command shape can mislead them.
//
// The rule, for both: code may land on main only as it was TESTED. A GO (record-go.mjs, run by the
// qa-tester) fingerprints the tested working tree; a commit on main, or a push to the remote main,
// passes when every code file it changes is identical to that tree's — or when it changes no code
// relative to what it builds on (docs-only), or relative to what is already deployed (a pull of
// shipped code). Shipping part of the tested tree is allowed; shipping a byte it did not test is not.
// Code = anything outside ci.yml's paths-ignore list, so "gated here" and "deploys" stay one fact.
// A git error here refuses (fails closed). Owner override: SKIP_QA_GATE=1 in the environment.
// Self-check: node --test .claude/hooks/require-qa-gate.test.mjs
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const [mode, remote = 'origin'] = process.argv.slice(2)
if (process.env.SKIP_QA_GATE === '1') {
  console.error('QA gate skipped (SKIP_QA_GATE=1) — the owner\'s override.')
  process.exit(0)
}
const stop = (msg) => { console.error(`BLOCKED by the QA gate: ${msg}`); process.exit(1) }
// must: a git answer the decision rests on — an error refuses. may: a lookup that can legitimately fail.
// Paths unquoted (core.quotePath=false) so `docs/café.md` reads as docs; renames read as delete + add.
const run = (a) => execSync(`git -c core.quotePath=false ${a}`, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }).trim()
const must = (a) => { try { return run(a) } catch { stop(`could not read \`git ${a}\` — refusing rather than guessing.`) } }
const may = (a) => { try { return run(a) } catch { return '' } }
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)
const inert = (f) =>
  /^(docs|\.claude|apps\/web\/prototypes|screenshots)\//.test(f) || /^[^/]+\.md$/.test(f) || f === 'LICENSE'
const code = (files) => files.filter((f) => !inert(f))

// The tested tree, from the markers in the checkout where main is checked out (git allows one).
const mainTop = (may('worktree list --porcelain').split(/\r?\n\r?\n/)
  .find((w) => /^branch refs\/heads\/main$/m.test(w)) ?? '').match(/^worktree (.+)$/m)?.[1] ?? may('rev-parse --show-toplevel')
const read = (f) => (existsSync(`${mainTop}/.claude/${f}`) ? readFileSync(`${mainTop}/.claude/${f}`, 'utf8') : '')
const marker = read('.qa-gate-GO').trim()
const verdict = read('.qa-gate-verdict.md')
const recorded = verdict.match(/^tree: ([0-9a-f]{40})$/m)?.[1]
const tested = /^[0-9a-f]{40}$/.test(marker) && /^GO\b/m.test(verdict) && verdict.includes(marker) &&
  recorded && may(`cat-file -t ${recorded}`) === 'tree' ? recorded : ''
const deployed = may(`rev-parse --verify --quiet refs/remotes/${remote}/main`)
// Every code file in `changes` is byte-identical to the tested tree (`differs` = names that differ).
const asTested = (changes, differs) => !!tested && code(changes).every((f) => !differs.has(f))

const refuse = (what, files) => stop(
  `this ${what} carries code that no GO tested.\n` +
  `Code: ${code(files).slice(0, 5).join(', ')}\n` +
  `Work on a branch, or finish the lifecycle first — do not stop and report to the owner:\n` +
  `  1. /code-review\n  2. /qa-gate (on GO the qa-tester runs .claude/githooks/record-go.mjs)\n` +
  `Then commit / fast-forward main and push. On NO-GO, fix the cited findings and re-run the gate.`)

if (mode === 'pre-commit') {
  if (may('rev-parse --abbrev-ref HEAD') !== 'main') process.exit(0)
  const indexVs = (ref) => lines(must(`diff --cached --name-only --no-renames ${ref}`))
  const staged = lines(must('diff --cached --name-only --no-renames'))
  if (!code(staged).length) process.exit(0)
  if (deployed && !code(indexVs(deployed)).length) process.exit(0) // e.g. concluding a pull of shipped code
  if (asTested(staged, new Set(tested ? indexVs(tested) : []))) process.exit(0)
  refuse('commit on main', staged)
}

if (mode === 'pre-push') {
  for (const l of lines(readFileSync(0, 'utf8'))) {
    // `<local ref> <local sha> <remote ref> <remote sha>` — the local ref may contain spaces
    // (`main@{1 minute ago}`), so read the last three fields; anything else refuses.
    const [localSha, remoteRef, remoteSha] = l.split(/\s+/).slice(-3)
    if (!/^[0-9a-f]{40}$/.test(localSha ?? '') || !/^[0-9a-f]{40}$/.test(remoteSha ?? '') || !remoteRef?.startsWith('refs/'))
      stop(`could not read the push line \`${l}\` — refusing rather than guessing.`)
    if (remoteRef !== 'refs/heads/main' || /^0+$/.test(localSha)) continue // another branch, or a delete
    // What is deployed: the remote's tip if we have it, else our last view of it, else nothing.
    const base = !/^0+$/.test(remoteSha) && may(`cat-file -t ${remoteSha}`) === 'commit' ? remoteSha : deployed
    const shipped = base ? lines(must(`diff --name-only --no-renames ${base} ${localSha}`))
      : lines(must(`ls-tree -r --name-only ${localSha}`))
    if (!code(shipped).length) continue
    if (asTested(shipped, new Set(tested ? lines(must(`diff --name-only --no-renames ${tested} ${localSha}`)) : []))) continue
    refuse('push to main', shipped)
  }
}
process.exit(0)
