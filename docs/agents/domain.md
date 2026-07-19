# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. **This is a single-context repo** — one `CONTEXT.md` + `docs/adr/` at the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the glossary), and
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

The CV-reasoning source of truth already lives in **`docs/cv-brain/`** — read it before any
CV-tailoring work (miner/tailor prompts, the Draft schema, `conservationIssues()`).

If `CONTEXT.md` or `docs/adr/` don't exist yet, **proceed silently**. Don't flag their absence; don't
suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs`) creates
them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-....md
│   │   └── 0002-....md
│   └── cv-brain/          ← existing CV-reasoning source of truth
└── apps/ , packages/
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test
name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 — but worth reopening because…_
