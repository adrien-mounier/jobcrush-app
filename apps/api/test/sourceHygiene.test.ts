import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The repo has no linter; this is the lint for the two mistakes agent edits actually shipped
// (2026-10-04, #336, caught by luck twice): a script rewrote `\b` in a regex into a raw backspace
// byte, and a `\b` inside a template literal handed to `new RegExp` — where the template, not the
// regex, eats the backslash (`\b` → backspace, `\d` → "d"). Both still compile and typecheck.
const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const files = execSync("git ls-files -- apps packages", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js|md|json)$/.test(f));

describe("source hygiene", () => {
  it("no tracked source file contains a raw control character", () => {
    const bad = files.filter((f) => /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(readFileSync(`${root}/${f}`, "utf8")));
    expect(bad).toEqual([]);
  });

  it("a template literal passed to new RegExp double-escapes its backslashes", () => {
    const bad = files.flatMap((f) =>
      readFileSync(`${root}/${f}`, "utf8")
        .split("\n")
        .map((line, i) => (/new RegExp\(`[^`]*(?<!\\)\\[bBdDsSwW]/.test(line) ? `${f}:${i + 1}` : ""))
        .filter(Boolean),
    );
    expect(bad).toEqual([]);
  });
});
