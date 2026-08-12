# Desktop responsive fix — HUD centring (issue #48)

Render-bug fix, NOT a desktop redesign. Centre the existing phone-style HUD in one
fixed-width content column on desktop; keep the dark HUD background filling the whole
viewport behind it. Mobile (≤ 640px) unchanged. CSS-only — no JSX restructuring.

## 1. Shared column + breakpoint

- **Column width:** `--jc-desk-col: 560px` (one shared value, all four screens).
  - Why 560: the HUD content is designed for ~360–414px phones; 560 gives the CV paper
    and swipe card a comfortable desktop width without reading as stretched, and stays
    narrower than the 640px non-HUD `main` column so the HUD keeps its own denser
    column language. 600px is a fine alternative; 640px is rejected because at the
    641px breakpoint it leaves ~0.5px gutters — no visible "centred column on dark"
    effect just above the break.
- **Breakpoint:** `@media (min-width: 641px)` — matches AC4 exactly (phone ≤ 640px
  unchanged; 641px+ gets the column).
- **Define the token once**, in `apps/web/app/globals.css`, on `:root`, inside the
  desktop media block (layout token, not a visual colour token — the per-screen
  no-leak-to-:root discipline is about HUD colours, not a shared layout width):
  ```css
  @media (min-width: 641px) {
    :root { --jc-desk-col: 560px; }
  }
  ```
  This guarantees AC3 (one shared max-width) by construction.

## 2. Per-screen root behaviour

Every HUD root keeps `position: fixed; inset: 0; z-index: 100` and its dark
`background`. **Do not cap any root's width** — capping the root is the front-door bug.
Constrain *content children* instead.

### 2a. Front door — `apps/web/app/frontdoor.css`

Root is `<main class="frontdoor">`, so the global `main { max-width: 640px; margin: 0
auto; padding: var(--jc-sp-xl) var(--jc-sp-md) }` (globals.css:17-21) caps the dark
layer → phone rectangle. Override on desktop only:

```css
@media (min-width: 641px) {
  /* Root fills the viewport again (class beats `main` type specificity). */
  .frontdoor {
    max-width: none;
    margin: 0;
    padding: 0;              /* absolute children fill edge-to-edge; constrain below */
  }
  /* .invite and .footnote are position:absolute; inset:0 — add max-width + auto
     margins to turn each into a centred column. place-items/text-align keep working. */
  .frontdoor .invite {
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
  .frontdoor .footnote {
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
}
```

No change to `.stack`, `.h`, `.ready`, `.footnote` padding, or any state copy/timing.

### 2b. Discovery — `apps/web/app/discovery.css`

Root is `<div class="discovery">` — NOT subject to `main`, already fills viewport. No
root change. Constrain content children. Two patterns:

- **No-background children** (`.topbar`, `.countdown`, `.rail`, `.divider`, `.band-cv`,
  `.promise`): cap to the column with `max-width + margin-inline: auto`. Keep their
  existing 16px side padding / 14px inner padding as the in-column gutter.
- **The `.ask` dock** (`background: var(--hud-1); border-top`) — keep FULL-BLEED so the
  HUD reads as one continuous dark surface (no floating-band look). Centre its *content*
  with the inset-padding trick; the bg + border-top still span the viewport.

```css
@media (min-width: 641px) {
  .discovery .topbar,
  .discovery .countdown,
  .discovery .rail,
  .discovery .divider,
  .discovery .band-cv {
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
  /* .promise is a card (gradient bg + border + radius) — centre it as a card. */
  .discovery .promise {
    max-width: var(--jc-desk-col);
    margin-inline: auto;      /* overrides `margin: 0 16px 12px` side values */
  }
  /* .ask dock: full-bleed band, content centred in the column. */
  .discovery .ask {
    padding-inline: max(16px, calc((100% - var(--jc-desk-col)) / 2));
  }
}
```

`max()` keeps 16px on viewports < column+32px (so nothing tightens below the mobile
gutter). The `.band-cv` scroller stays `flex: 1 1 0` and is centred; `.cv` paper inside
sits column-width.

### 2c. Deck — `apps/web/app/deck.css`

Root `<div class="jobdeck">` — no root change. Same two patterns:

- No-bg children (`.topbar`, `.deckcount`, `.deck`) → cap to column.
- `.loadstate` (loading/error/empty/tailorhandoff) and `.loopback` → cap to column
  (place-items/justify-center keep working inside).
- `.curtain` (the reveal overlay, `bg rgba(9,12,16,0.9)` + backdrop-blur) → **leave
  full-bleed**. It is a momentary full-viewport darken, not a persistent band; its
  content (`.burst`, `.big`, `.go`, `.wall`) is already `place-items: center`-ed, so the
  headline reads centred on the full dark field. No change.
- `.wall` inside `.curtain` is already `max-width: 300px; margin: 22px auto 0` — no change.

```css
@media (min-width: 641px) {
  .jobdeck .topbar,
  .jobdeck .deckcount,
  .jobdeck .deck,
  .jobdeck .loadstate,
  .jobdeck .loopback {
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
  /* .curtain stays full-bleed (momentary overlay). .wall already self-centres. */
}
```

`.jobcard` inside `.deck` is `height: 100%` → fills the column-width `.deck`; the card
(bg + border + radius) reads as a centred phone-width card. `.jcfoot` is inside the card
— no separate rule.

### 2d. Tailor — `apps/web/app/tailor.css`

Root `<div class="jobdeck tailor">` — `.jobdeck` provides the full-viewport HUD; no root
change. Add to `tailor.css`:

```css
@media (min-width: 641px) {
  .tailor .topbar {            /* from .jobdeck scoping */
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
  .tailor .live-wrap {
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
  /* .ask dock: same full-bleed-with-centred-content pattern as discovery. */
  .tailor .ask {
    padding-inline: max(16px, calc((100% - var(--jc-desk-col)) / 2));
  }
  .tailor .loadstate {
    max-width: var(--jc-desk-col);
    margin-inline: auto;
  }
}
```

`.live-card` (bg + border + radius) and `.cv` paper inside `.live-wrap` sit
column-width, centred. `.exits` is inside `.ask` — covered by the dock's centred
padding.

## 3. Brand bar (`<header class="brandbar">` in layout.tsx)

- **Front door:** `.frontdoor` is `position: fixed; inset: 0; z-index: 100` → paints
  over the brand bar. After the fix the root still fills the viewport, so the brand bar
  stays hidden on desktop. **AC5 holds.** No change.
- **Discovery / deck / tailor:** each root is `position: fixed; inset: 0; z-index: 100`
  → already paints over the brand bar on every viewport. The desktop fix does not change
  root positioning, so the brand bar stays hidden on these screens too. **Recommendation:
  keep it hidden.** The brand bar resumes on the non-HUD routes (signup / import / paste
  / profile / preview) where `main { max-width: 640px }` applies and content is in normal
  flow. No conflict — this matches the existing design intent.

## 4. No horizontal scrollbar (AC6)

- Column `max-width + margin-inline: auto` cannot overflow: content ≤ 560px, viewport ≥
  641px → gutters ≥ 40px.
- `.ask` padding trick: `padding-inline: max(16px, calc((100% - 560px)/2))` — at 641px
  yields 40.5px each side (content 560px); at 1920px yields 680px each side. Never
  exceeds the viewport, never negative.
- All four HUD roots already set `overflow: hidden`, so any residual paint is clipped.
  No extra `overflow-x: hidden` guard needed.

## 5. Do NOT touch

- **Global `main { max-width: 640px; margin: 0 auto; padding: … }` (globals.css:17-21)**
  — load-bearing for the non-HUD routes (signup, import, paste, profile, preview). Leave
  it. Override per-HUD inside `@media (min-width: 641px)` only (front door: `.frontdoor`
  class beats `main` type).
- **Mobile (`max-width: 640px`)** — every rule above is inside `@media (min-width:
  641px)`. Phone layout is byte-for-byte unchanged (AC4).
- **No JSX restructuring.** No wrapper div. Every constraint is CSS on existing
  elements. (If a future wrapper is ever desired, name it `.desk-col` on a `<div>`
  inserted between each root and its content — but it is NOT needed for this fix.)
- **Per-screen scoping discipline** — all new rules stay scoped under `.frontdoor` /
  `.discovery` / `.jobdeck` / `.tailor` (and `:root` for the one shared layout token).
  No new colours, no new components, no new classes on elements.
- **The `.brandbar > div { max-width: 860px }`** rule — unrelated; leave it.

## 6. Implementation order

1. Add the `:root { --jc-desk-col: 560px }` block in `globals.css` inside `@media
   (min-width: 641px)`.
2. Add the four `@media (min-width: 641px)` blocks to `frontdoor.css`, `discovery.css`,
   `deck.css`, `tailor.css` as shown above.
3. Verify: at ≥ 641px, all four screens show a centred 560px content column on a
   full-viewport dark HUD; at ≤ 640px, unchanged. No horizontal scroll at any width ≥
   360px.
