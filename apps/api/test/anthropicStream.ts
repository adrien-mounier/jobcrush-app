// A canned streamed Messages response in the API's own SSE event shape (#334: AnthropicLlm streams).

export function sse(events: Array<{ type: string } & Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A complete, well-formed reply carrying `text` and the given token usage. */
export function textStream(text: string, usage = { input_tokens: 0, output_tokens: 0 }): Response {
  return sse([
    { type: "message_start", message: { usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: usage.output_tokens } },
    { type: "message_stop" },
  ]);
}
