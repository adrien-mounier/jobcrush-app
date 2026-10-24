"use client";

// #423 (owner, 2026-10-24; the prototype on prototype/tailor-ad-in-full-412, variant E): "The job"
// tab of the Tailor draft screen — the job's full text in place of the CV, its line breaks kept.
// Each line a pending suggestion answers carries that suggestion's numeral (the number its card
// shows), and the open suggestion's line is lit. Which line a requirement answers is the server's
// (TailorRequirement.line); one with no line carries no numeral. Nothing here re-derives it.
import type { RefObject } from "react";
import type { ScoredJobCard, TailorRequirement } from "../../lib/api";
import type { StretchRailView } from "./stretch";

export interface TailorJobProps {
  card: ScoredJobCard;
  requirements: TailorRequirement[];
  view: StretchRailView;
  openId: string | null;
  onOpen: (id: string) => void;
  /** The lit line, so "See where the job asks this" can bring it into view. */
  litRef: RefObject<HTMLParagraphElement | null>;
}

export function TailorJob({ card, requirements, view, openId, onOpen, litRef }: TailorJobProps) {
  const pending = (view?.status === "ran" ? view.suggestions : [])
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => s.state === "pending");
  const lineOf = (requirementId: string) => requirements.find((r) => r.id === requirementId)?.line;
  const meta = [card.company, card.place].filter(Boolean).join(" · ");
  return (
    <div className="jobtext">
      <p className="jt-title">{card.title}</p>
      {meta && <p className="jt-meta">{meta}</p>}
      {/* Index keys: the job's text is fixed for the life of this screen — its lines never reorder. */}
      {card.adExcerpt.split("\n").map((text, i) => {
        const pins = pending.filter(({ s }) => lineOf(s.requirementId) === i);
        const lit = pins.find(({ s }) => s.id === openId);
        return (
          <p key={i} className={lit ? "jl hl" : "jl"} ref={lit ? litRef : undefined} tabIndex={lit ? -1 : undefined}>
            {pins.length > 0 && (
              <span className="pins">
                {pins.map(({ s, n }) => (
                  <button
                    key={s.id}
                    type="button"
                    className={s.id === openId ? "num" : "num idle"}
                    aria-label={`Suggestion ${n}`}
                    aria-current={s.id === openId ? "true" : undefined}
                    onClick={() => onOpen(s.id)}
                  >
                    {n}
                  </button>
                ))}
              </span>
            )}
            {lit && <span className="sr-only">Suggestion {lit.n} answers this: </span>}
            {text}
          </p>
        );
      })}
    </div>
  );
}
