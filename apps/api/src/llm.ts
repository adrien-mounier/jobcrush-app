// LLM driver seam. Production (staging with a key) uses the Anthropic API; local dev reuses the
// developer's Claude Code CLI exactly the way the JobCrush spine does (`claude -p` with the
// prompt on stdin); tests inject a fake. Model choice per the dev plan: sonnet, temperature low.
import { spawn } from "node:child_process";

export interface LlmClient {
  complete(prompt: string, opts?: { maxTokens?: number }): Promise<string>;
}

export const DEFAULT_MODEL = "claude-sonnet-5";

export class AnthropicLlm implements LlmClient {
  constructor(
    private apiKey: string,
    private model: string = DEFAULT_MODEL,
  ) {}

  async complete(prompt: string, opts: { maxTokens?: number } = {}): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      // claude-sonnet-5 rejects sampling params (temperature/top_p/top_k) — omit them;
      // determinism is steered via the prompt.
      //
      // sonnet-5 also runs adaptive thinking by DEFAULT, and thinking tokens count against
      // max_tokens. On a dense CV the miner spent 12–24k tokens thinking and truncated its JSON
      // ("no JSON object" / parse-error) — invisible on the small fixtures, fatal on a real long
      // résumé. This pipeline is structured extraction/generation steered by the prompt, so
      // disable thinking and give the output generous headroom.
      // (thinking:{type:"disabled"} is accepted on sonnet-5 / opus-4.x but 400s on fable-5 —
      // omit the field there if DEFAULT_MODEL ever changes to a fable-tier model.)
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 32000,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic api ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return body.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
}

/** Local-dev driver: shells to the Claude Code CLI (same pattern as spine/dailyDriver.mjs). */
export class ClaudeCliLlm implements LlmClient {
  constructor(
    private model: string = "sonnet",
    private command: string = process.env.JOBCRUSH_CLAUDE ??
      (process.platform === "win32" ? "claude.cmd" : "claude"),
    private timeoutMs: number = 10 * 60 * 1000,
  ) {}

  complete(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Node ≥18.20 refuses .cmd/.bat with shell:false (CVE-2024-27980). Args are static and
      // the prompt goes via stdin, so shell:true for the Windows shim is injection-safe.
      const child = spawn(this.command, ["-p", "--output-format", "text", "--model", this.model], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: this.command.toLowerCase().endsWith(".cmd"),
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude cli timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude cli exit ${code}: ${stderr.slice(0, 300)}`));
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

/** Pick the driver from the environment: API key wins; CLI is the local fallback. */
export function llmFromEnv(): LlmClient {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicLlm(key) : new ClaudeCliLlm();
}
