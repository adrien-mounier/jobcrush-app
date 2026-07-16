// Typed API client shared by web (S1) and mobile (S4). Grows with the API's routes.
export interface Health {
  ok: boolean;
  sha: string;
  env: string;
}

export class JobCrushClient {
  constructor(private baseUrl: string) {}

  async health(): Promise<Health> {
    const res = await fetch(`${this.baseUrl}/healthz`);
    if (!res.ok) throw new Error(`healthz ${res.status}`);
    return (await res.json()) as Health;
  }

  /** SSE progress for a job; yields parsed job records until the stream closes. */
  async *jobEvents(jobId: string): AsyncGenerator<unknown> {
    const res = await fetch(`${this.baseUrl}/jobs/${jobId}/events`);
    if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.startsWith("data: ")) yield JSON.parse(frame.slice(6));
      }
    }
  }
}
