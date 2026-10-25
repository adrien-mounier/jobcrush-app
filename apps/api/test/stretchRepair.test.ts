// #427: the stretch step's first answer was refused and retried in 6 of 10 probe runs on the owner's
// staging draft. These replay the refused answers' shapes (the CV text replaced: the repo is
// public) through the shipped step with a fake model, counting the calls a run makes.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../src/llm.js";
import type { TailorRequirement } from "../src/deck.js";
import { Draft } from "../src/preview.js";
import { failureReason, suggestStretches } from "../src/stretchSuggestions.js";

const draft = Draft.parse({
  name: "A Person",
  headline: "Project manager",
  contact: "",
  summary: "Project manager who delivers.",
  experience: [
    { role: "Project manager", employer: "Acme", location: "", dates: "", unprinted: [], bullets: [{ text: "Ran the roadmap.", claimIds: ["c1"] }] },
  ],
  skills: [{ label: "Tools", items: ["Jira"] }],
});
const requirements: TailorRequirement[] = [
  { id: "req-budget", text: "Budget ownership", state: "gap" },
  { id: "req-tender", text: "Tenders", state: "untested" },
  { id: "req-safe", text: "SAFe", state: "gap" },
];

const suggestion = (requirementId: string, extra: Record<string, unknown> = {}) => ({
  requirementId,
  slot: { kind: "bullet", role: 0, bullet: 0 },
  lineIn: "Owned the project budget.",
  why: "The job asks for budgets. The CV shows a roadmap.",
  say: "I tracked the spend against plan.",
  intendedClass: "Partially-Supported",
  comparison: "The budget line is worth more here than the roadmap line.",
  better: true,
  ...extra,
});

/** A fake model that answers each call from the list, in order, and counts the calls. */
function replay(...answers: unknown[]): LlmClient & { calls: number } {
  const llm = {
    model: "claude-sonnet-5",
    calls: 0,
    complete: async () => JSON.stringify(answers[llm.calls++] ?? answers.at(-1)),
  };
  return llm;
}
const run = (llm: LlmClient) => suggestStretches(llm, "input", draft, requirements, [], "posting:x");

afterEach(() => vi.restoreAllMocks());

describe("#427 the refused answers the probe captured are repaired, not retried", () => {
  it("an empty extra key (why_note: \"\") costs no retry, and the suggestion is kept", async () => {
    const llm = replay({ suggestions: [suggestion("req-budget", { why_note: "" })] });
    const kept = await run(llm);
    expect(llm.calls).toBe(1);
    expect(kept.map((s) => s.requirementId)).toEqual(["req-budget"]);
  });

  it("a suggestion the model marks not-better, written with a null slot and line in, costs no retry", async () => {
    const notMade = suggestion("req-tender", { slot: null, lineIn: null, better: false });
    const llm = replay({ suggestions: [suggestion("req-budget"), notMade, { ...notMade, requirementId: "req-safe" }] });
    expect((await run(llm)).map((s) => s.requirementId)).toEqual(["req-budget"]);
    expect(llm.calls).toBe(1);
  });

  it("a slip that could let a wrong suggestion through still fails: an extra key with text, a null slot on a better line", async () => {
    for (const bad of [suggestion("req-budget", { note: "a real note" }), suggestion("req-budget", { slot: null })]) {
      const llm = replay({ suggestions: [bad] }, { suggestions: [] });
      await run(llm);
      expect(llm.calls).toBe(2);
    }
  });
});

describe("#427 a retry that succeeds says why the first answer was refused", () => {
  it("the [ops] line names the path, code and extra key, never the answer's text", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(replay({ suggestions: [suggestion("req-budget", { note: "Secret CV words" })] }, { suggestions: [] }));
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("first answer refused"));
    expect(line).toBe("[ops] stretch suggestions retried; first answer refused: suggestions.0 unrecognized_keys (note)");
  });

  it("an answer that is not JSON is named, never quoted", () => {
    let err: unknown;
    try { JSON.parse("{Secret CV words}"); } catch (e) { err = e; }
    expect(failureReason(err)).toBe("not valid JSON");
  });

  it("an answer with no JSON object says so", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(replay("Secret CV words, no object", { suggestions: [] }));
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(
      "[ops] stretch suggestions retried; first answer refused: no JSON object in miner output",
    );
  });
});
