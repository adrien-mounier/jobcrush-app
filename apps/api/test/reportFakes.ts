// #315 — the two fakes every test that presses "Approve and email me this CV" needs: the report
// refuses an unjudged card, so a press runs over a judged one (the real makeJudge over an
// in-memory store, graded by a fake that reads the prompt's own requirement ids — qa-main's shape),
// and the report's one call is answered from the prompt's own requirement states, so the
// coverage check always holds and an unchecked requirement gets no sentence.
import { REPORT_STATE_LINE } from "../src/applicationReport.js";
import { makeJudge, type JudgeFn } from "../src/judge.js";
import { InMemoryJudgementStore } from "../src/judgementStore.js";
import type { LlmClient } from "../src/llm.js";

/** The first requirement met, the rest open — a card with both a strength and a gap. */
export function fakeJudge(): JudgeFn {
  const llm: LlmClient = {
    model: "judge-fake",
    async complete(prompt) {
      const half = prompt.split("===CANDIDATE FACTS===")[0]!;
      const ids = [...half.matchAll(/^- id: (.+)$/gm)].map((m) => m[1]!.trim());
      return JSON.stringify({
        verdicts: ids.map((id, i) => ({
          requirementId: id,
          fit: i === 0 ? 0.9 : 0.4,
          supportingFactId: null,
          reason: i === 0 ? "The evidence covers this requirement." : "Only partly supported.",
        })),
      });
    },
  };
  return makeJudge(llm, new InMemoryJudgementStore());
}

/** #442: what a person reads in the email's HTML part — the body's text, tags gone (inline ones
 *  without a gap, so "64<span>%</span>" reads "64%"), entities decoded, whitespace collapsed. */
export const emailText = (html: string) =>
  (html.split("<body")[1] ?? html)
    .replace(/<\/?(span|a)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** The report's one call, answered from the prompt's states; records every prompt it saw.
 *  `shape` lets a test bend the answer (a wrong id, a sentence for an unchecked requirement). */
export function reportingLlm(shape?: (doc: Record<string, unknown>, states: { id: string; state: string }[]) => unknown) {
  const prompts: string[] = [];
  const llm: LlmClient = {
    model: "report-fake",
    async complete(prompt) {
      prompts.push(prompt);
      const states = [...prompt.matchAll(REPORT_STATE_LINE)].map((m) => ({ id: m[1]!.trim(), state: m[2]! }));
      const doc = {
        jobInShort: "A delivery role for a client-facing project manager.",
        salary: null,
        strong: states.filter((r) => r.state === "met").map((r) => ({ requirementId: r.id, say: `I have done ${r.id}.` })),
        gaps: states
          .filter((r) => r.state === "open" || r.state === "denied")
          .map((r, i) => ({ requirementId: r.id, say: i === 0 ? `I have done the nearest thing to ${r.id}.` : null })),
        explain: ["The steering line carries two facts."],
      };
      return JSON.stringify(shape ? shape(doc, states) : doc);
    },
  };
  return { llm, prompts };
}
