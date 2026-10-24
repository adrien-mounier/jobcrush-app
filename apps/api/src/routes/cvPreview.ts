// #390 (ADR-0019) — the profile's Preview as CV doors. Session-authenticated (requireSession, like
// GET /profile and the review): the profile sits before the wall. The rules (which job, when held,
// what the tailor is handed) are cvPreview.ts's; the engine, the checkpoint row and the gates are
// the tailored draft's own (tailorDraft.ts, tailorDraftStore.ts, tailorExport.ts) — this file only
// turns requests into those calls. Spend is bounded by the checkpoint: the same facts, letterhead
// and job never pay twice (the fingerprint), and a reload mid-make joins the run already paying.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { ClaimStore } from "../claims.js";
import type { SessionRecord } from "../sessions.js";
import type { JobBlockStore } from "../jobBlockStore.js";
import type { ProductionFamilyFloorStore } from "../familyFloors.js";
import type { JobStore } from "../jobs.js";
import { letterheadText, type ContactStore } from "../contact.js";
import type { LlmClient } from "../llm.js";
import type { DocumentMaker } from "../documentMaker.js";
import type { TailorDraftStore } from "../tailorDraftStore.js";
import { draftInputsFor, runTailorDraftJob, tailorDraftView } from "../tailorDraft.js";
import { conservationGate, safeFilename } from "../tailorExport.js";
import { CV_PREVIEW_AD_ID, cvPreviewDoor, ownJobTarget } from "../cvPreview.js";
import { Refusal } from "./refusal.js";

export interface CvPreviewRouteDeps {
  claims: ClaimStore;
  jobBlocks: JobBlockStore;
  productionFamilyFloors: ProductionFamilyFloorStore;
  contact: ContactStore;
  jobs: JobStore;
  tailorDrafts: TailorDraftStore;
  /** The readPastedAdvert rule, as on the draft doors: absent ⇒ the door answers 503. */
  tailorLlm?: LlmClient;
  documentMaker?: DocumentMaker;
}

const noPreview = { error: { code: "no_preview", message: "no preview for the profile as it is now" } };

export function cvPreviewRoutes(deps: CvPreviewRouteDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    /** The hold (ADR-0019 clause 3) as a refusal, else everything the three doors read: the
     *  person's own job as the engine's target, the inputs whose fingerprint keys the row, and the
     *  stored row's render (the PDF's own — no draft banner: it is the person's CV, not a
     *  proposal). */
    const resolve = async (session: SessionRecord) => {
      const blocks = await deps.jobBlocks.list(session.id);
      const door = cvPreviewDoor(session, blocks);
      if (door.hold) return { refused: door.hold } as const;
      const [confirmed, negatives, contact] = await Promise.all([
        deps.claims.confirmed(session.id),
        deps.claims.negatives(session.id),
        deps.contact.getRecord(session.id),
      ]);
      const { posting, mustHaves } = ownJobTarget(door.job, deps.productionFamilyFloors);
      const inputs = draftInputsFor(confirmed, negatives, blocks, posting, letterheadText(contact), mustHaves);
      const row = await deps.tailorDrafts.get(session.id, CV_PREVIEW_AD_ID);
      // A row the inputs have outgrown reads as no preview at all — the remedy is a remake.
      const stored = row?.inputFingerprint === inputs.fingerprint ? row : null;
      const view = stored
        ? tailorDraftView(
            stored,
            inputs.claimsDoc,
            posting,
            { phone: contact.phone?.value ?? null, email: contact.email?.value ?? null },
            { banner: false },
          )
        : null;
      return { refused: undefined, job: door.job, posting, inputs, stored, view } as const;
    };

    // One in-flight make per (session, fingerprint): the job's id as a promise, reserved before
    // the job row exists, so two asks in the same tick still share one run. A reservation whose
    // job never opened is dropped at once — the next ask tries again, never re-awaits the failure.
    // ponytail: per-process, as the draft door's draftRuns is.
    const runs = new Map<string, Promise<string>>();

    /** Makes (or joins, or short-circuits) the preview. `{ ready: true }` on a checkpoint hit —
     *  nothing is spent — otherwise 202 + the job to watch over `GET /jobs/:id/events`. */
    app.post(
      "/profile/cv-preview",
      {
        schema: {
          response: { 200: z.object({ ready: z.literal(true) }), 202: z.object({ jobId: z.string() }), 409: Refusal, 503: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const r = await resolve(session);
        if (r.refused) return reply.status(409).send({ error: r.refused });
        if (!deps.tailorLlm)
          return reply.status(503).send({
            error: { code: "preview_unavailable", message: "writing the CV is switched off on this deployment" },
          });
        if (r.inputs.claimsDoc.claims.length === 0)
          return reply.status(409).send({ error: { code: "no_facts", message: "no confirmed facts to draft from" } });
        if (r.stored) return { ready: true as const };
        const runKey = JSON.stringify([session.id, r.inputs.fingerprint]);
        let run = runs.get(runKey);
        if (!run) {
          const tailorLlm = deps.tailorLlm;
          run = deps.jobs
            .create("cv-preview", session.id)
            .then((job) => {
              void runTailorDraftJob(
                { jobs: deps.jobs, tailorDrafts: deps.tailorDrafts, tailorLlm },
                session.id,
                job.id,
                r.posting,
                r.inputs,
              ).finally(() => runs.delete(runKey));
              return job.id;
            })
            .catch((err: unknown) => {
              runs.delete(runKey);
              throw err;
            });
          runs.set(runKey, run);
        }
        return reply.status(202).send({ jobId: await run });
      },
    );

    /** The page: the PDF's own render and the job it was tailored for. Reading spends nothing. */
    app.get(
      "/profile/cv-preview",
      {
        schema: {
          response: {
            200: z.object({ html: z.string(), draftedAt: z.string(), job: z.object({ title: z.string(), employer: z.string() }) }),
            404: Refusal,
            409: Refusal,
          },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const r = await resolve(session);
        if (r.refused) return reply.status(409).send({ error: r.refused });
        if (!r.view) return reply.status(404).send(noPreview);
        return { html: r.view.html, draftedAt: r.view.draftedAt, job: { title: r.job.title.value, employer: r.job.employer.value } };
      },
    );

    /** Download: the same document maker and the same server-side gate as an exported draft
     *  (ADR-0019 clause 2) — the conservation lint on the stored document refuses a fatal finding.
     *  ponytail: printed on the request itself (one person, one preview); the cold browser start
     *  is well inside the proxy's deadline, and a detached job with stored bytes is the upgrade
     *  if it ever is not. */
    app.get(
      "/profile/cv-preview/pdf",
      // The 200 is the PDF's bytes: Fastify sends a Buffer as it is, never through a serializer.
      { schema: { response: { 200: z.instanceof(Buffer), 404: Refusal, 409: Refusal, 503: Refusal } } },
      async (req, reply) => {
        const session = requireSession(req);
        const r = await resolve(session);
        if (r.refused) return reply.status(409).send({ error: r.refused });
        if (!deps.documentMaker)
          return reply.status(503).send({
            error: { code: "export_unavailable", message: "making the PDF is switched off on this deployment" },
          });
        if (!r.stored || !r.view) return reply.status(404).send(noPreview);
        const refused = conservationGate(r.stored, r.inputs);
        if (refused) return reply.status(refused.status).send({ error: { code: refused.code, message: refused.message } });
        const printed = await deps.documentMaker.printCv(r.view.html);
        // The person's name into a safe filename — it is their own words, free text.
        const filename = `CV - ${safeFilename(r.stored.draft.name)}.pdf`;
        return reply
          .type("application/pdf")
          .header("content-disposition", `attachment; filename="${filename}"`)
          .send(printed.pdf);
      },
    );
  };
}
