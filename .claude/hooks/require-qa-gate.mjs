#!/usr/bin/env node
// Blocks `git commit` of code unless /qa-gate wrote a GO marker for the current HEAD.
// Marker: .claude/.qa-gate-GO containing the HEAD sha at the moment the gate returned GO.
// HEAD moves on every commit, so a marker is good for exactly one commit.
// Owner override: put [skip-gate] in the commit message. Yours to invoke, not the agent's —
// which is why this file, not CLAUDE.md, is where it is written down.
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const cmd = input?.tool_input?.command ?? ''
if (!/\bgit\s+(-\S+\s+)*commit\b/.test(cmd)) process.exit(0)

const git = (a) =>
  execSync(`git ${a}`, { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const files = (git('diff --cached --name-only') || git('diff --name-only HEAD')).split('\n').filter(Boolean)

// Docs-only commits (roadmap, session-log, ADRs) don't need the gate. apps/web/prototypes/* joins
// them (owner, 2026-09-27): nothing in apps/web's build config, either Dockerfile or CI references
// that folder, and there is no apps/web/public — those files cannot reach staging, so the gate has
// no deploy to protect there. Firing on files that cannot ship only trains the next commit to reach
// for [skip-gate], which is how a gate dies. Narrow the aim, don't widen the hole: this exemption is
// a path prefix, so real code parked under apps/web/prototypes/ WOULD commit ungated.
if (files.length && files.every((f) => f.endsWith('.md') || f.startsWith('apps/web/prototypes/')))
  process.exit(0)

if (/\[skip-gate\]/.test(cmd)) {
  console.error('QA gate skipped via [skip-gate] — only valid when the owner asked for it in this session.')
  process.exit(0)
}

const marker = `${input.cwd}/.claude/.qa-gate-GO`
const head = git('rev-parse HEAD')
if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === head) process.exit(0)

console.error(
  `BLOCKED: this commit touches code and no QA gate GO exists for HEAD ${head.slice(0, 7)}.\n` +
  `Finish the lifecycle yourself before committing — do not stop and report to the owner first:\n` +
  `  1. /code-review\n  2. /qa-gate\n` +
  `On GO, record it: write "${head}" into .claude/.qa-gate-GO, then commit.\n` +
  `On NO-GO, fix the cited findings and re-run the gate.`
)
process.exit(2)
