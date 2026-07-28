import type { FastifyInstance } from "fastify";
import { FamilyPlacement } from "@jobcrush/contracts";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireSession } from "../server.js";
import type {
  FamilyCandidateScreen,
  FamilyMatchNotifier,
  FamilyLearningAttempt,
  FamilyScreeningDecision,
  FamilyLearningStore,
} from "../familyLearning.js";
import { progressFamilyLearning } from "../familyLearning.js";

const safeAttempt = (attempt: FamilyLearningAttempt) => ({
  id: attempt.id,
  targetRole: attempt.targetRole,
  searchArea: attempt.searchArea,
  screeningOutcome: attempt.screeningOutcome,
  screeningRationale: attempt.screeningRationale,
  screeningIndicators: attempt.screeningIndicators,
  canonicalAttemptId: attempt.canonicalAttemptId,
  coveredFamily: attempt.coveredFamily,
  status: attempt.status,
  createdAt: attempt.createdAt,
  updatedAt: attempt.updatedAt,
});

export interface FamilyLearningRouteDeps {
  store: FamilyLearningStore;
  screen?: FamilyCandidateScreen;
  operatorKey?: string;
  notify?: FamilyMatchNotifier;
  knownFamilies?: Array<{ familyId: string; version: number }>;
}

const notificationPromise =
  "We will notify you only when credible matches for this target role are ready.";

export function familyLearningRoutes(deps: FamilyLearningRouteDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/family-learning/candidates",
      {
        schema: {
          body: z
            .object({
              targetRole: z.string().trim().min(2).max(160),
              placement: FamilyPlacement,
            })
            .strict(),
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        if (req.body.placement.outcome !== "unmapped") {
          return reply.status(409).send({
            error: {
              code: "family_already_mapped",
              message: "family learning starts only for an unmapped target role",
            },
          });
        }
        if (
          !session.intent.targetRole ||
          session.intent.targetRole.trim().toLocaleLowerCase("en-US") !==
            req.body.targetRole.trim().toLocaleLowerCase("en-US")
        ) {
          return reply.status(409).send({
            error: {
              code: "target_role_mismatch",
              message: "target role must match the preserved search intent",
            },
          });
        }
        if (!deps.screen) {
          return reply.status(503).send({
            error: {
              code: "family_screening_unavailable",
              message: "family research screening is not available yet",
            },
          });
        }
        let screened: FamilyScreeningDecision;
        try {
          const canonicalCandidates = await deps.store.acceptedCanonicalCandidates();
          screened = await deps.screen({
            targetRole: req.body.targetRole,
            searchArea: session.intent.searchArea,
            canonicalCandidates,
            knownFamilies: deps.knownFamilies ?? [],
          });
          if (
            screened.outcome === "equivalent" &&
            !canonicalCandidates.some((candidate) => candidate.id === screened.canonicalAttemptId)
          ) {
            throw new Error("screening referenced unknown canonical attempt");
          }
          if (
            screened.outcome === "covered_role" &&
            !(deps.knownFamilies ?? []).some(
              (family) =>
                family.familyId === screened.coveredFamily?.familyId &&
                family.version === screened.coveredFamily.version,
            )
          ) {
            throw new Error("screening referenced unknown family");
          }
        } catch {
          return reply.status(503).send({
            error: {
              code: "family_screening_unavailable",
              message: "family research screening could not be completed",
            },
          });
        }
        const attempt = await deps.store.submit(
          session.id,
          req.body.targetRole,
          screened,
          session.intent.searchArea,
        );
        reply.status(202);
        return {
          discoveryStopped: true,
          attempt: safeAttempt(attempt),
          notificationPromise,
        };
      },
    );

    app.get("/family-learning/return", async (req, reply) => {
      const session = requireSession(req);
      const attempt = await deps.store.latestForSession(session.id);
      if (!attempt) {
        return reply.status(404).send({
          error: { code: "not_found", message: "no family learning attempt" },
        });
      }
      const correction =
        attempt.status === "rejected" || attempt.status === "validation_failed"
          ? {
              canCorrectTarget: true,
              message: "Please check or correct this target role before trying again.",
            }
          : null;
      return {
        targetRole: attempt.targetRole,
        status: attempt.status,
        correction,
        notificationPromise,
      };
    });

    app.post(
      "/operator/family-learning/attempts/:id/progress",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: z.discriminatedUnion("event", [
            z.object({ event: z.literal("validation_passed") }).strict(),
            z.object({ event: z.literal("validation_failed") }).strict(),
            z.object({ event: z.literal("family_published") }).strict(),
            z
              .object({
                event: z.literal("fulfillment_evaluated"),
                relevantVacancy: z.boolean(),
              })
              .strict(),
          ]),
        },
      },
      async (req, reply) => {
        if (!deps.operatorKey) {
          return reply.status(503).send({
            error: { code: "operator_unavailable", message: "operator control is not configured" },
          });
        }
        if (req.headers.authorization !== `Bearer ${deps.operatorKey}`) {
          return reply.status(403).send({
            error: { code: "forbidden", message: "operator authorization required" },
          });
        }
        const attempt = await progressFamilyLearning(
          deps.store,
          req.params.id,
          req.body,
          deps.notify,
        );
        return { attempt: safeAttempt(attempt) };
      },
    );

  };
}
