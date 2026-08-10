---
name: JobCrush
description: A dark, quiet room where the machine tailors your CV beside you — the CV itself the one warm, lamp-lit sheet of paper.
colors:
  gold: "#e8a33d"
  gold-deep: "#a8762b"
  gold-light: "#ffd9a0"
  gold-ink: "#1a1206"
  night-floor: "#101419"
  night-surface: "#171c23"
  night-raised: "#1f262f"
  night-line: "#2b333d"
  night-ink: "#e8eaed"
  night-muted: "#7f8b98"
  night-muted-readable: "#8a95a2"
  reserve: "#97aabc"
  settled: "#4d5865"
  night-weak: "#6f7d8c"
  paper: "#f6f2ea"
  paper-edge: "#e2dacb"
  paper-ink: "#16150f"
  paper-muted: "#6b6455"
  day-ground: "#faf9f7"
  day-surface: "#ffffff"
  day-ink: "#1f2328"
  day-muted: "#59636e"
  day-line: "#d9d5cf"
  day-teal: "#0b6e5f"
  evidence-verified: "#1a7f37"
  evidence-derived: "#0969da"
  evidence-partial: "#9a6700"
  evidence-suggested: "#8250df"
  evidence-negative: "#57606a"
  danger: "#cf222e"
  danger-soft: "#e0876c"
typography:
  display:
    fontFamily: "Segoe UI Variable Text, -apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "29px"
    fontWeight: 660
    lineHeight: 1.13
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Segoe UI Variable Text, -apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 620
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Segoe UI Variable Text, -apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  paper:
    fontFamily: "Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "SF Mono, Cascadia Mono, ui-monospace, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "0.02em"
  scale:
    mono-label: "10.5px"
    tag: "11px"
    caption: "12px"
    meta: "12.5px"
    note: "13px"
    reading: "13.5px"
    emphasis: "17px"
    headline: "18px"
    stat: "19px"
    moment: "24px"
    reveal: "27px"
    hero-count: "38px"
    burst: "42px"
rounded:
  tight: "6px"
  soft: "10px"
  control: "11px"
  card: "12px"
  card-dark: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.soft}"
    padding: "12px 14px"
  button-primary-hover:
    backgroundColor: "{colors.gold-light}"
  button-secondary:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.soft}"
    padding: "12px 14px"
  card-dark:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.card-dark}"
    padding: "18px"
  card-light:
    backgroundColor: "{colors.day-surface}"
    textColor: "{colors.day-ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  chip-fact:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 11px"
---

# Design System: JobCrush

## Overview

**Creative North Star: "The Night Desk"**

JobCrush happens in a dark, quiet room. The interface is the room — matte charcoal
surfaces, thin lines, muted greys — and it stays deliberately self-effacing, because the
one thing that matters in the room is the **CV: a warm, cream, serif sheet of paper**
that reads like a real printed page. Gold is **lamplight**: it falls only on what is on
the page right now, or on the moment something the person said becomes part of their
record. When something glows on this screen, it earned it.

This identity was not invented; it is the shipped product's own register, chosen again
by the owner on 2026-08-08 against three deliberately louder alternative worlds
(`apps/web/prototypes/north-star.prototype.html` — Dealer's Table and Cockpit rejected;
the incumbent confirmed). Documented here so new surfaces extend the room rather than
redecorating it.

**Key Characteristics:**
- Two grounds: the dark room (the game — confirm deck, question game, job decks,
  tailoring, profile) and a warm light register (import, sign-in, settings, admin).
  The paper is a third material that lives in both. Sign-up enters the dark room at
  Confirm and stays there through the question game; there is no register change
  between those back-to-back screens.
- One accent. Gold is rationed and semantic, never decorative.
- Quiet chrome: 1px lines, tonal layering, muted text; the content is the show.
- The machine speaks in the first person, in short plain words (observed practice —
  see PRODUCT.md; deliberately not a locked commitment).

## Colors

A charcoal room, one gold voice, warm paper, and a small semantic evidence palette.

### Primary
- **Lamplight Gold** (#e8a33d): the single accent of the whole product. It means "on
  your CV right now", the reward beat (a fact chip flying to the profile), the active
  step, the primary action. Deep variant (#a8762b) for pressed/dim states; light
  variant (#ffd9a0) for hover and glow cores.
- **Gold Ink** (#1a1206): the near-black warm ink that sits *on* gold — button text,
  lit chip text, anything printed on a lamplight fill. Never used on its own ground.

### Neutral — the dark room
- **Night Floor** (#101419): the app background in the dark register.
- **Night Surface** (#171c23) and **Night Raised** (#1f262f): the two tonal steps for
  cards and controls — depth comes from these, not from shadows.
- **Night Line** (#2b333d): every border, 1px.
- **Night Ink** (#e8eaed) body text · **Night Muted** (#7f8b98) secondary text on
  Floor/Surface · **Night Muted Readable** (#8a95a2) secondary text on Raised (kept AA).
- **Reserve Grey** (#97aabc): the counterpart of gold — a fact saved for later, not on
  the page. **Settled** (#4d5865): separators and done-state text.
- **Night Weak** (#6f7d8c): the gap grey of the colour law — "where you don't match
  yet" marks and their tinted pills; never gold's counterpart (that is Reserve), and
  never body text.

### Neutral — the paper
- **Paper** (#f6f2ea) with **Paper Edge** (#e2dacb) borders, **Paper Ink** (#16150f)
  and **Paper Muted** (#6b6455): the CV sheet, quoted CV lines, and anything that
  represents the printed page. Always warm, never pure white.

### Neutral — the light register
- **Day Ground** (#faf9f7), **Day Surface** (#ffffff), **Day Ink** (#1f2328),
  **Day Muted** (#59636e), **Day Line** (#d9d5cf): the light app (import, sign-in,
  settings-like surfaces, but not the confirm deck). **Day Teal** (#0b6e5f) is this
  register's accent (wordmark, links, confirm actions) — the one place the accent is
  not gold.

### Semantic — evidence badges (light register, spec §5)
- **Verified** (#1a7f37) · **Derived** (#0969da) · **Partial** (#9a6700) ·
  **Suggested** (#8250df) · **Negative** (#57606a) · **Danger** (#cf222e).
- **Danger Soft** (#e0876c): the dark room's error voice — inline error text on night
  surfaces, where the light register's danger red would vibrate against the charcoal.

### Translucency
Translucent surfaces are alpha blends of the documented night colours, never new
colours: Night Surface at .82/.86/.97 for floating sheets, rails and dialogs; Night
Ink at .28/.45 for lit borders; gold at .04–.4 for lamplight pools, bubble fills and
glows; Night Weak and Settled at .12–.5 for their tinted pills. A blend takes its
identity from its base colour — only the base has to be on the ramp, so a new alpha
step of a documented colour is not drift.

### Named Rules
**The Gold Law.** Gold marks what is on the rendered CV right now, or the moment a fact
joins the record. Grey (Reserve) marks what is saved for later. Gold is never used to
decorate, and its rarity is the point — one glowing thing per screen is the ceiling.

**The Two Rooms Rule.** A surface commits to one register — dark room or light
register — and uses the paper palette only for things that are literally the printed
page. Mixing registers on one surface is a defect, not a blend.

**The Working Ramp Rule.** The dark room's full type and colour working ramp is
documented here — the five typography roles and the headline colour names are the
landmarks, not the whole ladder. The frontmatter `typography.scale` and the colour
tokens (with their sidecar tonal ramps) are the complete documented ramp, extracted
from the shipped, owner-ratified screens. A value outside the documented ramp is
drift, not idiom.

## Typography

**App Font:** Segoe UI Variable Text (system sans stack)
**Paper Font:** Iowan Old Style / Palatino (serif stack) — the CV and quoted CV lines
**Label Font:** SF Mono (mono stack) — tiny technical labels, tabular numbers

**Character:** the app's own voice is a plain, modern system sans — warm and
unremarkable on purpose. The serif belongs to the person's document: whenever the
product quotes her CV or shows the page, it switches to the serif, so "this is your
CV talking" is visible before it is read. (The real rendered/exported CV uses
ATS-safe Calibri/Segoe UI — the serif is the *in-app portrait* of the page, not the
export format.)

### Hierarchy
- **Display** (660, 29px, 1.13, -0.022em): the advert hero title on the tailor screen;
  one per screen at most.
- **Headline** (600–700, 18–21px): card titles, screen headings.
- **Title** (620, 15px): section heads inside cards and panels.
- **Body** (400, 14px, 1.5): everything readable.
- **Label** (mono, 10.5–11.5px): counts, build stamps, tiny keys — always with words,
  never carrying meaning by colour alone.

### Working Ramp
The dark room ships a wider ladder than the five roles above; the full working ramp
(frontmatter `typography.scale` plus the roles) is:
**10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 17 / 18 / 19 / 24 /
27 / 29 / 38 / 42px.**
The notable steps: **42px** is the celebration burst on the deck reveal · **38px**
the profile's hero fact count · **27px** the curtain reveal headline · **24px** the
dark room's "moment" headline (load states, loopback) · **19px** mono stat numbers ·
**18px** card and wall headings (the 18–21px headline band) · **17px** dialog lead
text · **12.5px** the workhorse secondary/meta size · **10.5–11.5px** the mono label
family. Half-steps within 0.5px of a documented step (15.5, 16.5, 18.5) read as that
step.

**The smallest reading text in the product is 10.5px (the label floor). Glyph-only
marks (a percent sign, a chevron) may go smaller; sentences never do.**

### Named Rule
**The Serif Means Her Rule.** Serif text is reserved for the person's own document and
sentences quoted from it. The machine never speaks in the serif.

## Layout

Single-column focus in the dark room: one card or one moment at a time on mobile
(390px frame), a 1.32fr : 1fr split on desktop (asks list left, CV paper right,
1320px max app width). The light register centres a 640px column. Spacing scale is
4 / 8 / 16 / 24 / 40. Density is calm: cards padded 16–24px, lists breathe.

**The Fit-Width Paper Rule.** The CV paper renders at true page proportions
(640 × 905) and is scaled to fit its column via transform — like a PDF at "fit width".
It is never reflowed to the container.

**The Still List Rule.** A list never reorders itself under the person as they work
through it. A row changes its appearance when answered, never its position; new
entries join the end of their group.

## Elevation & Depth

Flat by tone. Depth in the dark room comes from the three tonal steps
(Floor → Surface → Raised) plus 1px Night Line borders — surfaces cast no shadows.
A real shadow means a **physical object**: the CV paper sheet, a card in flight, the
phone frame in prototypes. The one glow in the system is gold
(`0 0 26–60px rgba(232,163,61,.2–.4)`) and it obeys the Gold Law.

### Shadow Vocabulary
- **Paper lift** (`0 -12px 36px -10px rgba(0,0,0,.6)`): the CV sheet rising over the room.
- **Card flight** (`0 16px 34px -12px rgba(0,0,0,.55)`): a card while it moves or floats.
- **Gold glow** (`0 0 26px rgba(232,163,61,.35)`): the reward beat and the primary action.

**The Flat-By-Default Rule.** Surfaces are flat at rest. If something casts a shadow,
the person should be able to imagine picking it up.

## Shapes

Gently rounded, never bubbly: 10–12px on controls and light cards, 16–18px on dark
cards, full pills (999px) for chips, counts and small status controls. Borders are
always 1px. The paper is the exception — near-square corners (≤9px), because pages
are pages. No decorative clipping, no slants, no gradients-as-decoration; the only
gradients in the system are light itself (the lamp pool, the gold glow).

## Components

### Buttons
- **Shape:** rounded 10px (dark room), pill allowed for small utility actions.
- **Primary:** Lamplight Gold fill, near-black ink (#1a1206), padding 12px 14px;
  hover brightens to Gold Light; a soft gold glow is permitted on the single most
  important action of a screen.
- **Secondary:** transparent or Night Raised fill, Night Line border, Night Ink text.
- **Ghost/tertiary:** borderless muted text, underlined on the dark room's quiet links.
- **Focus:** 2px solid Night Ink outline, 2px offset — everywhere, both registers.

### Chips (facts, counts, status)
- **Style:** full pill, Night Raised fill, 1px Night Line, 12.5px text; the count in
  bold Night Ink; a 16px gold coin dot when the chip is the fact-counter.
- **The reward beat:** a chip flying to the profile pile (720ms flight, pile bumps
  460ms with `cubic-bezier(.2,1.5,.4,1)`) — shipped in `factbadge.css`, reused at its
  own values, never re-timed per screen.

### Cards / Containers
- **Dark room:** Night Surface fill, 1px Night Line, radius 16–18px, padding 16–18px;
  deal in with 340ms ease rise (`jd-dealin`); a finished card settles down and fades —
  never sideways unless it is genuinely being rejected.
- **Light register:** White surface, Day Line border, radius 12px, padding 24px.

### Inputs / Fields
- **Style:** Night Raised fill, 1px Night Line, radius 10px, padding 10–11px 13px,
  body-size text; placeholder in Night Muted Readable.
- **Focus:** the standard 2px Night Ink outline; no glow, no border-colour tricks.

### The Paper (signature component)
The CV sheet: Paper fill, Paper Edge hairline, serif type, true-page proportions
scaled to fit, paper-lift shadow. On mobile it is a pull-up bottom sheet with a
grabber bar; on desktop it sits permanently in the right column. Changes to the CV
materialize on the page character by character when visible — the single most
persuasive moment in the product, never hidden behind a guard.

### The Ask Row (signature component)
One advert requirement as a full-width row: state dot, plain-words text, quiet tag,
chevron; expands in place to show its evidence or its answer controls. Rows keep the
job's order forever (Still List Rule). An unanswered ask in a summary panel is text,
not a button — panels report, they never answer.

## Do's and Don'ts

### Do:
- **Do** keep gold semantic (Gold Law): on-the-page, the reward beat, the one primary
  action — and nothing else.
- **Do** switch to the serif whenever the person's own document or sentences appear.
- **Do** reuse the shipped motion values (720ms chip flight, 460ms bump, 340ms deal-in,
  8px drag activation / 90px commit on the swipe deck) instead of re-timing per screen.
- **Do** state costs in plain words at the moment of a change, in the machine's
  first-person voice.
- **Do** honour `prefers-reduced-motion` on every animation, and keep muted-on-raised
  text at the AA-checked #8a95a2.

### Don't:
- **Don't** put a shadow on a surface that isn't a physical object (paper, flying
  card, phone frame).
- **Don't** mix the dark room and the light register on one surface, or use pure
  white for anything that represents the page (paper is #f6f2ea).
- **Don't** reorder a list under the person, ever (Still List Rule).
- **Don't** add a second accent colour to the dark room — gold is alone by design
  (the light register's teal is that register's own accent, not a second voice in
  the dark).
- **Don't** show designer instrumentation (counters, budgets, internal vocabulary) on
  the person's screen — it lives in prototype chrome only.
