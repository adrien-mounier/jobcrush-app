// Design tokens shared by web and mobile. Real design work starts with JC-14 (S1);
// these seed values exist so both clients import from one place from day one.
export const tokens = {
  color: {
    // evidence-badge palette (spec §5 table) — plain-language classes, no jargon in UI
    verified: "#1a7f37", // "From your CV"
    derived: "#0969da", // "Reworded"
    partial: "#9a6700", // "Close match — needs your OK"
    suggested: "#8250df", // "Suggested — only if you approve"
    negative: "#57606a", // "Won't claim"
    danger: "#cf222e",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
  radius: { card: 12, pill: 999 },
} as const;
