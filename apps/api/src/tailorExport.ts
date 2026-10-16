// #313 — approving is sending. One press: the server checks the conservation lint and this
// person's approval, prints the two-page PDF through the injected document maker (#312's seam)
// and emails it to him. The gate lives here, server-side (repo rule: no export route may exist
// for unverified content); the route only turns the request into these calls. The slow part —
// nearly every press is a ~33s cold start of the browser — runs detached and narrated over the
// same job/progress stream every other wait uses, because silence is the failure mode to avoid.
// The wait ends when the document is made and the mail is away — what we control — never when
// the email lands, which we don't.
//
// #314 — the two-page rule, measured from our own PDF (documentMaker.ts counts the bytes). Over
// two pages ⇒ ONE re-tailor on a real tighter budget — a number carried into the draft input
// (buildTailorInput's PAGE-BUDGET block), never prose asking the model to be brief — then the
// document ships anyway and he is told plainly, on the screen and in the email both. Never a hard
// failure that leaves him with nothing.
import {
  conservationIssues,
  tailorDraft,
  type BulletBudget,
  type Draft,
  type Posting,
  type StoredContact,
} from "./preview.js";
import type { DocumentMaker } from "./documentMaker.js";
import type { JobStore } from "./jobs.js";
import type { LlmClient } from "./llm.js";
import type { Mailer } from "./mailer.js";
import type { TailorDraftRecord, TailorDraftStore } from "./tailorDraftStore.js";
import { tailorDraftView, type DraftInputs } from "./tailorDraft.js";

export interface ExportRefusal {
  status: 404 | 409;
  code: string;
  message: string;
}

/**
 * The server-side gate, pure so it is directly testable: a draft may be exported only when it is
 * the draft for the CURRENT facts, it carries this person's approval, and the conservation lint
 * re-run on the stored document raises nothing fatal.
 *
 * On the lint: a FATAL finding (a denied capability stated on the page, #311) refuses outright —
 * that page must not exist, let alone reach an employer. Non-fatal losses follow the ship-and-tell
 * doctrine the draft already shipped under (#290 ruling 5): the document leaves WITH its
 * plain-words notices, in the email as well as on the screen, never silently.
 *
 * `approvedDraftedAt` is the press itself: the client names the draftedAt of the document on his
 * screen, so approval provably belongs to THIS draft — a press naming a draft that has since been
 * replaced approves nothing, and is refused rather than sending a document he never saw.
 */
export function exportGate(
  stored: TailorDraftRecord | null,
  inputs: DraftInputs,
  approvedDraftedAt: string,
): ExportRefusal | null {
  if (!stored || stored.inputFingerprint !== inputs.fingerprint)
    return { status: 404, code: "no_draft", message: "no draft for this job's current facts" };
  if (approvedDraftedAt !== stored.draftedAt)
    return {
      status: 409,
      code: "not_approved",
      message: "this draft does not carry your approval — approve the draft on your screen",
    };
  return conservationGate(stored, inputs);
}

/** The lint half of exportGate, on its own: the stored document re-checked against the inputs it
 *  was built from. #390's Preview as CV downloads through this gate too — a preview has no
 *  approval press, but a page stating a denial must no more reach a printer than an employer. */
export function conservationGate(stored: TailorDraftRecord, inputs: DraftInputs): ExportRefusal | null {
  const fatal = conservationIssues(
    inputs.claimsDoc,
    stored.draft,
    inputs.opts.jobBlocks,
    inputs.opts.advertTests,
    inputs.opts.negatives,
  ).filter((issue) => issue.fatal);
  if (fatal.length > 0)
    return {
      status: 409,
      code: "lint_failed",
      message: "this draft failed the conservation check and cannot be emailed — redraft it",
    };
  return null;
}

/** Free text (an advert's title, the person's name) into a safe filename. */
export const safeFilename = (text: string) => text.replace(/[\\/:*?"<>|]/g, " ").trim();

/** One plain-words failure, job-record shaped like the draft door's (tailorDraft.ts): what came
 *  back, and the one thing he can act on. Pressing again re-spends no model call — the draft and
 *  his approval are both checkpointed. */
export const EXPORT_FAILURE = {
  cameBack: "We could not make and send this CV.",
  fix: "Press the button again — your draft and your approval are saved, and no rewriting is re-done.",
};

export interface TailorExportJobDeps {
  jobs: JobStore;
  documentMaker: DocumentMaker;
  mailer: Mailer;
  /** #314: the re-tailor's model. Absent (no model wired) ⇒ no tightening; the measured document
   *  ships with its notice rather than failing. */
  tailorLlm?: LlmClient;
  tailorDrafts: TailorDraftStore;
}

export interface TailorExportInput {
  sessionId: string;
  /** The approved record — the document he pressed on, approvedAt already stamped. */
  record: TailorDraftRecord;
  inputs: DraftInputs;
  posting: Posting;
  /** The stored, corrected phone/email, applied at render time (tailorDraftView's rule). */
  contact: StoredContact;
  /** The signed-in account's address — the email goes to HIM, never to an employer. */
  email: string;
}

export const PAGE_LIMIT = 2;

/** #314: the tighter budget, a number. The printed experience-bullet count scaled to the two pages
 *  the measurement says it overran — 30 bullets over 3 pages → 20. Over the limit the ratio is
 *  below one, so the cap is always strictly fewer than what printed. */
export function tightenedBulletBudget(draft: Draft, measuredPages: number): BulletBudget {
  const printedBullets = draft.experience.reduce((n, e) => n + e.bullets.length, 0);
  return { max: Math.floor((printedBullets * PAGE_LIMIT) / measuredPages), printedBullets, measuredPages };
}

/** The ship-and-tell words for the page rule — one sentence per outcome, in the email and on the
 *  screen both. Plural throughout: every count here is over two. */
export const PAGE_NOTICES = {
  tightened: (pages: number) =>
    `Your approved draft ran to ${pages} pages, so we shortened it to fit two. ` +
    `The CV attached is shorter than the draft you approved: read it before you send it.`,
  stillOver: (pages: number, after: number) =>
    `Your approved draft ran to ${pages} pages. We shortened it once and it still runs to ${after} pages, ` +
    `so it is not word for word the draft you approved. Trim it yourself before you send it.`,
  notTightened: (pages: number) =>
    `Your CV runs to ${pages} pages, over the two-page limit, and we could not shorten it. ` +
    `Trim it yourself before you send it.`,
};

/** The one re-tailor, on the budget. null when no model is wired or the model failed twice — the
 *  caller then ships what was measured, with its notice. The record keeps its draftedAt and
 *  approvedAt: this is the document his press produced, not a new draft awaiting a new press. */
async function tightenOnce(
  deps: TailorExportJobDeps,
  input: TailorExportInput,
  measuredPages: number,
): Promise<TailorDraftRecord | null> {
  if (!deps.tailorLlm) return null;
  try {
    const { draft, conservationNotices } = await tailorDraft(
      input.inputs.claimsDoc,
      input.posting,
      deps.tailorLlm,
      input.inputs.headerText,
      { ...input.inputs.opts, bulletBudget: tightenedBulletBudget(input.record.draft, measuredPages) },
    );
    return { ...input.record, draft, conservationNotices };
  } catch (err) {
    console.warn(`[ops] tighten-once failed, shipping as measured: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The email body. #315 grows this into the five-section application report; until then it is the
 *  attachment, named plainly, with the ship-and-tell notices when the draft shipped lossy. */
export function exportEmailText(
  input: { posting: Posting; notices: string[] },
  pages: number,
): string {
  const notices =
    input.notices.length > 0
      ? `\n\nBefore you send it, check this:\n${input.notices.map((n) => `- ${n}`).join("\n")}`
      : "";
  return (
    `Your CV for ${input.posting.title} at ${input.posting.company} is attached ` +
    `(${pages} page${pages === 1 ? "" : "s"}, PDF). Read it, then send it yourself when you are ready.` +
    notices
  );
}

/**
 * The detached press (runTailorDraftJob's shape): narrated into the job record the screen watches
 * over `GET /jobs/:id/events`, never left `running` for ever. Narrated steps — printing (the
 * cold-start wait lives here), tightening only when the page count demands it (#314), and
 * sending — then completed the moment the mail is away.
 */
export async function runTailorExportJob(
  deps: TailorExportJobDeps,
  jobId: string,
  input: TailorExportInput,
): Promise<void> {
  // The narrated states the screen renders from — typed so a misspelled step cannot ship.
  const push = (step: "printing" | "tightening" | "sending" | "sent", patch?: Record<string, unknown>) =>
    deps.jobs.update(jobId, { progress: { tailorExport: { step, ...patch } } });
  // The approved document is not a draft: no watermark, no banner.
  const render = (record: TailorDraftRecord) =>
    tailorDraftView(record, input.inputs.claimsDoc, input.posting, input.contact, { watermark: false });
  try {
    await deps.jobs.update(jobId, { status: "running" });
    await push("printing");
    let record = input.record;
    let view = render(record);
    let printed = await deps.documentMaker.printCv(view.html);
    let notices = view.conservationNotices;
    if (printed.pages > PAGE_LIMIT) {
      const measured = printed.pages;
      await push("tightening", { pages: measured });
      const tightened = await tightenOnce(deps, input, measured);
      if (tightened) {
        // Checkpoint the model's output WITH its page sentence before the second print: a browser
        // failure here must neither cost the re-tailor again on the next press (repo rule: stages
        // checkpoint) nor let that press ship a shortened CV with no word about it (QA D1).
        record = {
          ...tightened,
          conservationNotices: [...tightened.conservationNotices, PAGE_NOTICES.tightened(measured)],
        };
        await deps.tailorDrafts.put(input.sessionId, input.posting.id, record);
        view = render(record);
        printed = await deps.documentMaker.printCv(view.html);
        notices =
          printed.pages > PAGE_LIMIT
            ? [...tightened.conservationNotices, PAGE_NOTICES.stillOver(measured, printed.pages)]
            : view.conservationNotices;
      } else notices = [...notices, PAGE_NOTICES.notTightened(measured)];
      // The document that left is the checkpoint: the screen's next read shows it with its
      // notice, and a second press re-prints it without a model call. Said once: a re-press after
      // a failed send carries the stored sentence in, and must not add it again (QA D2).
      notices = [...new Set(notices)];
      await deps.tailorDrafts.put(input.sessionId, input.posting.id, { ...record, conservationNotices: notices });
    }
    await push("sending", { pages: printed.pages });
    await deps.mailer.sendTailoredCv(input.email, {
      subject: `Your CV for ${input.posting.title} at ${input.posting.company}`,
      text: exportEmailText({ posting: input.posting, notices }, printed.pages),
      // Title into a safe filename — a pasted advert's title is free text.
      filename: `CV - ${safeFilename(input.posting.title)}.pdf`,
      pdf: printed.pdf,
    });
    await deps.jobs.update(jobId, {
      status: "completed",
      progress: { tailorExport: { step: "sent", pages: printed.pages, email: input.email, notices } },
    });
  } catch (err) {
    console.error(`[ops] tailor export failed: ${err instanceof Error ? err.message : String(err)}`);
    await deps.jobs.update(jobId, {
      status: "failed",
      error: "export_failed",
      progress: { tailorExport: { failure: EXPORT_FAILURE } },
    });
  }
}
