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
  it("persists a failed import proof on the session for reload", async () => {
    const server = buildServer({
      pipeline: { mine: async () => { throw new Error("miner unavailable"); } },
    });
    const cookie = await startSession(server.app);
    const { complete } = await uploadFlow(server, cookie, TXT_BYTES, "cv.txt");
    const jobId = complete.json().jobId;
    let job = await server.app.inject({
      method: "GET",
      url: `/jobs/${jobId}`,
      headers: { cookie },
    });
    while (job.json().status === "running") {
      job = await server.app.inject({
        method: "GET",
        url: `/jobs/${jobId}`,
        headers: { cookie },
      });
    }
    const session = await server.app.inject({
      method: "GET",
      url: "/sessions/me",
      headers: { cookie },
    });
    expect(session.json().importProof).toEqual({
      outcome: "failed",
      usefulFactCount: 0,
      skippedQuestionCount: 0,
      representativeFacts: [],
      conflict: null,
    });
  });

  it("keeps a stable correction through a real re-import and job GET snapshot", async () => {
    let importNo = 0;
    const server = buildServer({
      pipeline: {
        mine: async () => {
          importNo += 1;
          return {
            claims: [
              {
                id: importNo === 1 ? "acme-pm" : "changed-title-id",
                semantic_key: importNo === 1 ? "role-acme-pm" : "role-acme-project-lead",
                field_key: "role-acme-title",
                field_value: importNo === 1 ? "Project Manager" : "Project Lead",
                field_label: "Role at Acme",
                role: "Acme",
                text: importNo === 1 ? "Project Manager at Acme" : "Project Lead, Acme",
                machine_touch: "verbatim",
                classification: "Verified",
                source_quote: importNo === 1 ? "Project Manager" : "Project Lead",
                needs_grill: false,
                grill_hint: null,
              },
              {
                id: importNo === 1 ? "sql-one" : "sql-new-id",
                semantic_key: "skill-sql",
                field_key: null,
                field_value: null,
                field_label: null,
                role: "profile",
                text: importNo === 1 ? "Used SQL" : "SQL experience",
                machine_touch: "verbatim",
                classification: "Verified",
                source_quote: "SQL",
                needs_grill: false,
                grill_hint: null,
              },
            ],
            needsGrill: 0,
            roles: 1,
            doc: { parser_flags: [] },
          };
        },
      },
    });
    const cookie = await startSession(server.app);
    const first = await uploadFlow(server, cookie, TXT_BYTES, "cv.txt");
    const firstJobId = first.complete.json().jobId;
    let firstJob = await server.app.inject({
      method: "GET",
      url: `/jobs/${firstJobId}`,
      headers: { cookie },
    });
    while (firstJob.json().status === "running") {
      firstJob = await server.app.inject({
        method: "GET",
        url: `/jobs/${firstJobId}`,
        headers: { cookie },
      });
    }
    expect(firstJob.json().progress.importProof.representativeFacts).toContainEqual({
      id: "role-acme-title",
      text: "Project Manager at Acme",
      provenance: "cv",
    });

    const corrected = await server.app.inject({
      method: "PUT",
      url: "/sessions/me/import-resolution",
      headers: { cookie },
      payload: { fieldId: "role-acme-title", value: "Programme Manager" },
    });
    expect(corrected.statusCode).toBe(200);

    const second = await uploadFlow(server, cookie, TXT_BYTES, "updated.txt");
    const secondJobId = second.complete.json().jobId;
    let secondJob = await server.app.inject({
      method: "GET",
      url: `/jobs/${secondJobId}`,
      headers: { cookie },
    });
    while (secondJob.json().status === "running") {
      secondJob = await server.app.inject({
        method: "GET",
        url: `/jobs/${secondJobId}`,
        headers: { cookie },
      });
    }
    expect(secondJob.json().progress.importProof).toMatchObject({
      conflict: null,
      representativeFacts: expect.arrayContaining([
        { id: "role-acme-title", text: "Programme Manager", provenance: "cv" },
        { id: "skill-sql", text: "SQL experience", provenance: "cv" },
      ]),
    });
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: "/sessions/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
  });

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
