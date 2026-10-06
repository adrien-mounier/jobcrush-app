#!/usr/bin/env node
// Guards main: a code commit ON main, or a push of main, needs a /qa-gate GO for that HEAD.
// Feature, ticket and integration branches (e.g. /implement-spec's worktrees) commit freely;
// the gate runs on the integration branch tip, which then fast-forwards into main.
// Marker: .claude/.qa-gate-GO containing the HEAD sha at the moment the gate returned GO.
// Owner override: put [skip-gate] in the command. Yours to invoke, not the agent's —
// which is why this file, not CLAUDE.md, is where it is written down.
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const cmd = input?.tool_input?.command ?? ''
const isCommit = /\bgit\s+(-\S+\s+)*commit\b/.test(cmd)
const isPush = /\bgit\s+(-\S+\s+)*push\b/.test(cmd)
if (!isCommit && !isPush) process.exit(0)

const git = (a) => {
  try {
    return execSync(`git ${a}`, { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return '' }
}
const branch = git('rev-parse --abbrev-ref HEAD')
if (isCommit && branch !== 'main') process.exit(0)
if (isPush && branch !== 'main' && !/\bmain\b/.test(cmd)) process.exit(0)

// What would land on main: staged files for a commit; unpushed commits for a push.
const files = (isCommit
  ? git('diff --cached --name-only') || git('diff --name-only HEAD')
  : git('diff --name-only origin/main...main')
).split('\n').filter(Boolean)
// Docs-only commits (roadmap, session-log, ADRs) don't need the gate. apps/web/prototypes/* joins
// them (owner, 2026-09-27): nothing in apps/web's build config, either Dockerfile or CI references
// that folder, and there is no apps/web/public — those files cannot reach staging. This exemption is
// a path prefix, so real code parked under apps/web/prototypes/ WOULD commit ungated.
if (files.length && files.every((f) => f.endsWith('.md') || f.startsWith('apps/web/prototypes/')))
  process.exit(0)
if (isPush && !files.length) process.exit(0)

if (/\[skip-gate\]/.test(cmd)) {
  console.error('QA gate skipped via [skip-gate] — only valid when the owner asked for it in this session.')
  process.exit(0)
}

const marker = `${input.cwd}/.claude/.qa-gate-GO`
const head = git(isCommit ? 'rev-parse HEAD' : 'rev-parse main')
if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === head) process.exit(0)

console.error(
  `BLOCKED: this ${isCommit ? 'commit on main' : 'push of main'} carries code and no QA gate GO exists for ${head.slice(0, 7)}.\n` +
  `Work on a branch, or finish the lifecycle first — do not stop and report to the owner:\n` +
  `  1. /code-review\n  2. /qa-gate (on the branch tip that will become main)\n` +
  `On GO, record it: write the gated sha into .claude/.qa-gate-GO, fast-forward main to it, then push.\n` +
  `On NO-GO, fix the cited findings and re-run the gate.`
)
process.exit(2)
