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
import type { EmployerLookup } from "../employerLookup.js";
import type { JobStatus, JobStore } from "../jobs.js";
import {
  advertFamilyIdFor,
  buildDeckCards,
  resolveAdRequirements,
  resolveSessionYears,
  type JobCard,
} from "../deck.js";
import { readingLanguages } from "../language.js";
import { eligiblePostings, type Posting } from "../preview.js";
import {
  addPastedApplicationUrl,
  isWebLink,
  MAX_ADVERT_CHARS,
  pasteAdvert,
  type PasteAdvertDeps,
  type PasteAdvertRefusal,
} from "../pastedAdvert.js";
import { makeBroughtJobs, type BroughtJob } from "../broughtJobs.js";

export interface PasteDeps extends PasteAdvertDeps {
  claims: ClaimStore;
  eligibility: EligibilityStore;
  jobBlocks: JobBlockStore;
  /** #304: the job/progress store the front door's CV read already narrates over. The paste door
   *  narrates over the SAME one rather than a channel of its own — same record, same SSE route
   *  (`GET /jobs/:id/events`), same session scoping. */
  jobs: JobStore;
  /** #304, the "looking up the employer" step, and it is a real lookup rather than a label on a
   *  pause: employerLookup.ts is cache-first and keyed on a normalised company name, so a company
   *  is paid for once ever and every later paste of any advert from that employer is free. Absent
   *  (no Anthropic key — main.ts's own condition) → the step still runs and completes, saying
   *  nothing, exactly as the industry labeler behaves without it. */
  employerLookup?: EmployerLookup;
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

/** #306 — what the apply row's own control sends. The same shape and the same guard the paste door
 *  applies to the link beside the advert, because it is the same field being written: only a real web
 *  address is ever stored, since this value is printed at the top of the application email and
 *  rendered as an anchor. Never nullable — this endpoint ADDS a link, and "" would be a way to clear
 *  one nobody offered to clear. */
const LinkBody = z.object({
  applicationUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(isWebLink, { message: "the application link must start with http:// or https://" }),
});

/** #304 — the three named steps, in the order they run. The names are the spec's own words and they
 *  are honest: each one is a thing the server really does, and none of them is on screen before the
 *  work behind it has started. */
//  The web has its own copy of these three ids and their labels (apps/web/app/paste/page.tsx),
//  because the LABELS are copy and belong on the screen while the ORDER is this file's. The two
//  are not guarded by a unit test and deliberately so: what a mismatch would produce is a screen
//  that marks the wrong step as in progress, which only a rendered screen can see —
//  apps/web/e2e/paste-wait-journey.mjs reads the order off the live DOM and goes red on it.
const PASTE_STEPS = ["reading", "employer", "profile"] as const;
export type PasteStep = (typeof PASTE_STEPS)[number];

export type PasteFailureCode = PasteAdvertRefusal | CardRefusal | "error";

/** What the screen is told when a paste produces no job. Two lines, never one: **what came back**
 *  is the honest report, and **what usually fixes it** is the only part he can act on — a failure
 *  message with no second line is a dead end dressed up as an explanation (#304).
 *
 *  Written as whole sentences rather than clause fragments, because this text is now a full screen
 *  rather than the tail of "We could not read that: …". */
const PASTE_FAILURES: Record<PasteFailureCode, { cameBack: string; fix: string }> = {
  too_short: {
    cameBack: "There was not enough text there to read as a job advert.",
    fix: "Paste the whole advert — the title, the employer, what the job is and what it asks for. A heading on its own gives us nothing to read.",
  },
  unsupported_language: {
    cameBack: "That advert is not in English, and English is the only language we can read at the moment.",
    fix: "If the employer also published the advert in English, paste that version instead.",
  },
  unreadable: {
    cameBack: "We could not find a job title, an employer and a place in that text.",
    fix: "Paste the advert itself rather than the page around it — a cookie notice, a menu or a list of other jobs leaves us nothing to read.",
  },
  reader_unavailable: {
    cameBack: "Reading a pasted advert is switched off on this deployment.",
    fix: "There is nothing to fix from your side — this one is ours.",
  },
  // The ticket's own case: the advert read fine as a job, and nothing came out of it that a card
  // could be built from. It is NOT a dead end — the advert is already stored and the reading
  // self-heals into the cache when it lands, so pressing again costs nothing.
  read_incomplete: {
    cameBack: "We read the title, the employer and the place, but no requirements came out of the advert.",
    fix: "Press Read it again in a moment — the advert is already saved, so a second press costs nothing. If it keeps coming back empty, paste more of the advert.",
  },
  error: {
    cameBack: "Something went wrong on our side while we were reading it.",
    fix: "Press Read it again — your text is still here, and nothing was lost.",
  },
};

/** What the paste screen watches, carried in the job record's `progress.paste`. One object,
 *  rewritten whole on every update: the job store merges `progress` one level deep only, so a
 *  partial patch here would silently drop whatever it did not name. */
export interface PasteProgress {
  step: PasteStep;
  /** The advert's requirements, in the advert's own words, published the moment they are read and
   *  BEFORE anything is scored (#304: nothing is scored on screen before it is read). */
  requirements: string[];
  /** What the employer lookup said about the company, or null when it had nothing / is not wired. */
  employer: string | null;
  result?: { adId: string; reused: boolean; pastedAt: string; card: JobCard };
  failure?: { code: PasteFailureCode; cameBack: string; fix: string };
}


export function pasteRoutes(deps: PasteDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    /** The one card for one advert, assembled by the deck's own pass over a single posting — the
     *  same reader, scorer and checkpoints every other card gets (#290 ruling 1), rather than a
     *  second card-shaping path that could drift from the deck's. That is also how the ageing line
     *  reaches this screen: the card is built by the same pass, from the same `brought` record, so the
     *  job's own screen and its deck card cannot say different things about its age (#305).
     *
     *  `deckFamilyId` is null, not this session's family: family-fit DELETION is a property of a
     *  DECK — is this advert worth a slot in a list she is browsing — and she is looking at one job
     *  she asked for by name. #305 makes a brought job skip that deletion on the deck too, so the two
     *  surfaces now agree by rule rather than by coincidence. The years scope for a brought job is
     *  the advert's OWN family (#309 AC5, advertYearsFamilyId inside buildDeckCards) on both
     *  surfaces, so the number here is still the number the deck would show.
     *
     *  #305: there is no `withdrawn` outcome any more. A job he brought is never withdrawn (#294 c1) —
     *  `brought` is passed to the deck pass, which holds it out of the withdrawal filter, so the only
     *  way this returns no card is a reading we could not finish. */
    const cardFor = async (session: SessionRecord, brought: BroughtJob): Promise<CardOutcome> => {
      const [confirmed, negatives, facts, blocks] = await Promise.all([
        deps.claims.confirmed(session.id),
        deps.claims.negatives(session.id),
        deps.eligibility.list(session.id),
        deps.jobBlocks.list(session.id),
      ]);
      const years = resolveSessionYears(facts, blocks, await advertFamilyIdFor(session, deps.placeFamily));
      const langs = readingLanguages(session);
      const { cards } = await buildDeckCards(
        eligiblePostings(langs, [brought.posting]),
        { confirmed, negatives, facts, blocks, years, deckFamilyId: null, langs, brought: [brought] },
        deps,
      );
      // No card left means we did not finish READING the advert — the requirements read timed out or
      // came back unusable — which on a slow first read is common and is fixed by pressing again (the
      // read is checkpointed, so the retry is instant and free).
      return cards[0] ? { card: cards[0] } : { refusal: "read_incomplete" };
    };

    /** The advert behind an adId, for THIS person — scoped by her own paste records, never by the
     *  id alone. The reading is shared (#294 ruling 1); being allowed to open the screen is a
     *  different question, and `adId` is a hash of (company, location, title), which anyone who has
     *  seen the job can compute. The card carries `adExcerpt`, which for a pasted advert is the
     *  whole pasted text — #294 clause 10 names what that text can contain — so an unscoped lookup
     *  here would hand one person's paste to anyone who guessed the three fields.
     *
     *  #305: this is now the SAME resolver the deck stitches from (broughtJobs.ts), which is what
     *  keeps the two surfaces honest — the ageing line the job's own screen shows is the line its deck
     *  card shows, composed once, from the same paste record.
     *
     *  Pasted jobs only. A job the app FOUND has its own screen the day #306 needs one; nothing here
     *  lands anyone on it, and a second resolution path with no caller is a path nothing tests. */
    const brought = makeBroughtJobs(deps);
    const broughtJobFor = async (session: SessionRecord, adId: string): Promise<BroughtJob | undefined> =>
      (await brought(session.id)).find((job) => job.posting.id === adId);

    /** #304 — the whole read, narrated. Runs detached from the request that started it and reports
     *  only into the job record, which is why the three steps can be watched at all: a synchronous
     *  route can say one thing, once, when it is already over.
     *
     *  The order is the product's, not the engine's convenience. The requirements are resolved on
     *  their own and PUBLISHED before the card pass runs, so what he sees first is the advert read
     *  back to him, and the score arrives after it — never before (#304: nothing is scored on
     *  screen before it is read). buildDeckCards then resolves the same requirements again, which
     *  is free: the real reader (adReader.ts) persists every read and answers the second call from
     *  its store. */
    const runPaste = async (session: SessionRecord, jobId: string, body: z.infer<typeof Body>) => {
      const state: PasteProgress = { step: "reading", requirements: [], employer: null };
      const push = (patch?: { status?: JobStatus; error?: string }) =>
        deps.jobs.update(jobId, { ...patch, progress: { paste: { ...state } } });
      const fail = (code: PasteFailureCode) => {
        state.failure = { code, ...PASTE_FAILURES[code] };
        return push({ status: "failed", error: code });
      };

      await push({ status: "running" });
      try {
        const outcome = await pasteAdvert(deps, {
          sessionId: session.id,
          text: body.text,
          applicationUrl: body.applicationUrl ?? null,
        });
        if (!outcome.ok) return void (await fail(outcome.reason));

        const adReq = await resolveAdRequirements(outcome.posting.id, deps.readAd, outcome.posting);
        // #301 amends #86 here, and this is the line where it happens: for a FETCHED advert "no
        // requirements" means no card and retry on the next refresh, and for a PASTED one that is
        // silence about something he did deliberately. It gets the failure screen instead.
        if (!adReq) return void (await fail("read_incomplete"));
        state.requirements = adReq.requirements.map((requirement) => requirement.requirement);
        await push();

        state.step = "employer";
        await push();
        // ONE lookup, and it is cache-first (employerLookup.ts): a company is looked up once ever,
        // shared by everyone, so this step is free for every employer anybody has pasted before.
        // Never throws — makeEmployerLookup turns every failure into null — so a dead lookup slows
        // the read and cannot break it.
        state.employer = deps.employerLookup ? await deps.employerLookup(outcome.posting.company) : null;

        state.step = "profile";
        await push();
        // Read back rather than shaped from `outcome`: the ageing line has to come off the stored paste
        // record, and a SECOND paste of an advert he brought a fortnight ago carries that fortnight
        // (first-write-wins), so the card he lands on already ages. Missing is structurally impossible
        // — pasteAdvert wrote both rows a moment ago — so it is reported as our failure, not his.
        const job = await broughtJobFor(session, outcome.adId);
        if (!job) return void (await fail("error"));
        const built = await cardFor(session, job);
        // The advert is stored whatever happens here, so nothing is lost and a retry re-spends
        // nothing; what he is told is why he is not being shown a card.
        if ("refusal" in built) return void (await fail(built.refusal));
        // He asked for this job, so he goes to the job — never back to the deck (#291 ruling 2).
        // The card travels with the id so the screen he lands on renders without a second trip.
        state.result = {
          adId: outcome.adId,
          reused: outcome.reused,
          pastedAt: outcome.pastedAt,
          card: built.card,
        };
        await push({ status: "completed" });
      } catch (err) {
        // Nothing above is allowed to leave the job `running` for ever: the screen watching it has
        // no other way to stop waiting, and a spinner with no end is the worst of the outcomes.
        console.error(`[ops] paste read failed: ${err instanceof Error ? err.message : String(err)}`);
        await fail("error");
      }
    };

    /** 202 and a job id, never the card: the card is the END of a read that takes seconds, and the
     *  whole point of this ticket is that those seconds are watched rather than waited out. The
     *  screen opens `GET /jobs/:jobId/events` — the same SSE stream the front door's CV read uses,
     *  session-scoped by that route's own `canSee`. */
    app.post("/onboarding/paste", { schema: { body: Body } }, async (req, reply) => {
      const session = requireSession(req);
      const job = await deps.jobs.create("paste-advert", session.id);
      void runPaste(session, job.id, req.body);
      return reply.status(202).send({ jobId: job.id });
    });

    /** #306 — he adds the link himself, on the job's own screen, when the advert he pasted carried
     *  none. This is the endpoint behind the apply row's empty state, and it is the ONLY way a link
     *  reaches an advert after its first paste: #294 clause 9 refused a silent backfill on a second
     *  paste and named this control as the remedy, so a second invisible writer of the same field is
     *  exactly what must not exist.
     *
     *  Scoped to the adverts HE brought, like the screen itself: the reading is shared, but being
     *  allowed to write to a shared record is a different question from being allowed to read it, and
     *  an unscoped write here would let anyone who can guess an adId put a link of their choosing in
     *  front of the people who pasted that job.
     *
     *  409, not a silent success, when the record already has a link: the control is only offered on
     *  a job with none, so arriving here anyway means somebody else got there first — and the honest
     *  answer is to say so and show what they gave, never to replace it. */
    app.put(
      "/onboarding/jobs/:adId/application-link",
      { schema: { params: Params, body: LinkBody } },
      async (req, reply) => {
        const session = requireSession(req);
        const job = await broughtJobFor(session, req.params.adId);
        if (!job) return reply.status(404).send(UNKNOWN_CARD);
        if (job.applicationUrl) {
          return reply.status(409).send({ error: LINK_ALREADY_SET, applicationUrl: job.applicationUrl });
        }
        const written = await addPastedApplicationUrl(deps.postings, req.params.adId, req.body.applicationUrl);
        if (!written) return reply.status(409).send({ error: LINK_ALREADY_SET });
        return { applicationUrl: req.body.applicationUrl };
      },
    );

    app.get("/onboarding/jobs/:adId", { schema: { params: Params } }, async (req, reply) => {
      const session = requireSession(req);
      const job = await broughtJobFor(session, req.params.adId);
      if (!job) return reply.status(404).send(UNKNOWN_CARD);
      const built = await cardFor(session, job);
      if ("refusal" in built) return reply.status(409).send({ error: CARD_REFUSALS[built.refusal] });
      return { card: built.card };
    });
  };
}

const UNKNOWN_CARD = { error: { code: "unknown_card", message: "no such job" } };

// #306: the first link wins (pastedAdvert.ts's addPastedApplicationUrl), so a race with another person
// who pasted the same advert ends here rather than in a silent overwrite.
const LINK_ALREADY_SET = {
  code: "link_already_set",
  message: "This job already has an application link.",
};

// #305 removed `withdrawn` from this union: a job he brought is never withdrawn (#294 c1), so the one
// way a stored advert yields no card is a reading we could not finish.
type CardRefusal = "read_incomplete";
type CardOutcome = { card: JobCard } | { refusal: CardRefusal };

// 409, not 404: the job exists and is stored. What is refused is the card. #304 renders
// `read_incomplete` as the full failure screen that keeps his text.
const CARD_REFUSALS: Record<CardRefusal, { code: CardRefusal; message: string }> = {
  read_incomplete: refusalFor("read_incomplete"),
};

/** One wording, two shapes. The paste screen reads the two lines separately (it has room for a
 *  heading and a remedy); this route has one `message` field and joins them, so the words a person
 *  is shown cannot drift apart depending on which door asked. */
function refusalFor(code: CardRefusal): { code: CardRefusal; message: string } {
  return { code, message: `${PASTE_FAILURES[code].cameBack} ${PASTE_FAILURES[code].fix}` };
}
