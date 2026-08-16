// #161 — the read + correction door for structured job records. Session-authenticated (same gate
// as contact.ts), reachable pre-wall. This is the interface a future confirm-deck frontend (#157
// Design A) builds against; no UI ships here.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  FamilyVersionReference,
  MinedDate,
  MinedEndValue,
  KINDS,
  countsTowardExperience,
  PLACEMENT_SCHEMA_VERSION,
} from "@jobcrush/contracts";
import type { FamilyPlacement, Kind, HeldSentence } from "@jobcrush/contracts";
import { holdContradictingSentences } from "../heldSentences.js";
import { requireSession } from "../server.js";
import type { DecisionKey, JobBlockStore, JobBlockView } from "../jobBlockStore.js";
import type { ClaimStore } from "../claims.js";
import type { EligibilityStore } from "../eligibility.js";
import { refreshWorkedYears, verifyWorkedYears } from "../yearsWorked.js";
import { retryJobBlockLabels } from "../jobBlockPlacementRetry.js";

export interface JobBlocksDeps {
  jobBlocks: JobBlockStore;
  /** #163 / ADR-0002 clause 3: lets a correction hold aside confirmed sentences that still carry
   *  the superseded value. Optional so pre-existing test builds keep working unchanged. */
  claims?: ClaimStore;
  /** #162: every door here can move the years-of-experience total, which is a regenerable COPY of
   *  these records — re-derived after each change so a read anywhere else sees the correction.
   *  Required, not optional: an absent store would silently drop AC5's drift backstop. */
  eligibility: EligibilityStore;
  /** #221: the closed published vocabulary, read fresh per request (a family published mid-session
   *  is offerable immediately). It is BOTH what the review screen offers for a job nobody could
   *  place AND what a family correction is checked against — the vocabulary is only closed if
   *  something outside the screen enforces it. Absent → no families offered and every family
   *  correction is refused, which is the correct behaviour for a build with no registry wired. */
  families?: () => Array<{ familyId: string; version: number; label: string }>;
  retryJobBlockLabels?: (sessionId: string) => Promise<void>;
}

const Params = z.object({ blockId: z.string() });

// Review fix #1: a correction's `value` is validated per decision key against the SAME shape the
// contract requires of the miner's own output — `value: z.unknown()` let `{key:"kind",
// value:"hobby"}` or `{key:"start", value:"whenever"}` persist junk that toView then casts straight
// to Kind/MinedDate downstream.
const CorrectBody = z.discriminatedUnion("key", [
  z.object({ key: z.literal("employer"), value: z.string().min(1) }),
  z.object({ key: z.literal("title"), value: z.string().min(1) }),
  z.object({ key: z.literal("start"), value: MinedDate }),
  z.object({ key: z.literal("end"), value: MinedEndValue }),
  z.object({ key: z.literal("kind"), value: z.enum(KINDS) }),
  // #221: the visitor's own answer to "what kind of work is this?" — a reference into the closed
  // published list, never free text. Which family versions actually exist is checked in the handler
  // (the contract can only police the shape).
  z.object({ key: z.literal("family"), value: FamilyVersionReference }),
]);

const ResolveMatchBody = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("same"), matchedBlockId: z.string() }),
  z.object({ resolution: z.literal("different") }),
]);

const notFound = (message: string) => ({ error: { code: "not_found", message } });

// #163 binding UX intent — "the person is told what a correction will change downstream (their
// total, their matches) in plain words." #162 now computes that total (yearsWorked.ts, re-derived by
// reworkYears below) but still does not QUOTE it here: no route exposes the total and no screen
// renders it yet, so naming a number would promise a readback that does not exist. The consequence
// is named instead, which is what the ticket asked for.
const downstreamMessage = (key: Exclude<DecisionKey, "family">, value: unknown, before: JobBlockView): string => {
  if (key === "kind") {
    const now = countsTowardExperience(value as Kind);
    if (before.countsTowardExperience !== now) {
      return now
        ? "This entry now counts toward your years of experience — your total and your matches can change."
        : "This entry no longer counts toward your years of experience — your total and your matches can change.";
    }
    return "Every later CV will show this entry as its corrected kind.";
  }
  if (key === "start" || key === "end") {
    return "Every later CV will use the corrected dates for this job — your years of experience and your matches can change.";
  }
  return `Every later CV will show "${String(value)}" for this job.`;
};

export function jobBlocksRoutes(deps: JobBlocksDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // #162 AC5 — the stored total is a copy; the records underneath always win. Re-derived after
    // every door that can change a record, with a disagreement counted (yearsWorked.ts).
    const reworkYears = (sessionId: string) => refreshWorkedYears(deps.jobBlocks, deps.eligibility, sessionId);

    // #221: id, version and the display name. The rest of a publication (scope, evidence, floor
    // questions) is the labeler's business. #231 left this as the correction door's own guard: it is
    // what makes "only a PUBLISHED family may be stored" true outside the screen.
    const publishedChoices = () =>
      (deps.families?.() ?? []).map(({ familyId, version, label }) => ({ familyId, version, label }));

    // The confirm deck's own read: every dated block, each of its five decisions (value + origin +
    // machine_touch + classification + a stable per-decision id a correction can target), whether
    // it counts toward experience (derived, never asked), an ambiguous block's candidate ids, plus
    // deck-level totals and the not_run/ok/failed read state (#161 AC8's negative test, surfaced
    // here — "failed" is distinct from "ok, blocksFound: 0").
    app.get("/job-blocks", async (req) => {
      const session = requireSession(req);
      await retryJobBlockLabels(deps.retryJobBlockLabels, session.id, fastify.log);
      const [blocks, summary] = await Promise.all([
        deps.jobBlocks.list(session.id),
        deps.jobBlocks.summary(session.id),
      ]);
      // #162 AC5's backstop, on the one path where it can mean something: nothing here changed a
      // record, so a stored total that disagrees with a fresh recompute is a REAL event — a door that
      // mutated a record without re-deriving. Counted and repaired, never silently absorbed. The
      // records are already in hand, so this costs one eligibility read (and a write only on drift).
      await verifyWorkedYears(deps.eligibility, session.id, blocks, summary.read);
      // #231: the published families no longer travel with the deck. They were here so the review
      // screen could offer choices for a job nobody could place — nobody is asked any more, so this
      // was a list nothing read. The list itself still guards the CORRECTION door below, where the
      // closed vocabulary is actually enforced.
      return { blocks, summary };
    });

    app.post(
      "/job-blocks/:blockId/confirm",
      { schema: { params: Params } },
      async (req, reply) => {
        const session = requireSession(req);
        const found = await deps.jobBlocks.confirm(session.id, req.params.blockId);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        return { ok: true };
      },
    );

    // #157 Design A — "no action in this flow is irreversible without a visible undo." Corrections
    // undo by re-correcting to the superseded value; confirm had no reverse until this endpoint.
    app.post(
      "/job-blocks/:blockId/unconfirm",
      { schema: { params: Params } },
      async (req, reply) => {
        const session = requireSession(req);
        const found = await deps.jobBlocks.unconfirm(session.id, req.params.blockId);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        return { ok: true };
      },
    );

    app.post(
      "/job-blocks/:blockId/correct",
      { schema: { params: Params, body: CorrectBody } },
      async (req, reply) => {
        const session = requireSession(req);
        const { key, value } = req.body;
        // Snapshot what this correction supersedes BEFORE it lands — the store only remembers the
        // ORIGINAL read as superseded, but the person contradicts what was showing until now.
        const before = (await deps.jobBlocks.list(session.id)).find(
          (b: JobBlockView) => b.id === req.params.blockId,
        );
        // #221: a family correction names a family version, and only a PUBLISHED one may be stored —
        // an unknown id would pin this person's per-family numbers to a family that does not exist.
        // What lands is the contract's own confirmed placement, so a corrected label and a
        // machine-placed one are the same shape everywhere downstream.
        let stored: unknown = value;
        let familyLabel: string | null = null;
        if (key === "family") {
          const known = publishedChoices().find(
            (family) => family.familyId === value.familyId && family.version === value.version,
          );
          if (!known) {
            return reply
              .status(400)
              .send({ error: { code: "unknown_family", message: "no such published job family" } });
          }
          familyLabel = known.label;
          stored = {
            schemaVersion: PLACEMENT_SCHEMA_VERSION,
            outcome: "confirmed",
            families: [{ familyId: known.familyId, version: known.version }],
            // #231 — a person's own answer is the one placement nothing is unsure about, so it is
            // never attenuated in the ranking. The machine's doubt was about the machine.
            confidence: "certain",
            // KNOWN LIMIT, deliberate: the contract went plural, this door did not. A correction
            // names ONE family and supersedes whatever was there, so a person correcting a job the
            // machine placed in two families narrows it to one. That is the right reading of the
            // only correction anything can currently express ("this job is X"), and #231 scopes
            // #128's correction machinery as untouched — but nothing can yet say "it is both".
            // Widen this door when a surface exists that can ask for two.
          } satisfies FamilyPlacement;
        }
        const found = await deps.jobBlocks.correct(session.id, req.params.blockId, key, stored);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        let held: HeldSentence[] = [];
        if (deps.claims && before) {
          const decisions = {
            employer: before.employer,
            title: before.title,
            start: before.start,
            end: before.end,
            kind: before.kindDecision,
          } as const;
          // `kind` is excluded: its values ("job", …) are generic words that would false-match.
          // `family` is excluded for a stronger reason: it quotes no source words at all, so no
          // confirmed sentence can be carrying the value it supersedes.
          if (key !== "kind" && key !== "family") {
            held = await holdContradictingSentences(
              deps.claims,
              session.id,
              key,
              decisions[key].value,
              value,
            );
          }
        }
        await reworkYears(session.id);
        // `before` exists whenever correct() found the block; null only on a delete race.
        const downstream =
          key === "family"
            ? // Deliberately says only what is true TODAY. Naming a per-family years number here
              // would promise a readback nothing computes yet (that is #222) — the same rule
              // downstreamMessage below already follows for the total.
              `We'll count this job as ${familyLabel} from now on.`
            : before
              ? downstreamMessage(key, value, before)
              : null;
        return { ok: true, held, downstream };
      },
    );

    app.post(
      "/job-blocks/:blockId/detach",
      { schema: { params: Params } },
      async (req, reply) => {
        const session = requireSession(req);
        const found = await deps.jobBlocks.detach(session.id, req.params.blockId);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        await reworkYears(session.id);
        return { ok: true };
      },
    );

    // The person's answer to an ambiguous match (#157 Design A's own "ask when ambiguous"): "same
    // job as X" merges into the existing block (keeping every confirmation/correction it already
    // carries); "different job" lets the ambiguous block stand alone as its own recognised job.
    app.post(
      "/job-blocks/:blockId/resolve-match",
      { schema: { params: Params, body: ResolveMatchBody } },
      async (req, reply) => {
        const session = requireSession(req);
        const resolution =
          req.body.resolution === "same"
            ? ({ type: "same" as const, matchedBlockId: req.body.matchedBlockId })
            : ({ type: "different" as const });
        const found = await deps.jobBlocks.resolveMatch(session.id, req.params.blockId, resolution);
        if (!found) return reply.status(404).send(notFound("unknown job block or candidate"));
        await reworkYears(session.id);
        return { ok: true };
      },
    );
  };
}
