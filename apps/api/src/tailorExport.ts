// #313 — approving is sending. One press: the server checks the conservation lint and this
// person's approval, prints the two-page PDF through the injected document maker (#312's seam)
// and emails it to him. The gate lives here, server-side (repo rule: no export route may exist
// for unverified content); the route only turns the request into these calls. The slow part —
// nearly every press is a ~33s cold start of the browser — runs detached and narrated over the
// same job/progress stream every other wait uses, because silence is the failure mode to avoid.
// The wait ends when the document is made and the mail is away — what we control — never when
// the email lands, which we don't.
import { conservationIssues, type Posting } from "./preview.js";
import type { DocumentMaker } from "./documentMaker.js";
import type { JobStore } from "./jobs.js";
import type { Mailer } from "./mailer.js";
import type { TailorDraftRecord } from "./tailorDraftStore.js";
import type { DraftInputs } from "./tailorDraft.js";

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
}

export interface TailorExportInput {
  /** The rendered document — tailorDraftView's html, stored contact applied. */
  html: string;
  /** Ship-and-tell: the draft's conservation notices travel into the email (spec #301). */
  notices: string[];
  posting: Posting;
  /** The signed-in account's address — the email goes to HIM, never to an employer. */
  email: string;
}

/** The email body. #315 grows this into the five-section application report; until then it is the
 *  attachment, named plainly, with the ship-and-tell notices when the draft shipped lossy. */
export function exportEmailText(input: TailorExportInput, pages: number): string {
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
 * over `GET /jobs/:id/events`, never left `running` for ever. Two narrated steps — printing (the
 * cold-start wait lives here) and sending — then completed the moment the mail is away.
 */
export async function runTailorExportJob(
  deps: TailorExportJobDeps,
  jobId: string,
  input: TailorExportInput,
): Promise<void> {
  // The three narrated states the screen renders from — typed so a misspelled step cannot ship.
  const push = (step: "printing" | "sending" | "sent", patch?: Record<string, unknown>) =>
    deps.jobs.update(jobId, { progress: { tailorExport: { step, ...patch } } });
  try {
    await deps.jobs.update(jobId, { status: "running" });
    await push("printing");
    const printed = await deps.documentMaker.printCv(input.html);
    await push("sending", { pages: printed.pages });
    await deps.mailer.sendTailoredCv(input.email, {
      subject: `Your CV for ${input.posting.title} at ${input.posting.company}`,
      text: exportEmailText(input, printed.pages),
      // Title into a safe filename — a pasted advert's title is free text.
      filename: `CV - ${input.posting.title.replace(/[\\/:*?"<>|]/g, " ").trim()}.pdf`,
      pdf: printed.pdf,
    });
    await deps.jobs.update(jobId, {
      status: "completed",
      progress: { tailorExport: { step: "sent", pages: printed.pages, email: input.email } },
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
