import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicLlm } from "../src/llm.js";

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
});
