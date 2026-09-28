// #303 — the two endpoints the paste door needs. Both are thin on purpose: the paste path itself is
// pastedAdvert.ts, the card is deck.ts's own assembly pass, and this file only turns a request into
// a call and an outcome into a reply.
//
// Its own file rather than routes/onboarding.ts (#301's "where the code lands", and the spine's
// ratchet): the spine had exactly zero headroom when this ticket started, and the honest answer to
// that is a module beside the subsystem, not a line bought by shaving somebody's rationale. Nothing
// here is onboarding's business — the paste door is a subsystem of its own, with its own store.
//
// Session-authenticated, not user-authenticated, and deliberately: the paste record is keyed on the
// session and joins purge.ts's sweep of unclaimed anonymous sessions (#294 clause 11), which only
// means anything if an unclaimed session can reach this at all. The door is OFFERED on signed-in
// screens; that is the product's choice about where to put a button, not a wall the spec asked for.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AdRequirementsV1, FamilyPlacement } from "@jobcrush/contracts";
import { requireSession } from "../server.js";
import type { SessionRecord } from "../sessions.js";
import type { ClaimStore } from "../claims.js";
import type { EligibilityStore } from "../eligibility.js";
import type { JobBlockStore } from "../jobBlockStore.js";
import type { JudgeFn, JudgePeekFn } from "../judge.js";
import { advertFamilyIdFor, buildDeckCards, resolveSessionYears, type JobCard } from "../deck.js";
import { readingLanguages } from "../language.js";
import { eligiblePostings, type Posting } from "../preview.js";
import {
  isWebLink,
  MAX_ADVERT_CHARS,
  pasteAdvert,
  pastedPostings,
  type PasteAdvertDeps,
  type PasteAdvertRefusal,
} from "../pastedAdvert.js";

export interface PasteDeps extends PasteAdvertDeps {
  claims: ClaimStore;
  eligibility: EligibilityStore;
  jobBlocks: JobBlockStore;
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>;
  /** #104/#105, the same optional seams the deck route carries: absent → fixture-only reads and the
   *  deterministic tick, so a build that wires neither behaves exactly as it does today. */
  readAd?: (posting: Posting) => Promise<AdRequirementsV1 | null>;
  judge?: JudgeFn;
  judgePeek?: JudgePeekFn;
}

const Body = z.object({
  text: z.string().min(1).max(MAX_ADVERT_CHARS),
  /** Optional and up front (#291): the paste screen pre-fills it from the text when the text
   *  carries one, and an empty string means he cleared it, which is a real answer. Anything else
   *  must be a real web address — this value is printed at the top of the application email and
   *  rendered as an anchor, so the scheme is a safety question (isWebLink, which lives beside the
   *  write path that stores it). Refused at the boundary AND normalised again at the write. */
  applicationUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => value === "" || isWebLink(value), {
      message: "the application link must start with http:// or https://",
    })
    .nullish(),
});

const Params = z.object({ adId: z.string().min(1) });

const PASTE_FAILURES: Record<PasteAdvertRefusal, string> = {
  too_short: "there is not enough here to read as a job advert",
  unsupported_language: "we can only read job adverts written in English at the moment",
  unreadable: "we could not read a job advert out of that text",
  reader_unavailable: "reading a pasted advert is not configured on this deployment",
};


export function pasteRoutes(deps: PasteDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    /** The one card for one advert, assembled by the deck's own pass over a single posting — the
     *  same reader, scorer and checkpoints every other card gets (#290 ruling 1), rather than a
     *  second card-shaping path that could drift from the deck's. Null = withdrawn for this
     *  person's own eligibility, or in a language she does not read: the same "unknown card" the
     *  deck's other doors answer with. #305 is where a pasted job stops being withdrawable at all.
     *
     *  `deckFamilyId` is null, not this session's family: family-fit DELETION is a property of a
     *  DECK — is this advert worth a slot in a list she is browsing — and she is looking at one job
     *  she asked for by name. The years scope still reads the session's real family, so the number
     *  here is the number the deck would show. #305 states the same rule for the deck itself. */
    const cardFor = async (session: SessionRecord, posting: Posting): Promise<CardOutcome> => {
      const [confirmed, negatives, facts, blocks] = await Promise.all([
        deps.claims.confirmed(session.id),
        deps.claims.negatives(session.id),
        deps.eligibility.list(session.id),
        deps.jobBlocks.list(session.id),
      ]);
      const years = resolveSessionYears(facts, blocks, await advertFamilyIdFor(session, deps.placeFamily));
      const langs = readingLanguages(session);
      const { cards, withdrawn } = await buildDeckCards(
        eligiblePostings(langs, [posting]),
        { confirmed, negatives, facts, years, deckFamilyId: null, langs },
        deps,
      );
      if (cards[0]) return { card: cards[0] };
      // No card has two completely different causes and they must never arrive as one message.
      // `withdrawn` is the real one: she told us she cannot take this kind of job. Anything else —
      // the requirements read timed out, or came back unusable — means we did not finish READING
      // it, which on a slow first read is common and is fixed by pressing again (the read is
      // checkpointed, so the retry is instant and free). Telling her "this job asks for something
      // you do not have" about an advert nobody has read yet is the worst of the two to get wrong.
      return { refusal: withdrawn.total > 0 ? "withdrawn" : "read_incomplete" };
    };

    /** The advert behind an adId, for THIS person — scoped by her own paste record, never by the
     *  id alone. The reading is shared (#294 ruling 1); being allowed to open the screen is a
     *  different question, and `adId` is a hash of (company, location, title), which anyone who has
     *  seen the job can compute. The card carries `adExcerpt`, which for a pasted advert is the
     *  whole pasted text — #294 clause 10 names what that text can contain — so an unscoped lookup
     *  here would hand one person's paste to anyone who guessed the three fields.
     *
     *  Pasted jobs only. A job the app FOUND has its own screen the day #306 needs one; nothing in
     *  #303 lands anyone on it, and a second resolution path with no caller is a path nothing
     *  tests. */
    const pastedPostingFor = async (session: SessionRecord, adId: string): Promise<Posting | undefined> => {
      const records = await deps.pasteRecords.listBySession(session.id);
      if (!records.some((record) => record.adId === adId)) return undefined;
      return (await pastedPostings(deps.postings)).find((p) => p.id === adId);
    };

    app.post("/onboarding/paste", { schema: { body: Body } }, async (req, reply) => {
      const session = requireSession(req);
      const outcome = await pasteAdvert(deps, {
        sessionId: session.id,
        text: req.body.text,
        applicationUrl: req.body.applicationUrl ?? null,
      });
      if (!outcome.ok) {
        // #304 turns these into the failure screen that keeps his text. Here they are named
        // honestly and separately — "we could not read it" and "there was not enough to read" are
        // different things to tell somebody — and 422 says the request was fine and the content
        // was not.
        return reply
          .status(outcome.reason === "reader_unavailable" ? 503 : 422)
          .send({ error: { code: outcome.reason, message: PASTE_FAILURES[outcome.reason] } });
      }
      const built = await cardFor(session, outcome.posting);
      // The advert is stored whatever happens here, so nothing is lost and a retry re-spends
      // nothing; what he is told is why he is not being shown a card.
      if ("refusal" in built) return reply.status(409).send({ error: CARD_REFUSALS[built.refusal] });
      // He asked for this job, so he goes to the job — never back to the deck (#291 ruling 2). The
      // card travels with the id so the screen he lands on renders without a second round trip.
      return { adId: outcome.adId, reused: outcome.reused, pastedAt: outcome.pastedAt, card: built.card };
    });

    app.get("/onboarding/jobs/:adId", { schema: { params: Params } }, async (req, reply) => {
      const session = requireSession(req);
      const posting = await pastedPostingFor(session, req.params.adId);
      if (!posting) return reply.status(404).send(UNKNOWN_CARD);
      const built = await cardFor(session, posting);
      if ("refusal" in built) return reply.status(409).send({ error: CARD_REFUSALS[built.refusal] });
      return { card: built.card };
    });
  };
}

const UNKNOWN_CARD = { error: { code: "unknown_card", message: "no such job" } };

type CardRefusal = "withdrawn" | "read_incomplete";
type CardOutcome = { card: JobCard } | { refusal: CardRefusal };

// 409, not 404: the job exists and is stored. What is refused is the card, and the two reasons are
// different things to be told. #304 renders `read_incomplete` as the full failure screen that keeps
// his text; #305 removes `withdrawn` outright — a job he brought is never withdrawn, it stays and
// says why.
const CARD_REFUSALS: Record<CardRefusal, { code: CardRefusal; message: string }> = {
  withdrawn: {
    code: "withdrawn",
    message: "this job asks for something you have told us you do not have",
  },
  read_incomplete: {
    code: "read_incomplete",
    message:
      "we have not finished reading this advert yet — press Read it again in a moment, and if it keeps failing, paste more of the advert",
  },
};
