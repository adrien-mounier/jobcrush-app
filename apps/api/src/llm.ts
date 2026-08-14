// LLM driver seam. Production (staging with a key) uses the Anthropic API; local dev reuses the
// developer's Claude Code CLI exactly the way the JobCrush spine does (`claude -p` with the
// prompt on stdin); tests inject a fake. Model choice per the dev plan: sonnet, temperature low.
import { spawn } from "node:child_process";

export interface LlmClient {
  complete(prompt: string, opts?: { maxTokens?: number }): Promise<string>;
  /** Model identity, when the driver has one — used for per-call cost attribution (#104's
   *  per-advert cost tracking). Optional so a test fake need not declare it. */
  model?: string;
  /** Additive companion to complete(): same call, but also surfaces token usage when the driver can
   *  report it. Optional — only AnthropicLlm implements it (the Anthropic API's response carries a
   *  `usage` block; the CLI driver has no such data). complete()'s signature and every existing
   *  caller are untouched; a caller that wants cost (adReader.ts) uses this when present and falls
   *  back to complete() otherwise, storing null token counts rather than estimating them. */
  completeWithUsage?(
    prompt: string,
    opts?: { maxTokens?: number },
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
}

export const DEFAULT_MODEL = "claude-sonnet-5";

// The CLI driver reports its short alias ("sonnet") as .model while AnthropicLlm reports the full
// API id ("claude-sonnet-5") — same model, two strings, which would silently split one model's cost
// records across two rows on /ops/counters (#104 review, "also fix, cheap"). Canonicalize the one
// alias actually in use today (ClaudeCliLlm's own default); an unrecognized name passes through
// unchanged rather than guessing at aliases nothing in this repo exercises yet.
const MODEL_ALIASES: Record<string, string> = { sonnet: DEFAULT_MODEL };

export function canonicalModelName(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

export class AnthropicLlm implements LlmClient {
  constructor(
    private apiKey: string,
    public readonly model: string = DEFAULT_MODEL,
  ) {}

  async complete(prompt: string, opts: { maxTokens?: number } = {}): Promise<string> {
    return (await this.request(prompt, opts)).text;
  }

  async completeWithUsage(
    prompt: string,
    opts: { maxTokens?: number } = {},
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    return this.request(prompt, opts);
  }

  private async request(
    prompt: string,
    opts: { maxTokens?: number },
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
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
    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = body.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text,
      usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
    };
  }
}

/** Local-dev driver: shells to the Claude Code CLI (same pattern as spine/dailyDriver.mjs). */
export class ClaudeCliLlm implements LlmClient {
  constructor(
    public readonly model: string = "sonnet",
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

/**
 * Fireworks driver (#220). Second provider in the app, added because the labeler bake-off measured
 * one: eight models over the same 60-case grid landed within five points of each other while their
 * prices spread 27×, so paying frontier rates to pick one item off a closed list buys nothing. It
 * speaks the OpenAI chat-completions shape, so this is one POST and a usage block.
 *
 * Deliberately NOT what llmFromEnv returns. The CV brain — mining a CV into facts, writing the
 * tailored draft — has no measurement behind it yet, and those are the stages where a weaker model
 * does the damage this product exists to prevent (inventing experience, dropping a real
 * achievement). A stage moves here only after its own grid says it can.
 */
export class FireworksLlm implements LlmClient {
  constructor(
    public readonly model: string,
    private apiKey: string,
  ) {}

  async complete(prompt: string, opts: { maxTokens?: number } = {}): Promise<string> {
    return (await this.completeWithUsage(prompt, opts)).text;
  }

  async completeWithUsage(
    prompt: string,
    opts: { maxTokens?: number } = {},
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
      method: "POST",
      // A provider that ERRORS is already safe (the caller degrades to unmapped in milliseconds);
      // a provider that HANGS would otherwise hold a visitor's request for undici's ~5-minute
      // default. ClaudeCliLlm has carried its own explicit deadline since it was written — this is
      // the same guard, sized for a call that normally answers in a second or two.
      signal: AbortSignal.timeout(60_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        // Headroom: several of these models reason before the JSON, and a truncated answer would
        // read as a labeler failure when it is really a max_tokens failure.
        max_tokens: opts.maxTokens ?? 8000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`fireworks ${this.model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** The model behind the job labeler (#220 bake-off, owner pick 2026-08-15): joint-best score of the
 *  eight measured, never wrongly answered "unknown", ~40s for 60 calls, and about $0.81 per thousand
 *  visitors against roughly $5 on the frontier tier. Overridable without a code change, the same
 *  rule JUDGE_MODEL follows — but a change here is only honest once the grid has been re-run
 *  against the new model (`pnpm --filter @jobcrush/api eval:labeler`). */
export const FAMILY_PLACEMENT_MODEL =
  process.env.FAMILY_PLACEMENT_MODEL ?? "accounts/fireworks/models/minimax-m3";

/** The labeler's client, or null when no Fireworks key is configured — callers fall back to their
 *  ordinary llmFromEnv() client, so an environment without the key still labels (on a model the
 *  grid did not measure) rather than losing discovery entirely. */
export function familyPlacementLlm(): LlmClient | null {
  const key = process.env.FIREWORKS_API_KEY;
  return key ? new FireworksLlm(FAMILY_PLACEMENT_MODEL, key) : null;
}

/** Pick the driver from the environment: API key wins; CLI is the local fallback. `model`, when
 *  given, overrides each driver's own default (#105 AC: which model does a task is configuration,
 *  never a code change — e.g. main.ts's `llmFromEnv(process.env.JUDGE_MODEL)` for the card judge).
 *  Omitted (every pre-#105 caller) preserves the exact old behavior: each driver class already
 *  defaults its own `model` constructor param, so passing `undefined` through changes nothing. */
export function llmFromEnv(model?: string): LlmClient {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicLlm(key, model) : new ClaudeCliLlm(model);
}
