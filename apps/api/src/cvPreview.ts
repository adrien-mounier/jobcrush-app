// #390 (ADR-0019) — Preview as CV: the master CV as it would print, tailored as though the person
// were applying for THEIR OWN job. The pure rules live here — which job is "their own", when the
// profile's door is held, and what the tailor is handed in place of a job ad — so the route
// (routes/cvPreview.ts) only turns requests into calls. The engine, the checkpoint store and the
// export gates are the tailored draft's own (tailorDraft.ts, tailorDraftStore.ts, tailorExport.ts):
// the preview is one more row in the same store, keyed by CV_PREVIEW_AD_ID instead of an advert.
import type { JobBlockView, MinedDate } from "@jobcrush/contracts";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
import { reviewOpensJobs } from "./postingRetrieval.js";
import type { Posting } from "./preview.js";
import type { SessionRecord } from "./sessions.js";

/** The tailorDrafts row this session's preview lives in — never a real advert's id. */
export const CV_PREVIEW_AD_ID = "cv-preview";

export const NO_JOB_LINE = "Your profile has no job yet.";
export const CHECK_MODE_OPEN_LINE = "Finish checking your CV first.";

const monthIndex = (d: MinedDate) => d.year * 12 + (d.month ?? 1);

/** ADR-0019 clause 1: the current job (no end date; of several, the one started latest), else the
 *  most recent by end date. A job whose end is unknown has no date to be recent by, so it counts
 *  after every known end and only wins when nothing dated remains. Only `job` records qualify —
 *  a degree or a personal project is not a job the person holds. */
export function ownJob(blocks: JobBlockView[]): JobBlockView | null {
  const jobs = blocks.filter((b) => b.kind === "job");
  const current = jobs.filter((b) => b.end.value.state === "ongoing");
  if (current.length > 0)
    return current.reduce((best, b) => (monthIndex(b.start.value) > monthIndex(best.start.value) ? b : best));
  const endedAt = (b: JobBlockView) => (b.end.value.state === "ended" ? monthIndex(b.end.value.date) : -1);
  return jobs.reduce<JobBlockView | null>((best, b) => (!best || endedAt(b) > endedAt(best) ? b : best), null);
}

export interface CvPreviewHold {
  code: "check_mode_open" | "no_job";
  /** The one line the screen prints — it never composes a reason itself. */
  message: string;
}

/** ADR-0019 clause 3: the door as held (why, in one line) or as open, with the person's own job
 *  found once for every door behind it. An unfinished check mode holds it first: until the person
 *  has checked the lines, there is no master CV to print. A session that brought no CV is never
 *  held by check mode (reviewOpensJobs). */
export function cvPreviewDoor(
  session: Pick<SessionRecord, "importProof" | "reviewCompletedAt">,
  blocks: JobBlockView[],
): { hold: CvPreviewHold; job?: undefined } | { hold: null; job: JobBlockView } {
  if (!reviewOpensJobs(session)) return { hold: { code: "check_mode_open", message: CHECK_MODE_OPEN_LINE } };
  const job = ownJob(blocks);
  return job ? { hold: null, job } : { hold: { code: "no_job", message: NO_JOB_LINE } };
}

export interface OwnJobTarget {
  posting: Posting;
  /** The job's family must-haves (the review's job placement, ADR-0019 clause 5) — the tailor's
   *  advert tests. Empty for a job placed in no family: tailored to its title alone. */
  mustHaves: string[];
}

/** The person's own job in the engine's job-ad shape. No ad, no market, no excerpt: the posting
 *  carries the job's own title and employer, and the requirements are the must-haves alone. */
export function ownJobTarget(
  block: JobBlockView,
  floors: Pick<ProductionFamilyFloorStore, "get" | "active">,
): OwnJobTarget {
  const placement = block.family.value;
  const families =
    placement?.outcome === "confirmed"
      ? placement.families.map(({ familyId, version }) => floors.get(familyId, version) ?? floors.active(familyId))
      : [];
  const floorsFound = families.flatMap((f) => (f ? [f.floor] : []));
  return {
    posting: {
      id: CV_PREVIEW_AD_ID,
      title: block.title.value,
      company: block.employer.value,
      location: "",
      keywords: [],
      excerpt: "",
      // ponytail: nothing stored says what language the CV is in — the tailor writes in the ad's
      // language, and the person's own job has no ad. detectLanguage (language.ts) over the CV's
      // claim text is the upgrade when a non-English CV reaches this door.
      language: "en",
    },
    mustHaves: floorsFound.flatMap((f) => f.essentialItems.map((item) => item.question.prompt)),
  };
}
