// #190 "contact info is a fact" — the profile screen's one correction door for phone/email. Session-
// authenticated (requireSession, not requireUser), same gate as GET /profile: reachable pre-wall.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import { CONTACT_FIELDS, type ContactField, type ContactStore } from "../contact.js";

export interface ContactDeps {
  contact: ContactStore;
}

const Field = z.enum(CONTACT_FIELDS as [ContactField, ...ContactField[]]);
const Value = z.string().trim().max(200);
// One field (the profile's door) or several at once (#381: check mode's Your details saves the
// whole card on Next). An empty value in the batch says nothing and is skipped — the store keeps
// no "cleared" state, so a blank never erases a fact the CV gave.
const Body = z.union([
  z.object({ field: Field, value: Value.min(1) }),
  z.object({ fields: z.record(Field, Value) }),
]);

export function contactRoutes(deps: ContactDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // The person's own answer — always origin "person-said", always supersedes (ADR-0008 §3): it
    // permanently outranks any later re-read of the CV. Updating this is not an export/submit
    // action, so no confirmation-gate applies (spec §8-3 is about unverified content leaving the
    // product, not about correcting a fact the person already owns).
    app.put("/contact", { schema: { body: Body } }, async (req) => {
      const session = requireSession(req);
      const entries = "field" in req.body ? [[req.body.field, req.body.value] as const] : Object.entries(req.body.fields);
      for (const [field, value] of entries) {
        if (!value) continue;
        await deps.contact.put(session.id, field as ContactField, { value, origin: "person-said", sourceText: value });
      }
      return deps.contact.getRecord(session.id);
    });
  };
}
