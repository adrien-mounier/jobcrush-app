// #163 — the job-record VIEW shapes, defined once and shared by the API (producer:
// apps/api/src/jobBlockStore.ts) and the web client (consumer: apps/web/lib/api.ts), which
// previously hand-mirrored them. Type-only on purpose: these are views DERIVED from the frozen
// MinedJobBlock contract (jobBlock.ts), not a wire contract with an .mjs oracle. Precedent:
// jobCard.ts (85c0b19) — the contract owns the shape, the API composes it, the web re-exports
// type-only, and drift fails typecheck instead of rendering undefined.
import type { FamilyPlacement } from "./familyPlacement.js";
import type { Kind, MinedDate, MinedEndValue, MinedJobBlock } from "./jobBlock.js";

export type MatchState = "new" | "matched" | "ambiguous";

export type DecisionOrigin =
  | { kind: "read"; source_quote: string }
  // #221 — a decision the machine WORKED OUT rather than read: it quotes no source words, because
  // no CV says "this is IT project delivery". Distinct from "read" so the screen never has to
  // invent a quote for it, and from "corrected" so a person's pick still supersedes visibly.
  | { kind: "worked_out" }
  | { kind: "corrected"; supersededValue: unknown };

export type DecisionKey = "employer" | "title" | "start" | "end" | "kind" | "family";

/** One atomic machine decision, addressable by a stable id a correction can target. The value is
 *  typed per key (a corrected value is validated against the same per-key shape at the correction
 *  door, so the view can promise it). */
export interface DecisionView<T = unknown> {
  id: string; // `${blockId}:${decisionKey}`
  value: T;
  origin: DecisionOrigin;
  machine_touch: MinedJobBlock["employer"]["machine_touch"] | null; // null once a person has corrected it
  classification: MinedJobBlock["employer"]["classification"] | null;
}

export interface JobBlockView {
  id: string;
  kind: Kind;
  countsTowardExperience: boolean; // derived, never stored as its own answer
  employer: DecisionView<string>;
  title: DecisionView<string>;
  start: DecisionView<MinedDate>;
  end: DecisionView<MinedEndValue>;
  kindDecision: DecisionView<Kind>;
  /** #221 — the sixth correctable fact: which job family this block's work belongs to. `null` until
   *  the labeler has answered for this block (never run yet, or its call failed): a null reads as
   *  UNMAPPED everywhere a number is worked out, and as "we couldn't place this" on the screen. The
   *  null is kept rather than collapsed to an unmapped placement so the pipeline can tell a call it
   *  has already made from one it has not — that distinction is the labeling step's checkpoint. */
  family: DecisionView<FamilyPlacement | null>;
  confirmed: boolean;
  matchState: MatchState;
  /** Populated only when matchState === "ambiguous" — the existing block ids this one might be the
   *  same job as. The person resolves explicitly; empty otherwise. */
  candidateBlockIds: string[];
}

/** The negative test's three-way state: never run at all, ran and found N (0 is a real fact, not a
 *  failure), or ran and FAILED — distinct from found-none so a genuine zero is never confused with
 *  a read the miner could not complete. */
export type ReadStatus = { status: "not_run" } | { status: "ok"; blocksFound: number } | { status: "failed" };

export interface DeckSummary {
  totalBlocks: number;
  confirmedBlocks: number;
  read: ReadStatus;
}

/** #163 / ADR-0002 clause 3 — a confirmed sentence a correction contradicts, held aside (never
 *  rewritten) with a precise question. Returned by POST /job-blocks/:id/correct. */
export interface HeldSentence {
  id: string;
  text: string;
  question: string;
}
