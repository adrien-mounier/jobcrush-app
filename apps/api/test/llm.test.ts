import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicLlm, DEFAULT_MODEL, canonicalModelName } from "../src/llm.js";

describe("AnthropicLlm request shape", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 }),
    );
  }

  // Regression guard: sonnet-5 runs adaptive thinking by default and thinking counts against
  // max_tokens, which truncated the miner's JSON on dense CVs. The request must disable thinking
  // and leave generous output headroom, or long real résumés fail with "no JSON object".
  it("disables thinking and keeps a generous output budget", async () => {
    const fetchMock = mockFetch();
    await new AnthropicLlm("test-key").complete("hi");
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(32000);
    // sampling params stay omitted (sonnet-5 rejects them)
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it("honors an explicit maxTokens override", async () => {
    const fetchMock = mockFetch();
    await new AnthropicLlm("test-key").complete("hi", { maxTokens: 8000 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(8000);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  // #104: completeWithUsage is the additive cost-tracking seam — real measured token counts off the
  // API response's own usage block, never estimated.
  it("completeWithUsage surfaces the API's own usage block alongside the text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"ok":true}' }],
          usage: { input_tokens: 1234, output_tokens: 56 },
        }),
        { status: 200 },
      ),
    );
    const { text, usage } = await new AnthropicLlm("test-key").completeWithUsage("hi");
    expect(text).toBe('{"ok":true}');
    expect(usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });

  it("complete()'s own return shape is unchanged by the completeWithUsage addition", async () => {
    mockFetch();
    const text = await new AnthropicLlm("test-key").complete("hi");
    expect(text).toBe("{}");
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
