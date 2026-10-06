import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicLlm,
  DEFAULT_MODEL,
  FireworksLlm,
  canonicalModelName,
  llmForStep,
  parseStepTable,
  stepConfig,
} from "../src/llm.js";
import { sse, textStream } from "./anthropicStream.js";

/** A canned streamed chat-completions response (Fireworks): one chunk per text piece, usage on the
 *  last data chunk, then `[DONE]` unless `done: false`. */
function chatStream(pieces: string[], usage?: { prompt_tokens: number; completion_tokens: number }, opts = { done: true }) {
  const chunks = pieces.map((content) => ({ choices: [{ delta: { content } }] }));
  const body = [
    ...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`),
    `data: ${JSON.stringify({ choices: [], usage: usage ?? null })}\n\n`,
    ...(opts.done ? ["data: [DONE]\n\n"] : []),
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function sentBody(fetchMock: { mock: { calls: unknown[][] } }) {
  return JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
}

describe("AnthropicLlm request shape", () => {
  afterEach(() => vi.restoreAllMocks());

  const mockFetch = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(textStream("{}"));

  // Regression guard: sonnet-5 runs adaptive thinking by default and thinking counts against
  // max_tokens, which truncated the miner's JSON on dense CVs. A step configured "off" must still
  // disable thinking and leave generous output headroom.
  it('a step configured "off" disables thinking and keeps a generous output budget', async () => {
    const fetchMock = mockFetch();
    await new AnthropicLlm("test-key").complete("hi");
    const body = sentBody(fetchMock);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThanOrEqual(32000);
    // sampling params stay omitted (sonnet-5 rejects them)
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  // #334: the configured level reaches the request. Fable rejects thinking:{type:"disabled"}, so a
  // hard-coded "disabled" coming back fails this.
  it.each(["low", "high", "max"] as const)(
    "sends a configured reasoning level (%s) as adaptive thinking + effort",
    async (level) => {
      const fetchMock = mockFetch();
      await new AnthropicLlm("test-key", "claude-fable-5-1", { reasoning: level }).complete("hi");
      const body = sentBody(fetchMock);
      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.output_config).toEqual({ effort: level });
    },
  );

  it("honors an explicit maxTokens override over the step's own", async () => {
    const fetchMock = mockFetch();
    await new AnthropicLlm("test-key", DEFAULT_MODEL, { maxTokens: 64000 }).complete("hi", { maxTokens: 8000 });
    expect(sentBody(fetchMock).max_tokens).toBe(8000);
  });

  // #334: a ~10-minute reasoning run is refused unless it streams.
  it("streams, and reassembles the text across deltas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
        { type: "content_block_stop", index: 0 },
        { type: "ping" },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"ok"' } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: ":true}" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
        { type: "message_stop" },
      ]),
    );
    expect(await new AnthropicLlm("test-key").complete("hi")).toBe('{"ok":true}');
    expect(sentBody(fetchMock).stream).toBe(true);
  });

  it("a mid-stream error event fails the call instead of returning partial text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"half' } },
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      ]),
    );
    await expect(new AnthropicLlm("test-key").complete("hi")).rejects.toThrow(/overloaded_error/);
  });

  it("a stream that closes before message_stop fails the call instead of returning partial text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"half' } },
      ]),
    );
    await expect(new AnthropicLlm("test-key").complete("hi")).rejects.toThrow(/before message_stop/);
  });

  // #104: completeWithUsage is the additive cost-tracking seam — real measured token counts off the
  // API's own usage, never estimated.
  it("completeWithUsage surfaces the API's own usage alongside the text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textStream('{"ok":true}', { input_tokens: 1234, output_tokens: 56 }));
    const { text, usage } = await new AnthropicLlm("test-key").completeWithUsage("hi");
    expect(text).toBe('{"ok":true}');
    expect(usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });
});

describe("FireworksLlm limits come from the step (#334)", () => {
  afterEach(() => vi.restoreAllMocks());

  const ok = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(chatStream(["{}"]));

  // #340: a reasoning model on a whole-CV review answers nothing for minutes; non-streamed, Node's
  // fetch gave up on the silent headers at five minutes whatever the step's deadline said.
  it("streams, reassembles the text across chunks, and reads usage from the final chunk", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(chatStream(['{"a":', "1}"], { prompt_tokens: 3210, completion_tokens: 87 }));
    const { text, usage } = await new FireworksLlm("m", "k").completeWithUsage("hi");
    expect(text).toBe('{"a":1}');
    expect(usage).toEqual({ inputTokens: 3210, outputTokens: 87 });
    expect(sentBody(fetchMock).stream).toBe(true);
    expect(sentBody(fetchMock).stream_options).toEqual({ include_usage: true });
  });

  it("a stream that closes before [DONE] fails the call instead of returning partial text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(chatStream(['{"a":', "1}"], undefined, { done: false }));
    await expect(new FireworksLlm("m", "k").complete("hi")).rejects.toThrow(/before \[DONE\]/);
  });

  it("keeps today's 8,000-token cap and 60s deadline when the step sets none", async () => {
    const fetchMock = ok();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await new FireworksLlm("m", "k").complete("hi");
    expect(sentBody(fetchMock).max_tokens).toBe(8000);
    expect(timeout).toHaveBeenCalledWith(60_000);
  });

  it("sends the step's max output and timeout", async () => {
    const fetchMock = ok();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await new FireworksLlm("m", "k", { maxTokens: 50000, timeoutMs: 900_000 }).complete("hi");
    expect(sentBody(fetchMock).max_tokens).toBe(50000);
    expect(timeout).toHaveBeenCalledWith(900_000);
  });
});

describe("per-step AI configuration (#334)", () => {
  afterEach(() => vi.restoreAllMocks());

  const claudeSteps = [
    "advert-reading",
    "judging",
    "claim-mining",
    "job-block-mining",
    "preview-tailor",
    "grill",
    "cv-audit",
    "family-screen",
    "industry-placement",
    "pasted-advert-reading",
  ] as const;

  it("existing steps keep today's settings", () => {
    for (const step of claudeSteps) {
      expect(stepConfig(step, {})).toEqual({
        provider: "anthropic",
        model: DEFAULT_MODEL,
        reasoning: "off",
        maxTokens: 32000,
        timeoutMs: 600_000,
      });
    }
    expect(stepConfig("family-placement", {})).toEqual({
      provider: "fireworks",
      model: "accounts/fireworks/models/minimax-m3",
      maxTokens: 8000,
      timeoutMs: 60_000,
    });
  });

  it("refuses a Claude step with no reasoning level, and a Fireworks step that sets one", () => {
    const claude = { provider: "anthropic", model: "claude-fable-5-1", maxTokens: 1000, timeoutMs: 1000 };
    const fireworks = { provider: "fireworks", model: "m", maxTokens: 1000, timeoutMs: 1000 };
    expect(() => parseStepTable({ s: claude })).toThrow(/reasoning is required/);
    expect(() => parseStepTable({ s: { ...fireworks, reasoning: "high" } })).toThrow(/reasoning is required/);
    expect(() => parseStepTable({ s: { ...claude, reasoning: "max", test: { provider: "fireworks" } } })).toThrow(
      /reasoning is required/,
    );
    expect(parseStepTable({ a: { ...claude, reasoning: "max" }, b: fireworks })).toBeTruthy();
  });

  it("the env overrides that already existed still win", () => {
    expect(stepConfig("judging", { JUDGE_MODEL: "claude-opus-5-5" }).model).toBe("claude-opus-5-5");
    expect(stepConfig("family-placement", { FAMILY_PLACEMENT_MODEL: "x/y" }).model).toBe("x/y");
  });

  it("review runs on Fable 5.1 at max in the product, Opus 5.5 at max in tests", () => {
    expect(stepConfig("review", {})).toMatchObject({ provider: "anthropic", model: "claude-fable-5-1", reasoning: "max" });
    expect(stepConfig("review", { AI_PROFILE: "test" })).toMatchObject({ model: "claude-opus-5-5", reasoning: "max" });
  });

  it("the review step's configured model and level reach the Anthropic request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(textStream("{}"));
    const llm = llmForStep("review", { ANTHROPIC_API_KEY: "k" });
    expect(llm.model).toBe("claude-fable-5-1");
    await llm.complete("hi");
    expect(sentBody(fetchMock)).toMatchObject({
      model: "claude-fable-5-1",
      max_tokens: 128000,
      stream: true,
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
  });

  it("a Fireworks step with no Fireworks key falls back to the default Anthropic driver, as before", () => {
    expect(llmForStep("family-placement", { ANTHROPIC_API_KEY: "k" })).toBeInstanceOf(AnthropicLlm);
    expect(llmForStep("family-placement", { ANTHROPIC_API_KEY: "k" }).model).toBe(DEFAULT_MODEL);
    expect(llmForStep("family-placement", { FIREWORKS_API_KEY: "f" })).toBeInstanceOf(FireworksLlm);
  });
});

// #104 review, "also fix, cheap": the CLI driver's short alias ("sonnet") and AnthropicLlm's full
// API id ("claude-sonnet-5") name the same model — canonicalizing keeps cost records from silently
// splitting across two rows.
describe("canonicalModelName", () => {
  it("maps the CLI driver's alias to AnthropicLlm's own model id", () => {
    expect(canonicalModelName("sonnet")).toBe(DEFAULT_MODEL);
  });

  it("passes an unrecognized name through unchanged", () => {
    expect(canonicalModelName("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(canonicalModelName("some-future-model")).toBe("some-future-model");
  });
});
