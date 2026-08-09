// #190 "contact info is a fact" — the profile screen's one correction door for phone/email. Session-
// authenticated (requireSession, not requireUser), same gate as GET /profile: reachable pre-wall.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { ContactStore } from "../contact.js";

export interface ContactDeps {
  contact: ContactStore;
}

const Body = z.object({
  field: z.enum(["phone", "email"]),
  value: z.string().trim().min(1).max(200),
});

export function contactRoutes(deps: ContactDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // The person's own answer — always origin "person-said", always supersedes (ADR-0008 §3): it
    // permanently outranks any later re-read of the CV. Updating this is not an export/submit
    // action, so no confirmation-gate applies (spec §8-3 is about unverified content leaving the
    // product, not about correcting a fact the person already owns).
    app.put("/contact", { schema: { body: Body } }, async (req) => {
      const session = requireSession(req);
      await deps.contact.put(session.id, req.body.field, {
        value: req.body.value,
        origin: "person-said",
        sourceText: req.body.value,
      });
      return deps.contact.getRecord(session.id);
    });
  };
}
