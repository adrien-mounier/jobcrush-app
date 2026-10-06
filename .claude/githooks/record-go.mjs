#!/usr/bin/env node
// Records a QA gate verdict for the git hooks in this folder. Run by the qa-tester, from the checkout it
// tested:   node .claude/githooks/record-go.mjs "<one-line rationale>" "<report.html path | gates-only>"
//           node .claude/githooks/record-go.mjs --clear          (on NO-GO)
// It fingerprints the TESTED working tree — HEAD plus every uncommitted, non-ignored change — as a git
// tree object (built through a temporary index, so the real index is untouched), and writes, in the
// checkout where main is checked out:
//   .claude/.qa-gate-GO          the HEAD sha (format shared with finance-hq-app)
//   .claude/.qa-gate-verdict.md  "GO — <rationale>", sha, tree, report
// qa-gate.mjs then passes a commit or push to main only when every code file in it matches that tree.
import { execSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [rationale, report = 'gates-only'] = process.argv.slice(2)
const git = (a, env = {}) => execSync(`git ${a}`, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const mainTop = (git('worktree list --porcelain').split(/\r?\n\r?\n/)
  .find((w) => /^branch refs\/heads\/main$/m.test(w)) ?? '').match(/^worktree (.+)$/m)?.[1] ?? git('rev-parse --show-toplevel')
const files = ['.qa-gate-GO', '.qa-gate-verdict.md'].map((f) => join(mainTop, '.claude', f))

if (rationale === '--clear') {
  files.forEach((f) => rmSync(f, { force: true }))
  console.log('QA gate markers cleared.')
  process.exit(0)
}
if (!rationale) { console.error('usage: record-go.mjs "<rationale>" "<report path>" | --clear'); process.exit(1) }

const head = git('rev-parse HEAD')
const index = join(tmpdir(), `qa-go-${process.pid}.index`)
const env = { GIT_INDEX_FILE: index }
git('read-tree HEAD', env)
git('add -A', env)
const tree = git('write-tree', env)
rmSync(index, { force: true })
writeFileSync(files[0], head)
writeFileSync(files[1], `GO — ${rationale}\nsha: ${head}\ntree: ${tree}\nreport: ${report}\n`)
console.log(`QA GO recorded: sha ${head.slice(0, 7)}, tested tree ${tree.slice(0, 7)}.`)
