// LLM driver seam. Production (staging with a key) uses the Anthropic API; local dev reuses the
// developer's Claude Code CLI exactly the way the JobCrush spine does (`claude -p` with the
// prompt on stdin); tests inject a fake.
//
// #334: which provider, model, reasoning level, output cap and deadline each AI step uses is
// configuration — apps/api/data/ai-steps.json, one entry per step — never a code change. main.ts
// builds every step's client with llmForStep(step).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { LlmStage } from "./usageLedgerStore.js";

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

/** Anthropic reasoning: "off" disables thinking; the rest are the API's effort levels. Fable 5.1 and
 *  Opus 5.5 reject "off" — thinking is always on there. */
const REASONING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** The per-step knobs a driver honours. Each one left unset keeps that driver's own historic value. */
export type DriverSettings = Partial<Pick<StepConfig, "reasoning" | "maxTokens" | "timeoutMs">>;

export class AnthropicLlm implements LlmClient {
  constructor(
    private apiKey: string,
    public readonly model: string = DEFAULT_MODEL,
    private settings: DriverSettings = {},
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
    const reasoning = this.settings.reasoning ?? "off";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: this.settings.timeoutMs ? AbortSignal.timeout(this.settings.timeoutMs) : undefined,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      // claude-sonnet-5 rejects sampling params (temperature/top_p/top_k) — omit them;
      // determinism is steered via the prompt.
      //
      // Reasoning "off" (every pre-#334 step): sonnet-5 runs adaptive thinking by DEFAULT, and
      // thinking tokens count against max_tokens. On a dense CV the miner spent 12–24k tokens
      // thinking and truncated its JSON ("no JSON object" / parse-error) — invisible on the small
      // fixtures, fatal on a real long résumé. Those steps are structured extraction steered by the
      // prompt, so they disable thinking and keep generous output headroom. Any other level is
      // adaptive thinking at that effort — the only shape Fable 5.1 / Opus 5.5 accept.
      //
      // Streamed (#334): the API refuses a non-streaming request expected to run long, and a review
      // at max reasoning runs ~10 minutes.
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? this.settings.maxTokens ?? 32000,
        ...(reasoning === "off"
          ? { thinking: { type: "disabled" } }
          : { thinking: { type: "adaptive" }, output_config: { effort: reasoning } }),
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`anthropic api ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return readMessageStream(res.body);
  }
}

/** Reassembles a streamed Messages response: text deltas joined, input tokens from message_start,
 *  output tokens from the final message_delta. An `error` event, or a stream that ends without
 *  message_stop, fails the call — partial text from a stream that broke off must never reach a JSON
 *  parser as if it were the whole answer. */
async function readMessageStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopped = false;
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const event = JSON.parse(line.slice(5)) as {
      type: string;
      delta?: { type?: string; text?: string };
      message?: { usage?: { input_tokens?: number } };
      usage?: { output_tokens?: number };
      error?: { type?: string; message?: string };
    };
    if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens ?? 0;
    else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") text += event.delta.text ?? "";
    else if (event.type === "message_delta") outputTokens = event.usage?.output_tokens ?? outputTokens;
    else if (event.type === "message_stop") stopped = true;
    else if (event.type === "error") throw new Error(`anthropic api stream ${event.error?.type}: ${event.error?.message}`);
  };
  await eachSseLine(body, handle);
  if (!stopped) throw new Error("anthropic api stream ended before message_stop");
  return { text, usage: { inputTokens, outputTokens } };
}

/** Feeds a streamed body to `handle` one line at a time, across chunk boundaries. */
async function eachSseLine(body: ReadableStream<Uint8Array>, handle: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffered);
}

/** Reassembles a streamed chat-completions response (Fireworks). Streaming here is a deadline fix,
 *  not a feature: Node's fetch gives up on a response whose HEADERS take over five minutes (undici's
 *  default), a limit no per-step timeout can raise — and a reasoning model on a whole-CV review sits
 *  silent that long before a non-streamed answer begins (#340's first Fireworks run died exactly so).
 *  Streamed, the headers arrive at once and the step's own deadline is the only clock. Usage rides
 *  the final chunk (`stream_options.include_usage`); a stream that ends without `[DONE]` fails the
 *  call, for the same reason the Anthropic reader fails without message_stop. */
async function readChatStream(
  body: ReadableStream<Uint8Array>,
  model: string,
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  let done = false;
  await eachSseLine(body, (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      return;
    }
    const chunk = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      error?: { message?: string };
    };
    if (chunk.error) throw new Error(`fireworks ${model} stream: ${chunk.error.message}`);
    text += chunk.choices?.[0]?.delta?.content ?? "";
    if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
  });
  if (!done) throw new Error(`fireworks ${model} stream ended before [DONE]`);
  return { text, usage };
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
    private settings: DriverSettings = {},
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
      // the same guard, sized per step (#334): 60s fits a labeling call that normally answers in a
      // second or two, and stays the default when a step sets none.
      signal: AbortSignal.timeout(this.settings.timeoutMs ?? 60_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        // Headroom: several of these models reason before the JSON, and a truncated answer would
        // read as a labeler failure when it is really a max_tokens failure.
        max_tokens: opts.maxTokens ?? this.settings.maxTokens ?? 8000,
        temperature: 0,
        // Streamed (#340): see readChatStream — the deadline above only counts once headers arrive.
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`fireworks ${this.model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return readChatStream(res.body, this.model);
  }
}

/** Every step that goes through this seam. employer-lookup is absent on purpose: it is a multi-turn
 *  server-side web-search call with its own driver (employerLookup.ts), not an LlmClient. */
export type AiStep = Exclude<LlmStage, "employer-lookup">;

const StepConfigFields = z
  .object({
    provider: z.enum(["anthropic", "fireworks"]),
    model: z.string().min(1),
    reasoning: z.enum(REASONING_LEVELS).optional(),
    maxTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type StepConfig = z.infer<typeof StepConfigFields>;

// A Claude step must name its reasoning level: left out, it would silently mean "off", which Fable
// 5.1 / Opus 5.5 reject. A Fireworks step must not: the Fireworks driver sends no reasoning field,
// and a setting nothing reads is a lie in the settings file.
const reasoningMatchesProvider = (c: StepConfig) =>
  c.provider === "anthropic" ? c.reasoning !== undefined : c.reasoning === undefined;

const StepEntrySchema = StepConfigFields.extend({ test: StepConfigFields.partial().strict().optional() })
  .strict()
  .refine(
    ({ test, ...product }) => reasoningMatchesProvider(product) && reasoningMatchesProvider({ ...product, ...test }),
    { message: "reasoning is required on an anthropic step and not allowed on a fireworks step" },
  );

/** Validates the settings file's contents. Exported so a test can feed it a bad table. */
export function parseStepTable(raw: unknown) {
  return z.record(StepEntrySchema).parse(raw);
}

let stepTable: ReturnType<typeof parseStepTable> | null = null;
function loadStepTable() {
  if (!stepTable) {
    const here = dirname(fileURLToPath(import.meta.url));
    stepTable = parseStepTable(JSON.parse(readFileSync(join(here, "..", "data", "ai-steps.json"), "utf8")));
  }
  return stepTable;
}

/** Model overrides that predate the settings file and may still be set on a deployment. The
 *  labeler's model (MiniMax M3, the #220 bake-off's owner pick 2026-08-15) is only honest to change
 *  after re-running its grid against the new one (`pnpm --filter @jobcrush/api eval:labeler`). */
const MODEL_ENV_OVERRIDES: Partial<Record<AiStep, string>> = {
  judging: "JUDGE_MODEL",
  "family-placement": "FAMILY_PLACEMENT_MODEL",
};

type Env = Record<string, string | undefined>;

/** One step's settings. `AI_PROFILE=test` applies the step's `test` override — the review runs on a
 *  cheaper model in test runs while keeping the product's reasoning level. */
export function stepConfig(step: AiStep, env: Env = process.env): StepConfig {
  const entry = loadStepTable()[step];
  if (!entry) throw new Error(`ai-steps.json has no entry for step "${step}"`);
  const { test, ...product } = entry;
  const config = env.AI_PROFILE === "test" ? { ...product, ...test } : product;
  const envVar = MODEL_ENV_OVERRIDES[step];
  const override = envVar ? env[envVar] : undefined;
  return override ? { ...config, model: override } : config;
}

/** The client for one step. A Fireworks step with no Fireworks key falls back to the default
 *  Anthropic driver, so the step still runs — on a model its grid never measured. No Anthropic key
 *  → the local Claude Code CLI, which honours the step's model and deadline but not its reasoning
 *  level or output cap (the CLI has no such flags). */
export function llmForStep(step: AiStep, env: Env = process.env): LlmClient {
  const config = stepConfig(step, env);
  if (config.provider === "fireworks") {
    return env.FIREWORKS_API_KEY
      ? new FireworksLlm(config.model, env.FIREWORKS_API_KEY, config)
      : llmFromEnv(undefined, env);
  }
  return env.ANTHROPIC_API_KEY
    ? new AnthropicLlm(env.ANTHROPIC_API_KEY, config.model, config)
    : new ClaudeCliLlm(config.model, undefined, config.timeoutMs);
}

/** Pick the driver from the environment: API key wins; CLI is the local fallback. `model`, when
 *  given, overrides each driver's own default. Steps use llmForStep; this stays for evals and live
 *  tests that want the plain default client. */
export function llmFromEnv(model?: string, env: Env = process.env): LlmClient {
  const key = env.ANTHROPIC_API_KEY;
  return key ? new AnthropicLlm(key, model) : new ClaudeCliLlm(model);
}

