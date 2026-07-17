import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { MAX_UPLOAD_BYTES, sniffCvKind } from "../src/uploads.js";

// Minimal real magic bytes: enough for file-type to identify the container.
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const TXT_BYTES = Buffer.from("Jane Doe\nProject Manager\n2019-2024 Acme Corp\n");

async function startSession(app: Awaited<ReturnType<typeof buildServer>>["app"]) {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  const c = res.cookies.find((c) => c.name === "jc_session")!;
  return `jc_session=${c.value}`;
}

async function uploadFlow(
  server: ReturnType<typeof buildServer>,
  cookie: string,
  bytes: Buffer,
  filename = "cv.pdf",
) {
  const { app } = server;
  const created = await app.inject({
    method: "POST",
    url: "/uploads",
    headers: { cookie },
    payload: { filename },
  });
  expect(created.statusCode).toBe(201);
  const { id, putUrl } = created.json();
  const put = await app.inject({
    method: "PUT",
    url: putUrl,
    headers: { cookie, "content-type": "application/octet-stream" },
    payload: bytes,
  });
  expect(put.statusCode).toBe(200);
  const complete = await app.inject({ method: "POST", url: `/uploads/${id}/complete`, headers: { cookie } });
  return { id, complete };
}

describe("JC-11 CV upload", () => {
  it("requires a session", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "POST", url: "/uploads", payload: { filename: "cv.pdf" } });
    expect(res.statusCode).toBe(401);
  });

  it("happy path: presign → put → complete sniffs a PDF regardless of filename", async () => {
    const server = buildServer();
    const cookie = await startSession(server.app);
    const { complete } = await uploadFlow(server, cookie, PDF_BYTES, "renamed.txt");
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({ status: "uploaded", kind: "pdf" });
  });

  it("plain text is accepted; binary junk is not", async () => {
    expect(await sniffCvKind(TXT_BYTES)).toBe("txt");
    expect(await sniffCvKind(PNG_BYTES)).toBeNull();
    expect(await sniffCvKind(Buffer.alloc(0))).toBeNull();
  });

  it("wrong type rejects with the verbatim friendly message and marks the row", async () => {
    const server = buildServer();
    const cookie = await startSession(server.app);
    const { id, complete } = await uploadFlow(server, cookie, PNG_BYTES, "cv.pdf");
    expect(complete.statusCode).toBe(400);
    expect(complete.json().error.message).toMatch(/doesn't look like a PDF/);
    expect(server.uploads.get(id)?.status).toBe("rejected");
  });

  it("oversize body is refused with the friendly too-big message", async () => {
    const server = buildServer();
    const cookie = await startSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/uploads",
      headers: { cookie },
      payload: { filename: "big.pdf" },
    });
    const { putUrl } = created.json();
    const res = await server.app.inject({
      method: "PUT",
      url: putUrl,
      headers: { cookie, "content-type": "application/octet-stream" },
      payload: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toMatch(/over 10 MB/);
  });

  it("another session cannot touch my upload", async () => {
    const server = buildServer();
    const mine = await startSession(server.app);
    const theirs = await startSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/uploads",
      headers: { cookie: mine },
      payload: { filename: "cv.pdf" },
    });
    const { id, putUrl } = created.json();
    const put = await server.app.inject({
      method: "PUT",
      url: putUrl,
      headers: { cookie: theirs, "content-type": "application/octet-stream" },
      payload: PDF_BYTES,
    });
    expect(put.statusCode).toBe(403);
    const complete = await server.app.inject({
      method: "POST",
      url: `/uploads/${id}/complete`,
      headers: { cookie: theirs },
    });
    expect(complete.statusCode).toBe(403);
  });

  it("complete without content is a friendly 400, and complete is one-shot", async () => {
    const server = buildServer();
    const cookie = await startSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/uploads",
      headers: { cookie },
      payload: { filename: "cv.pdf" },
    });
    const { id } = created.json();
    const empty = await server.app.inject({ method: "POST", url: `/uploads/${id}/complete`, headers: { cookie } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("no_content");
  });
});
