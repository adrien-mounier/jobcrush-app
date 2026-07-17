// JC-13 eval harness. Two modes:
//   CI (default):   validates the committed recordings — schema + invariants, the ≤15
//                   individual-card budget, and ≥90% aggregate tier accuracy vs the
//                   human-rated expectations in cases.json. No LLM needed, so prompt edits
//                   can't silently regress (re-record to make a prompt change land).
//   record:         RECORD_MINER=1 runs the real miner (sonnet via the local Claude CLI or
//                   ANTHROPIC_API_KEY) over every case and rewrites test/eval/recordings/.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CandidateClaims, individualCardCount } from "@jobcrush/contracts";
import { extractRawCv } from "../../src/extract.js";
import { mineClaims } from "../../src/miner.js";
import { llmFromEnv } from "../../src/llm.js";
import casesFile from "./cases.json";

interface Expectation {
  match: string;
  touchIn?: string[];
  classIn?: string[];
  needsGrill?: boolean;
}
interface EvalCase {
  name: string;
  file: string;
  kind: "pdf" | "docx" | "txt";
  expectations: Expectation[];
}

const testDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cases = (casesFile as { cases: EvalCase[] }).cases;
const recordingPath = (name: string) => join(testDir, "eval", "recordings", `${name}.json`);

async function caseText(c: EvalCase): Promise<string> {
  const data = await readFile(join(testDir, c.file));
  if (c.kind === "txt") return data.toString("utf8");
  const raw = await extractRawCv(data, c.kind);
  return raw.fullText;
}

describe.runIf(process.env.RECORD_MINER === "1")("JC-13 miner recording (live LLM)", () => {
  for (const c of cases) {
    it(
      `records ${c.name}`,
      async () => {
        const mined = await mineClaims(await caseText(c), llmFromEnv());
        await writeFile(recordingPath(c.name), JSON.stringify(mined, null, 2) + "\n", "utf8");
        expect(mined.claims.length).toBeGreaterThan(0);
      },
      15 * 60 * 1000,
    );
  }
});

describe("JC-13 miner eval (recorded outputs)", () => {
  const recorded = cases.filter((c) => existsSync(recordingPath(c.name)));

  it("has recordings for every case (run RECORD_MINER=1 after prompt changes)", () => {
    expect(recorded.map((c) => c.name)).toEqual(cases.map((c) => c.name));
  });

  const scores: Array<{ total: number; correct: number }> = [];

  for (const c of recorded) {
    describe(c.name, () => {
      const load = async () =>
        CandidateClaims.parse(JSON.parse(await readFile(recordingPath(c.name), "utf8")));

      it("validates against the candidate_claims contract (invariants included)", async () => {
        const doc = await load();
        expect(doc.claims.length).toBeGreaterThanOrEqual(5);
      });

      it("stays within the ≤15 individual-card deck budget (JC-2 finding)", async () => {
        const doc = await load();
        expect(individualCardCount(doc)).toBeLessThanOrEqual(15);
      });

      it("source_quote really quotes the CV", async () => {
        const doc = await load();
        const cv = (await caseText(c)).toLowerCase().replace(/\s+/g, " ");
        const missing = doc.claims.filter(
          (cl) => !cv.includes(cl.source_quote.toLowerCase().replace(/\s+/g, " ").slice(0, 60)),
        );
        // tolerate at most 1 fuzzy-quote miss per case (line-wrap artifacts in PDFs)
        expect(missing.map((m) => m.id).length).toBeLessThanOrEqual(1);
      });

      it("matches the human-rated expectations", async () => {
        const doc = await load();
        let correct = 0;
        for (const exp of c.expectations) {
          const claim = doc.claims.find(
            (cl) => cl.text.includes(exp.match) || cl.source_quote.includes(exp.match),
          );
          const ok =
            !!claim &&
            (!exp.touchIn || exp.touchIn.includes(claim.machine_touch)) &&
            (!exp.classIn || exp.classIn.includes(claim.classification)) &&
            (exp.needsGrill === undefined || claim.needs_grill === exp.needsGrill);
          if (ok) correct += 1;
        }
        scores.push({ total: c.expectations.length, correct });
        // every expectation must at least find a mined claim; tier misses are scored below
        for (const exp of c.expectations) {
          const found = doc.claims.some(
            (cl) => cl.text.includes(exp.match) || cl.source_quote.includes(exp.match),
          );
          expect(found, `no mined claim mentions "${exp.match}"`).toBe(true);
        }
      });
    });
  }

  it("aggregate tier accuracy ≥ 90% (JC-13 merge bar)", () => {
    const total = scores.reduce((n, s) => n + s.total, 0);
    const correct = scores.reduce((n, s) => n + s.correct, 0);
    expect(total).toBeGreaterThan(0);
    expect(correct / total, `tier accuracy ${correct}/${total}`).toBeGreaterThanOrEqual(0.9);
  });
});
