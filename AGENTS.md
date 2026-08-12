# jobcrush-app — agent instructions

**Read `CLAUDE.md` — it is the single source of truth for this repo.**

## Notes for non-Claude-Code agents

The `/qa-gate` skill, the mattpocock-skills lifecycle slash commands, and the `qa-tester` subagent
named in `CLAUDE.md` run only in a Claude Code session — if the task genuinely requires them, hand
off to a Claude Code session or ask the user. Everything else in `CLAUDE.md` (oracle-is-spec, the
onboarding ratchet, the CV brain, git workflow) applies to you directly.
