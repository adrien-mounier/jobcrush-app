// #190 "contact info is a fact" — the contact-fact store, run against both drivers like
// eligibility.test.ts (pg-mem is an in-process Postgres, so the real SQL is exercised too).
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { InMemoryContactStore, PgContactStore, type ContactStore } from "../src/contact.js";
import { buildServer } from "../src/server.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const drivers: [string, () => ContactStore][] = [
  ["in-memory", () => new InMemoryContactStore()],
  ["postgres (pg-mem)", () => new PgContactStore(pgPool())],
];

for (const [name, make] of drivers) {
  describe(`ContactStore contract — ${name}`, () => {
    let store: ContactStore;
    const sid = "sess-1";
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("unknown reads as null — never invented", async () => {
      expect(await store.get(sid, "phone")).toBeNull();
      expect(await store.getRecord(sid)).toEqual({ phone: null, email: null });
    });

    it("stores a read value with its source text as origin", async () => {
      await store.put(sid, "email", { value: "jane@example.com", origin: "read", sourceText: "jane@example.com" });
      expect(await store.get(sid, "email")).toEqual({
        value: "jane@example.com",
        origin: "read",
        sourceText: "jane@example.com",
      });
    });

    it("a person-said correction overwrites the current value in place, not accumulating", async () => {
      await store.put(sid, "phone", { value: "+33 6 00 00 00 00", origin: "read", sourceText: "+33 6 00 00 00 00" });
      await store.put(sid, "phone", { value: "+33 6 11 11 11 11", origin: "person-said", sourceText: "+33 6 11 11 11 11" });
      expect(await store.get(sid, "phone")).toMatchObject({ value: "+33 6 11 11 11 11", origin: "person-said" });
    });

    // ADR-0008 §3: the binding guarantee — a later re-mine must never clobber the person's own answer.
    it("a read write never overwrites a person-said value (ADR-0008 §3)", async () => {
      await store.put(sid, "phone", { value: "+33 6 11 11 11 11", origin: "person-said", sourceText: "+33 6 11 11 11 11" });
      await store.put(sid, "phone", { value: "+33 6 00 00 00 00", origin: "read", sourceText: "+33 6 00 00 00 00" });
      expect(await store.get(sid, "phone")).toMatchObject({ value: "+33 6 11 11 11 11", origin: "person-said" });
    });

    it("a read write still lands normally when nothing person-said is stored yet", async () => {
      await store.put(sid, "phone", { value: "+33 6 00 00 00 00", origin: "read", sourceText: "+33 6 00 00 00 00" });
      expect(await store.get(sid, "phone")).toMatchObject({ value: "+33 6 00 00 00 00", origin: "read" });
    });

    it("a correction supersedes rather than deletes — the prior value is provably kept", async () => {
      await store.put(sid, "email", { value: "old@example.com", origin: "read", sourceText: "old@example.com" });
      await store.put(sid, "email", { value: "new@example.com", origin: "person-said", sourceText: "new@example.com" });

      expect(await store.get(sid, "email")).toMatchObject({ value: "new@example.com" });
      const history = await store.history(sid, "email");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ value: "old@example.com", origin: "read" });
      expect(typeof history[0]!.supersededAt).toBe("string");
    });

    it("re-storing the identical value/origin does not grow history", async () => {
      const value = { value: "jane@example.com", origin: "read" as const, sourceText: "jane@example.com" };
      await store.put(sid, "email", value);
      await store.put(sid, "email", { ...value });
      expect(await store.history(sid, "email")).toEqual([]);
    });

    it("history stays empty for a field that was never corrected", async () => {
      await store.put(sid, "phone", { value: "+33 6 00 00 00 00", origin: "read", sourceText: "+33 6 00 00 00 00" });
      expect(await store.history(sid, "phone")).toEqual([]);
    });

    it("phone and email never collide, and sessions are isolated", async () => {
      await store.put(sid, "phone", { value: "+33 6 00 00 00 00", origin: "read", sourceText: "+33 6 00 00 00 00" });
      await store.put(sid, "email", { value: "jane@example.com", origin: "read", sourceText: "jane@example.com" });

      const record = await store.getRecord(sid);
      expect(record.phone).toMatchObject({ value: "+33 6 00 00 00 00" });
      expect(record.email).toMatchObject({ value: "jane@example.com" });
      expect(await store.getRecord("other-session")).toEqual({ phone: null, email: null });
    });
  });
}

describe("PUT /contact — the profile screen's correction door", () => {
  async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  }

  it("requires a session", async () => {
    const server = buildServer();
    const res = await server.app.inject({
      method: "PUT",
      url: "/contact",
      payload: { field: "phone", value: "+33 6 99 99 99 99" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("stores the answer as person-said and echoes the record back", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({
      method: "PUT",
      url: "/contact",
      headers: { cookie },
      payload: { field: "email", value: "jane@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      phone: null,
      email: { value: "jane@example.com", origin: "person-said", sourceText: "jane@example.com" },
    });
  });

  it("rejects an unknown field", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({
      method: "PUT",
      url: "/contact",
      headers: { cookie },
      payload: { field: "address", value: "somewhere" },
    });
    expect(res.statusCode).toBe(400);
  });
});
