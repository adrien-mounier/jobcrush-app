// #390 (ADR-0019) — the profile's Preview as CV doors. Session-authenticated (requireSession, like
// GET /profile and the review): the profile sits before the wall. The rules (which job, when held,
// what the tailor is handed) are cvPreview.ts's; the engine, the checkpoint row and the gates are
// the tailored draft's own (tailorDraft.ts, tailorDraftStore.ts, tailorExport.ts) — this file only
// turns requests into those calls. Spend is bounded by the checkpoint: the same facts, letterhead
// and job never pay twice (the fingerprint), and a reload mid-make joins the run already paying.
import type { FastifyInstance } from "fastify";
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
import { conservationGate } from "../tailorExport.js";
import { CV_PREVIEW_AD_ID, cvPreviewHold, ownJob, ownJobTarget, NO_JOB_LINE } from "../cvPreview.js";

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

export function cvPreviewRoutes(deps: CvPreviewRouteDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    /** The hold (ADR-0019 clause 3) as a refusal, else everything the three doors read: the
     *  person's own job as the engine's target and the inputs whose fingerprint keys the row. */
    const resolve = async (session: SessionRecord) => {
      const blocks = await deps.jobBlocks.list(session.id);
      const hold = cvPreviewHold(session, blocks);
      if (hold)
        return { refused: { code: hold === NO_JOB_LINE ? "no_job" : "check_mode_open", message: hold } } as const;
      const [confirmed, negatives, contact] = await Promise.all([
        deps.claims.confirmed(session.id),
        deps.claims.negatives(session.id),
        deps.contact.getRecord(session.id),
      ]);
      const job = ownJob(blocks)!;
      const { posting, mustHaves } = ownJobTarget(job, deps.productionFamilyFloors);
      const inputs = draftInputsFor(confirmed, negatives, blocks, posting, letterheadText(contact), mustHaves);
      const stored = await deps.tailorDrafts.get(session.id, CV_PREVIEW_AD_ID);
      return {
        refused: undefined,
        job,
        posting,
        inputs,
        contact,
        // A row the inputs have outgrown reads as no preview at all — the remedy is a remake.
        stored: stored?.inputFingerprint === inputs.fingerprint ? stored : null,
      } as const;
    };

    // One in-flight make per (session, fingerprint): the job's id as a promise, reserved before
    // the job row exists, so two asks in the same tick still share one run. ponytail: per-process,
    // as the draft door's draftRuns is.
    const runs = new Map<string, Promise<string>>();

    /** Makes (or joins, or short-circuits) the preview. `{ ready: true }` on a checkpoint hit —
     *  nothing is spent — otherwise 202 + the job to watch over `GET /jobs/:id/events`. */
    app.post("/profile/cv-preview", async (req, reply) => {
      const session = requireSession(req);
      const r = await resolve(session);
      if (r.refused) return reply.status(409).send({ error: r.refused });
      if (!deps.tailorLlm)
        return reply.status(503).send({
          error: { code: "preview_unavailable", message: "writing the CV is switched off on this deployment" },
        });
      if (r.inputs.claimsDoc.claims.length === 0)
        return reply.status(409).send({ error: { code: "no_facts", message: "no confirmed facts to draft from" } });
      if (r.stored) return { ready: true };
      const runKey = JSON.stringify([session.id, r.inputs.fingerprint]);
      let run = runs.get(runKey);
      if (!run) {
        const tailorLlm = deps.tailorLlm;
        run = deps.jobs.create("cv-preview", session.id).then((job) => {
          void runTailorDraftJob(
            { jobs: deps.jobs, tailorDrafts: deps.tailorDrafts, tailorLlm },
            session.id,
            job.id,
            r.posting,
            r.inputs,
          ).finally(() => runs.delete(runKey));
          return job.id;
        });
        runs.set(runKey, run);
      }
      return reply.status(202).send({ jobId: await run });
    });

    /** The page: the PDF's own render (no draft watermark — it is the person's CV, not a proposal),
     *  and the job it was tailored for. Reading spends nothing. */
    app.get("/profile/cv-preview", async (req, reply) => {
      const session = requireSession(req);
      const r = await resolve(session);
      if (r.refused) return reply.status(409).send({ error: r.refused });
      if (!r.stored)
        return reply.status(404).send({ error: { code: "no_preview", message: "no preview for the profile as it is now" } });
      const view = tailorDraftView(
        r.stored,
        r.inputs.claimsDoc,
        r.posting,
        { phone: r.contact.phone?.value ?? null, email: r.contact.email?.value ?? null },
        { watermark: false },
      );
      return { html: view.html, draftedAt: view.draftedAt, job: { title: r.job.title.value, employer: r.job.employer.value } };
    });

    /** Download: the same document maker and the same server-side gate as an exported draft
     *  (ADR-0019 clause 2) — the conservation lint on the stored document refuses a fatal finding.
     *  ponytail: printed on the request itself (one person, one preview); the cold browser start
     *  is well inside the proxy's deadline, and a detached job with stored bytes is the upgrade
     *  if it ever is not. */
    app.get("/profile/cv-preview/pdf", async (req, reply) => {
      const session = requireSession(req);
      const r = await resolve(session);
      if (r.refused) return reply.status(409).send({ error: r.refused });
      if (!deps.documentMaker)
        return reply.status(503).send({
          error: { code: "export_unavailable", message: "making the PDF is switched off on this deployment" },
        });
      if (!r.stored)
        return reply.status(404).send({ error: { code: "no_preview", message: "no preview for the profile as it is now" } });
      const refused = conservationGate(r.stored, r.inputs);
      if (refused) return reply.status(refused.status).send({ error: { code: refused.code, message: refused.message } });
      const view = tailorDraftView(
        r.stored,
        r.inputs.claimsDoc,
        r.posting,
        { phone: r.contact.phone?.value ?? null, email: r.contact.email?.value ?? null },
        { watermark: false },
      );
      const printed = await deps.documentMaker.printCv(view.html);
      // The person's name into a safe filename — it is their own words, free text.
      const filename = `CV - ${r.stored.draft.name.replace(/[\\/:*?"<>|]/g, " ").trim()}.pdf`;
      return reply
        .type("application/pdf")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(printed.pdf);
    });
  };
}
