#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash/PowerShell) for the QA gate on main. The gate itself is git's own
// pre-commit / pre-push hooks in .claude/githooks/ (see qa-gate.mjs there): git runs them with the
// real staged files and pushed refs, so no command shape can mislead them. This hook only
//   1. keeps git pointed at them — core.hooksPath, absolute, at the copy in the checkout where main
//      is checked out, so every worktree (even one whose branch predates the files) uses it; and
//   2. refuses the ways round them: --no-verify / commit -n, changing core.hooksPath, git config
//      injected through the environment, SKIP_QA_GATE, and merging a PR on GitHub (`gh pr merge`,
//      `gh api …/merge`), which deploys with no local push to check — merging to main is the owner's.
// It reads the command with quoted text masked, so a commit message or a grep pattern that merely
// mentions these is not refused; a nested shell (`bash -c "…"`) is read whole. Deliberate evasions
// (abbreviated options, quote-split keys) are out of reach of text matching; the agent's own rules
// forbid skipping hooks.
// Owner override: put [skip-gate] in the command (and SKIP_QA_GATE=1 for the git hooks). Yours to
// invoke, not the agent's — which is why this file, not CLAUDE.md, is where it is written down.
// Self-check: node --test .claude/hooks/require-qa-gate.test.mjs
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const input = JSON.parse(readFileSync(0, 'utf8'))
const cmd = input?.tool_input?.command ?? ''
const project = process.env.CLAUDE_PROJECT_DIR || input.cwd
const git = (a) => {
  try { return execSync(`git ${a}`, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

// 1. Wire git's hooks to main's checkout (idempotent; a reset config heals on the next command).
const mainTop = (git('worktree list --porcelain').split(/\r?\n\r?\n/)
  .find((w) => /^branch refs\/heads\/main$/m.test(w)) ?? '').match(/^worktree (.+)$/m)?.[1]
const hooks = mainTop && resolve(mainTop, '.claude/githooks').replaceAll('\\', '/')
if (hooks && existsSync(`${hooks}/qa-gate.mjs`) && git('config --get core.hooksPath') !== hooks)
  git(`config core.hooksPath "${hooks}"`)

// 2. Bypasses, read on the command with quoted text masked (raw too, when a nested shell runs it).
if (/\[skip-gate\]/.test(cmd)) process.exit(0)
const masked = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, ' ')
  .replace(/@'[\s\S]*?'@|@"[\s\S]*?"@|"(?:[^"\\]|\\[\s\S])*"|'[^']*'/g, ' Q ')
  .replace(/(^|\s)(\d|\*|&)?>>?(\s*(&\d|\S+))?/g, ' ') // redirections
const nested = /\b(bash|sh|zsh|pwsh|powershell|cmd)(\.exe)?\b[^\n]*?\s(-c|-Command|\/c)\b|\beval\b|Invoke-Expression|\biex\b/i.test(cmd)
const texts = nested ? [masked, cmd] : [masked]
const segs = (t) => t.split(/&&|\|\||[;|\n]/)
// Writing core.hooksPath in any form: -c / env `…hooksPath=`, `config [set|--add|…] core.hooksPath <v>`,
// unsetting it (`--unset`, `unset`, `--unset-all`), or removing the whole [core] section. Reading is fine.
const writesHooksPath = (s) => /hookspath\s*=/i.test(s) || (/\bconfig\b/.test(s) && (
  (/hookspath/i.test(s) && !/(\s|^)(--get(-all|-regexp)?|get|--list|-l)(\s|$)/.test(s) &&
    (/(\s|^)(--?unset(-all)?|unset|--replace-all|--add|set|--edit|-e)(\s|$)/.test(s) || /hookspath\s+\S/i.test(s))) ||
  /(\s|^)-?-?(remove|rename)-section\s+core\b/.test(s)))
const rules = [
  [(s) => /--no-verify\b/.test(s), '`--no-verify` skips the QA gate hooks'],
  [(s) => /\bcommit\b.*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/.test(s), '`git commit -n` skips the QA gate hooks'],
  [writesHooksPath, 'changing core.hooksPath unhooks the QA gate'],
  [(s) => /GIT_CONFIG_(PARAMETERS|COUNT|KEY_|VALUE_)/.test(s), 'git config set through the environment can unhook the QA gate'],
  [(s) => /SKIP_QA_GATE/.test(s), 'SKIP_QA_GATE is the owner\'s override'],
  [(s) => /\bgh(\.exe)?\s+pr\s+merge\b/i.test(s) || /\bgh(\.exe)?\s+api\b.*\/(pulls\/\d+\/merge|merges)\b/i.test(s),
    'merging a PR on GitHub lands it on main and deploys; merging to main is the owner\'s call'],
]
const hit = rules.find(([test]) => texts.some((t) => segs(t).some(test)))
if (hit) {
  console.error(`BLOCKED: ${hit[1]}. Ask the owner; with their OK, they add [skip-gate].`)
  process.exit(2)
}
process.exit(0)
