// #154 — the owner's own BRED role, as claims: a dense role with more to say than any draft can
// print at full length. Four facts carry a result; ten are duty-only.
//
// The duty-only ten are the point, not padding. They are the shape that turns "every merged line
// must state a result" into an invention trap: with no result in the source, a machine told to
// state one will write one. ADR-0012 clause 3 is what closes that trap (do not combine — choose),
// and it cannot be tested without sources that genuinely have no outcome to keep.
import { CandidateClaims } from "@jobcrush/contracts";

export const BRED_ROLE = "Card Services Manager - BRED";

export const BRED_OUTCOME_FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "bred-pin-rollout",
    "Led the PIN-code authentication rollout for retail cards, strengthening customer security.",
  ],
  [
    "bred-self-service",
    "Delivered self-service card activation, improving customer autonomy and reducing support workload.",
  ],
  [
    "bred-lao-forex",
    "Coordinated Lao Forex Exchange delivery, driving alignment between upstream APIs and customer-facing delivery.",
  ],
  ["bred-fraud-rules", "Rewrote the card fraud rules, cutting false declines by a fifth."],
];

export function bredClaims(): CandidateClaims {
  const claim = (id: string, text: string) => ({
    id,
    role: BRED_ROLE,
    text,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: text.slice(0, 90),
    needs_grill: false,
    grill_hint: null,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
  });
  const dutyOnly = Array.from({ length: 10 }, (_, i) =>
    claim(
      `bred-duty-${i + 1}`,
      `Managed card services workstream ${i + 1} across the retail portfolio.`,
    ),
  );
  return CandidateClaims.parse({
    schemaVersion: "1",
    roles: [
      {
        employer: "BRED",
        title: "Card Services Manager",
        dates_as_written: "Mar 2021 - Present",
        dates_missing: false,
      },
    ],
    claims: [...BRED_OUTCOME_FACTS.map(([id, text]) => claim(id, text)), ...dutyOnly],
    parser_flags: [],
  });
}

export const BRED_POSTING = {
  id: "live-154",
  title: "Card Services Lead",
  company: "ABA Bank",
  location: "Phnom Penh, Cambodia",
  excerpt:
    "Own the retail card portfolio end to end: authentication, activation, fraud rules and " +
    "forex delivery. You will coordinate upstream API teams and customer-facing delivery, and " +
    "be accountable for customer security and support load.",
};
