// JC-11 routes: presigned-style upload flow. POST /uploads issues the destination URL,
// PUT /uploads/:id/content is the local-driver ingest (R2 replaces it with a real presigned
// URL), POST /uploads/:id/complete validates magic bytes + size and finalizes the row.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { BlobStorage } from "../storage.js";
import {
  InMemoryUploadStore,
  MAX_UPLOAD_BYTES,
  REJECT_MESSAGES,
  sniffCvKind,
  type UploadRecord,
} from "../uploads.js";

export interface UploadDeps {
  uploads: InMemoryUploadStore;
  blobs: BlobStorage;
  /** JC-12 hook: called after a successful complete to start the extract+mine pipeline. */
  onUploaded?: (upload: UploadRecord, data: Buffer) => Promise<{ jobId: string } | null>;
}

export function uploadRoutes(deps: UploadDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // Uploads arrive as raw bytes whatever the browser labels them; sniffing happens server-side.
    app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    app.removeContentTypeParser(["text/plain"]);
    app.addContentTypeParser("text/plain", { parseAs: "buffer" }, (_req, body, done) =>
      done(null, body),
    );

    app.post(
      "/uploads",
      { schema: { body: z.object({ filename: z.string().trim().min(1).max(255) }) } },
      async (req, reply) => {
        const session = requireSession(req);
        const row = deps.uploads.create(session.id, req.body.filename);
        const target = await deps.blobs.presignPut(row.id);
        reply.status(201);
        return { id: row.id, putUrl: target.url, method: target.method, maxBytes: MAX_UPLOAD_BYTES };
      },
    );

    app.put(
      "/uploads/:id/content",
      {
        schema: { params: z.object({ id: z.string() }) },
        bodyLimit: MAX_UPLOAD_BYTES,
      },
      async (req, reply) => {
        const session = requireSession(req);
        const row = deps.uploads.get(req.params.id);
        if (!row) return reply.status(404).send({ error: { code: "not_found", message: "unknown upload" } });
        if (row.sessionId !== session.id)
          return reply.status(403).send({ error: { code: "forbidden", message: "not your upload" } });
        if (row.status !== "pending")
          return reply.status(409).send({ error: { code: "already_finalized", message: "upload already finalized" } });
        await deps.blobs.put(row.id, req.body as Buffer);
        return { ok: true };
      },
    );

    app.post(
      "/uploads/:id/complete",
      { schema: { params: z.object({ id: z.string() }) } },
      async (req, reply) => {
        const session = requireSession(req);
        const row = deps.uploads.get(req.params.id);
        if (!row) return reply.status(404).send({ error: { code: "not_found", message: "unknown upload" } });
        if (row.sessionId !== session.id)
          return reply.status(403).send({ error: { code: "forbidden", message: "not your upload" } });
        if (row.status !== "pending")
          return reply.status(409).send({ error: { code: "already_finalized", message: "upload already finalized" } });

        const data = await deps.blobs.get(row.id);
        if (!data)
          return reply.status(400).send({ error: { code: "no_content", message: "file was never uploaded" } });

        if (data.length > MAX_UPLOAD_BYTES) {
          row.status = "rejected";
          row.rejectReason = REJECT_MESSAGES.tooBig;
          return reply.status(400).send({ error: { code: "too_big", message: REJECT_MESSAGES.tooBig } });
        }
        const kind = await sniffCvKind(data);
        if (!kind) {
          row.status = "rejected";
          row.rejectReason = REJECT_MESSAGES.wrongType;
          return reply.status(400).send({ error: { code: "wrong_type", message: REJECT_MESSAGES.wrongType } });
        }

        row.status = "uploaded";
        row.kind = kind;
        row.size = data.length;
        const started = (await deps.onUploaded?.(row, data)) ?? null;
        return { id: row.id, status: row.status, kind, size: row.size, jobId: started?.jobId ?? null };
      },
    );
  };
}
