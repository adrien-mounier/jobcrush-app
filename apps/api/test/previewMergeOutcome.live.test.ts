// #154 — the one live run. Network-gated, never part of the default suite, never a deploy gate.
//
// previewMergeOutcome.test.ts proves the CHECK is right against a scripted model: hand it a
// scope-list bullet and it complains. Only this file can show the real model, reading the amended
// rule 8, actually writes bullets that keep their results — a prompt change no fake can certify.
//
// It is deliberately not in CI. It costs a paid call, it can fail for reasons unrelated to this
// change, and a flaky paid gate between the owner and every deploy is worse than a slow one (#154
// Q11). Re-run it by hand when rule 8 or the outcome rule changes:
//
//   ANTHROPIC_API_KEY=... pnpm --filter @jobcrush/api test previewMergeOutcome.live
import { describe, expect, it } from "vitest";
import { conservationIssues, Draft, draftDisclosure, tailorDraft } from "../src/preview.js";
import { llmFromEnv } from "../src/llm.js";
import { bredClaims, BRED_POSTING } from "./fixtures/bred-dense-role.js";

describe.runIf(!!process.env.ANTHROPIC_API_KEY)(
  "#154 live — the real tailor, on a role with more to say than fits",
  () => {
    it("keeps a result in every line it combines, and declares what it kept", async () => {
      const claims = bredClaims();
      const { draft } = await tailorDraft(claims, BRED_POSTING as never, llmFromEnv(), "", {});

      const role = draft.experience.find((e) => /bred/i.test(e.employer));
      expect(role, "the BRED role must print").toBeDefined();

      // The failure this ticket was filed about: a top-of-CV line built from several facts with
      // every outcome clause compressed out of it.
      for (const b of role!.bullets) {
        if (b.claimIds.length < 2) continue;
        expect(b.outcome.trim(), `combined bullet with no declared result: "${b.text}"`).not.toBe("");
        expect(b.text.toLowerCase(), `declared result missing from the line: "${b.text}"`).toContain(
          b.outcome.trim().toLowerCase(),
        );
        expect(b.claimIds.length, `too many facts in one line: "${b.text}"`).toBeLessThan(4);
      }

      // And the whole draft passes the gate the person's CV has to pass.
      expect(conservationIssues(claims, draft)).toEqual([]);

      // Evidence, printed: what the model chose to print, what it held back, and what it declared.
      // A run that passes vacuously (one thin bullet, nothing held back) is visible here.
      console.log(JSON.stringify({ bullets: role!.bullets, unprinted: role!.unprinted }, null, 2));
      console.log(JSON.stringify(draftDisclosure(claims, draft as Draft), null, 2));
    }, 120_000);
  },
);
