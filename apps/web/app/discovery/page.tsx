// #16 PLACEHOLDER — ticket #16 (discovery) replaces this page entirely. This stub exists only so
// the front door's (#15) navigation lands somewhere real instead of a 404.
//
// Both front-door paths arrive here: Ready? pushes "/discovery"; the CV shortcut pushes
// "/discovery?job=<jobId>" — the param is accepted (Next.js just won't 404 on it) and otherwise
// ignored until #16 reads it.
//
// Dark full-bleed background is load-bearing, not decorative: the front door's door-parting
// (frontdoor.css §7) ends mid-navigation, and the app shell's default background (--jc-bg) is
// light, so without this the parting would flash into a light page for a frame. No "use client":
// nothing here is interactive, so the default server component is the simpler, correct choice.
export default function DiscoveryPlaceholder() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#101419",
        color: "#7f8b98",
        fontFamily:
          '"Segoe UI Variable Text", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      Loading your questions…
    </div>
  );
}
