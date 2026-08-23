// #161 — the read + correction door for structured job records. Session-authenticated (same gate
// as contact.ts), reachable pre-wall. This is the interface a future confirm-deck frontend (#157
// Design A) builds against; no UI ships here.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  FamilyVersionReference,
  IndustryPlacement as IndustryPlacementContract,
  MinedDate,
  MinedEndValue,
  KINDS,
  countsTowardExperience,
  INDUSTRY_PLACEMENT_SCHEMA_VERSION,
  PLACEMENT_SCHEMA_VERSION,
} from "@jobcrush/contracts";
import type {
  FamilyPlacement,
  IndustryPlacement,
  Kind,
  HeldSentence,
  PublishedIndustryChoice,
} from "@jobcrush/contracts";
import { holdContradictingSentences } from "../heldSentences.js";
import { requireSession } from "../server.js";
import type { DecisionKey, JobBlockStore, JobBlockView } from "../jobBlockStore.js";
import type { ClaimStore } from "../claims.js";
import type { EligibilityStore } from "../eligibility.js";
import { refreshWorkedYears, verifyWorkedYears } from "../yearsWorked.js";
import { runLabelerRetry } from "../jobBlockPlacementRetry.js";

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
  /** #281: the closed published INDUSTRY vocabulary, on exactly the same terms as `families` above —
   *  it is what an industry correction is checked against, which is what makes the vocabulary
   *  closed outside the screen. Absent → every industry correction is refused, which is the correct
   *  behaviour for a build with no vocabulary wired. */
  industries?: () => PublishedIndustryChoice[];
  retryJobBlockLabels?: (sessionId: string) => Promise<void>;
  /** #281: the industry half of the same best-effort retry — a job left unplaced by an earlier
   *  labeler miss is placed before the screen reads it. Idempotent by the step's own checkpoint. */
  retryJobBlockIndustryLabels?: (sessionId: string) => Promise<void>;
}

const Params = z.object({ blockId: z.string() });

// Review fix #1: a correction's `value` is validated per decision key against the SAME shape the
// contract requires of the miner's own output — `value: z.unknown()` let `{key:"kind",
// value:"hobby"}` or `{key:"start", value:"whenever"}` persist junk that toView then casts straight
// to Kind/MinedDate downstream.
/** What the INDUSTRY PICKER sends: which published industry this job was in. Deliberately NOT the
 *  contract's `IndustryVersionReference`, which since #282 (v2) also carries a confidence — that is
 *  the STORED shape, and confidence is ours to stamp, never something a browser gets to assert. A
 *  person's own answer is always `certain`; letting the wire say otherwise would let a caller ask
 *  for its own correction to be attenuated. */
const IndustryPick = z
  .object({ industryId: z.string(), version: z.number().int().positive() })
  .strict();

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
  // #281: her own answer to "what industry was this?" — a reference into the closed published
  // vocabulary, never free text. Which industry versions actually exist is checked in the handler.
  //
  // Or a WHOLE placement, which is the UNDO rather than a second way to answer. #157 Design A's "no
  // action in this flow is irreversible without a visible undo" binds here because the screen offers
  // an industry picker — and a single reference cannot express what the undo has to put back: the
  // machine may have said "no industry fits", or it may have said TWO (a consultancy job served into
  // banking), at a confidence of its own. Restoring only the first of two, at a confidence nobody
  // measured, is an undo that quietly changes the answer — so the door takes the placement whole.
  // Every industry it names is still checked against the published vocabulary in the handler.
  z.object({
    key: z.literal("industry"),
    value: z.union([IndustryPick, IndustryPlacementContract]),
  }),
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

    // #281: the same guard for the second axis — only a PUBLISHED industry may be stored, or a
    // person's numbers would be pinned to an industry that does not exist.
    const publishedIndustryChoices = (): PublishedIndustryChoice[] => deps.industries?.() ?? [];

    // The confirm deck's own read: every dated block, each of its five decisions (value + origin +
    // machine_touch + classification + a stable per-decision id a correction can target), whether
    // it counts toward experience (derived, never asked), an ambiguous block's candidate ids, plus
    // deck-level totals and the not_run/ok/failed read state (#161 AC8's negative test, surfaced
    // here — "failed" is distinct from "ok, blocksFound: 0").
    app.get("/job-blocks", async (req) => {
      const session = requireSession(req);
      await runLabelerRetry(deps.retryJobBlockLabels, session.id, fastify.log);
      await runLabelerRetry(deps.retryJobBlockIndustryLabels, session.id, fastify.log);
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
      //
      // #281: the published INDUSTRIES do travel, for the opposite reason — something reads them.
      // The work-history screen prints the industry beside the employer, and a placement carries ids
      // and versions only, so the display names have to come from the same publication the labeler
      // placed into. It is also what the correction picker offers, so the screen can never offer a
      // choice the correction door would then refuse. Not a question: a list to show and to pick
      // from when she disagrees, never a prompt asking her which industry she was in.
      return { blocks, summary, industries: publishedIndustryChoices() };
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
        let industryLabel: string | null = null;
        if (key === "industry" && "schemaVersion" in value) {
          // The undo path — see CorrectBody's own note. Stored as a correction rather than by
          // clearing one, because the store has no un-correct: what she reads back is exactly what
          // she read before the correction she is undoing, confidence and second industry included.
          const choices = publishedIndustryChoices();
          const named = value.outcome === "confirmed" ? value.industries : [];
          // Checked one by one, like the single-reference path: an undo is still a write, and a
          // vocabulary that has moved on since the placement was made must not slip an unpublished
          // industry back in through the door that exists to keep the vocabulary closed.
          const unpublished = named.find(
            (ref) => !choices.some((i) => i.industryId === ref.industryId && i.version === ref.version),
          );
          if (unpublished) {
            return reply
              .status(400)
              .send({ error: { code: "unknown_industry", message: "no such published industry" } });
          }
          const names = named.map(
            (ref) => choices.find((i) => i.industryId === ref.industryId)?.label ?? ref.industryId,
          );
          industryLabel = names.length ? names.join(" and ") : null;
          stored = value;
        } else if (key === "industry" && "industryId" in value) {
          const named = value;
          const known = publishedIndustryChoices().find(
            (industry) => industry.industryId === named.industryId && industry.version === named.version,
          );
          if (!known) {
            return reply
              .status(400)
              .send({ error: { code: "unknown_industry", message: "no such published industry" } });
          }
          industryLabel = known.label;
          stored = {
            schemaVersion: INDUSTRY_PLACEMENT_SCHEMA_VERSION,
            outcome: "confirmed",
            // Her own answer is the one placement nothing is unsure about, so it is never
            // attenuated. The machine's doubt was about the machine. (#282 moved confidence onto
            // each industry; a correction names one industry, so there is one to stamp.)
            industries: [
              { industryId: known.industryId, version: known.version, confidence: "certain" },
            ],
            // KNOWN LIMIT, same as the family door's: a correction names ONE industry and
            // supersedes whatever was there, so correcting a job the machine placed in two narrows
            // it to one. That is the right reading of the only correction a screen can currently
            // express ("this job was in X"). Widen when a surface exists that can say "it was both".
          } satisfies IndustryPlacement;
        }
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
          // `family` and `industry` are excluded for a stronger reason: both quote no source words
          // at all, so no confirmed sentence can be carrying the value they supersede.
          if (key !== "kind" && key !== "family" && key !== "industry") {
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
          key === "industry"
            ? // #281 moves no number, and this sentence must not imply one. It says what the
              // correction actually did: the label is hers now. The years-per-industry consequence
              // arrives with the thing that computes it (#285).
              (industryLabel
                ? `We'll show this job as ${industryLabel} from now on.`
                : "We've put this job's industry back to not knowing.")
            : key === "family"
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
