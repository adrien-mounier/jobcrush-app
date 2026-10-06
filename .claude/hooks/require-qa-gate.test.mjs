// node --test .claude/hooks/require-qa-gate.test.mjs — the QA gate on main, driven with REAL git
// commits and pushes in a throwaway repo wired to .claude/githooks, plus the agent hook's bypass rules.
// Includes every shape four QA rounds (2026-10-06) used to land ungated code when the gate parsed
// command text; git's own hooks see the real result, so each is just a commit or a push here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const hooksDir = resolve(import.meta.dirname, '../githooks').replaceAll('\\', '/')
const agentHook = join(import.meta.dirname, 'require-qa-gate.mjs')
const root = mkdtempSync(join(tmpdir(), 'qa-gate-'))
const repo = join(root, 'repo'), origin = join(root, 'origin.git')
const sh = (c, cwd = repo) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
// Run a real git command. ok: it succeeded. refused: the QA gate itself stopped it — not some other
// failure (a missing upstream once made "refused" cases pass for the wrong reason).
const run = (c, cwd = repo) => spawnSync(c, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, SKIP_QA_GATE: '' } })
const ok = (c, cwd) => run(c, cwd).status === 0
const refused = (c, cwd) => { const r = run(c, cwd); return r.status !== 0 && (r.stderr + r.stdout).includes('BLOCKED by the QA gate') }
const write = (f, s) => writeFileSync(join(repo, f), s)
// The qa-tester's own recorder: fingerprints the working tree as it stands (what "was tested").
const recorder = join(hooksDir, 'record-go.mjs')
const markers = () => sh(`node "${recorder}" "all ACs pass" r.html`)
const clearMarkers = () => sh(`node "${recorder}" --clear`)
const remoteMain = () => sh(`git --git-dir="${origin}" rev-parse main`, root)

mkdirSync(join(repo, 'apps/api/prompts'), { recursive: true })
mkdirSync(join(repo, 'docs'))
mkdirSync(join(repo, '.claude'))
sh('git init -q -b main && git config user.email t@t && git config user.name t')
for (const f of ['roadmap.md', 'docs/a.md', 'apps/api/x.ts', 'apps/api/prompts/p.md']) write(f, 'a')
write('.gitignore', '.claude/.qa-gate-*\n')
sh('git add .gitignore roadmap.md docs apps && git commit -qm init')
sh(`git init -q --bare -b main "${origin}" && git remote add origin "${origin}" && git push -q -u origin main`)
sh(`git config core.hooksPath "${hooksDir}"`) // wired after the seed push, as on a live repo

test('commits on main: docs pass beside another session\'s dirty code; code needs a GO', () => {
  write('apps/api/x.ts', 'another session') // stays dirty, unstaged
  write('roadmap.md', 'b')
  assert.ok(ok('git add roadmap.md && git commit -qm docs'), 'docs-only commit')
  write('apps/api/prompts/p.md', 'prompt edit')
  assert.ok(refused('git add apps/api/prompts/p.md && git commit -qm prompt'), 'prompts are product, not docs')
  sh('git reset -q')
  // Bulk or wildcard staging sweeps the other session's code in: the commit check sees it.
  for (const c of ['git commit -qam x', 'git add -A && git commit -qm x', 'git add "*.md" && git commit -qm docs']) {
    assert.ok(refused(c), c)
    sh('git reset -q')
  }
  markers() // the gate ran on this working tree
  write('apps/api/x.ts', 'edited after the test')
  assert.ok(refused('git add apps/api/x.ts && git commit -qm feat'), 'a byte the GO did not test')
  sh('git reset -q')
  write('apps/api/x.ts', 'another session')
  assert.ok(ok('git add apps/api/x.ts && git commit -qm feat'), 'exactly as tested — part of it is fine')
  assert.ok(ok('git add apps/api/prompts/p.md && git commit -qm prompt && git push -q origin main'), 'the rest, and the push')
  clearMarkers()
})

test('a branch commits freely; its code reaches the remote main only with a GO, however it is pushed', () => {
  sh('git checkout -q -b feat')
  write('apps/api/x.ts', 'feature code')
  assert.ok(ok('git commit -qam feat'), 'feature branches commit freely')
  assert.ok(ok('git push -q origin feat'), 'pushing a branch is not pushing main')
  const before = remoteMain()
  for (const c of [
    'git push origin feat:main', 'git push origin HEAD:main', 'git push origin +HEAD:refs/heads/main 2>&1',
    'git checkout -q main && git merge -q --ff-only feat && git push -q',
    'git checkout -q main && git reset -q --hard feat && git push -q origin main 2>&1',
    'git checkout -q main && git cherry-pick feat && git push -q',
    'git branch -f main feat && git push -q origin main',
    'git update-ref refs/heads/main feat && git push -q origin main',
    'git config remote.origin.push refs/heads/feat:refs/heads/main && git push -q',
  ]) {
    assert.ok(refused(c), c)
    assert.equal(remoteMain(), before, `remote main unchanged after: ${c}`)
    try { sh('git config --unset remote.origin.push') } catch {}
    sh('git checkout -q feat')
    sh(`git branch -f main ${before}`)
  }
  markers() // the gate ran on the branch tip
  assert.ok(ok('git push -q origin "feat@{0 seconds ago}:main"'), 'a GO\'d push read right even with spaces in its ref')
  assert.ok(ok('git checkout -q main && git merge -q --ff-only feat && git push -q origin main'), 'GO on the tip ships')
  clearMarkers()
})

test('a docs-only push passes, and catching up with the remote is never held', () => {
  write('roadmap.md', 'c')
  assert.ok(ok('git add roadmap.md && git commit -qm docs && git push -q'), 'docs-only push')
  // Someone else ships code to the remote main while we hold an unpushed docs commit; pulling it in
  // (a merge) and pushing our docs is not shipping code of ours.
  const other = join(root, 'other')
  sh(`git clone -q "${origin}" "${other}"`, root)
  writeFileSync(join(other, 'apps/api/x.ts'), 'shipped elsewhere')
  sh('git -c user.email=t@t -c user.name=t commit -qam shipped && git push -q origin main', other) // no hooks wired
  write('docs/a.md', 'local docs')
  assert.ok(ok('git add docs/a.md && git commit -qm docs'))
  assert.ok(ok('git pull -q --no-rebase --no-edit origin main'), 'pull (a merge)')
  assert.ok(ok('git push -q origin main'), 'our net change is docs')
  write('docs/café.md', 'x')
  assert.ok(ok('git add docs && git commit -qm accents && git push -q'), 'a non-ASCII docs path is docs')
})

test('round 5 (2026-10-06): refspecs with spaces, renames, merges on a moved main, fail-closed', () => {
  const before = remoteMain()
  write('apps/api/x.ts', 'ungated code')
  sh('git -c core.hooksPath= commit -qam "ungated code"') // as if it slipped onto local main
  for (const c of ['git push origin "main@{0 seconds ago}:main"', 'git push origin "HEAD^{/ungated code}:main"'])
    assert.ok(refused(c), c)
  assert.equal(remoteMain(), before)
  sh(`git reset -q --hard ${before}`)
  assert.ok(refused('git mv apps/api/x.ts docs/x.ts && git commit -qm "move"'), 'a rename out of code is a code change')
  sh(`git reset -q --hard ${before}`)
  // A GO'd branch merged after main moved on by docs ships the tested tree plus docs: passes.
  sh('git checkout -q -b feat2')
  write('apps/api/x.ts', 'feat2 code')
  sh('git commit -qam feat2')
  markers()
  sh('git checkout -q main')
  write('roadmap.md', 'moved')
  sh('git commit -qam "docs meanwhile" && git push -q')
  assert.ok(ok('git merge -q --no-edit feat2 && git push -q origin main'), 'GO\'d branch merged onto a docs-moved main')
  // A merge of an ungated branch straight on top of the GO'd commit is not "the commit made on it".
  markers()
  sh('git checkout -q -b feat3')
  write('apps/api/x.ts', 'feat3 ungated')
  sh('git commit -qam feat3 && git checkout -q main')
  assert.ok(refused('git merge -q --no-ff --no-edit feat3 && git push -q origin main'))
  sh(`git reset -q --hard origin/main`)
  clearMarkers()
  // A push line the gate cannot read is refused, not waved through.
  const r = spawnSync('node', [join(hooksDir, 'qa-gate.mjs'), 'pre-push', 'origin'], { cwd: repo, input: 'garbage\n', encoding: 'utf8' })
  assert.ok(r.status !== 0 && r.stderr.includes('BLOCKED by the QA gate'), 'unreadable input fails closed')
})

const agent = (command, project = repo) =>
  spawnSync('node', [agentHook], { input: JSON.stringify({ cwd: project, tool_input: { command } }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: project } }).status

test('the agent hook refuses the ways round the git hooks', () => {
  for (const c of ['git commit --no-verify -m x', 'git commit -nm x', 'git push --no-verify', 'git config core.hooksPath x',
    'git config --unset core.hooksPath', 'git config unset core.hooksPath', 'git config --global core.hooksPath ""',
    'git config --remove-section core', 'git -c core.hooksPath=/dev/null commit -m x', 'GIT_CONFIG_COUNT=1 git commit -m x',
    'SKIP_QA_GATE=1 git push', 'gh pr merge 12 --squash', 'gh api -X PUT repos/o/r/pulls/12/merge',
    'bash -c "git commit --no-verify -m x"'])
    assert.equal(agent(c), 2, c)
  for (const c of ['git commit -m "docs" -- roadmap.md', 'git push', 'git status', 'gh issue view 1 --comments',
    'git config --get core.hooksPath', 'git config core.hooksPath', 'git config --get core.hooksPath 2>/dev/null',
    'git commit -m "docs: the gate refuses --no-verify and -n" -- roadmap.md', 'grep "gh pr merge" CLAUDE.md',
    'SKIP_QA_GATE=1 git push # [skip-gate]'])
    assert.equal(agent(c), 0, c)
})

test('the agent hook wires every worktree to main\'s copy of the hooks', () => {
  // A worktree whose branch predates the hook files must not rewire git to its own (missing) copy.
  const wt = join(root, 'wt')
  sh(`git worktree add -q "${wt}" -b old ${sh('git rev-list --max-parents=0 HEAD')}`)
  agent('git status', wt)
  assert.equal(sh('git config --get core.hooksPath'), hooksDir, 'left on a copy that exists')
  // With main's checkout carrying the files, an unset config heals to main's copy — from anywhere.
  mkdirSync(join(repo, '.claude/githooks'), { recursive: true })
  for (const f of ['qa-gate.mjs', 'pre-commit', 'pre-push']) copyFileSync(join(hooksDir, f), join(repo, '.claude/githooks', f))
  sh('git config --unset core.hooksPath')
  agent('git status', wt)
  assert.equal(sh('git config --get core.hooksPath'), resolve(repo, '.claude/githooks').replaceAll('\\', '/'))
})
