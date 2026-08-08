// Assembles the shareable Design B comparison page (#157) into ONE self-contained HTML file:
// the three decided prototypes, base64-embedded so no escaping of their inline <script> or
// <!-- --> content can ever go wrong, mounted into srcdoc iframes with their internal
// engineering chrome (.ask-brief / .instr / .switcher) hidden. Built for outside reviewers —
// colleagues and real job-seekers — so the labels are neutral and never say which we chose.
//
//   node apps/web/prototypes/build-comparison.mjs
//
// Re-run it after ANY edit to the three prototypes; the page embeds copies, not references.
// The output is a single file with no external requests, so it can be opened from disk, mailed,
// or published as an artifact as-is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const P = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
const OUT = P + 'tailor-comparison.html';

const b64 = (f) => Buffer.from(fs.readFileSync(P + f)).toString('base64');
const LIST = b64('tailor-merged.prototype.html');
const DECK = b64('tailor-desktop-deck.prototype.html');
const PHONE = b64('tailor-mobile-cards.prototype.html');

const page = String.raw`<title>JobCrush — which one feels better?</title>
<style>
  /* ── Palette taken from the product itself: light is the paper the CV prints on, dark is the
     app's own HUD. The accent is the product's gold — darkened for the light ground so it holds
     contrast on bone, left at its own value on dark where it was designed to live. ── */
  :root {
    --ground:  #e8e3da;
    --surface: #f6f2ec;
    --raised:  #fffdf9;
    --ink:     #1a1916;
    --ink-2:   #635d50;
    --ink-3:   #736c5d;
    --accent:  #9a6410;
    --accent-soft: rgba(154,100,16,.10);
    --line:    #d5cdbe;
    --line-2:  #c3b9a6;
    --shadow:  0 18px 44px -22px rgba(50,40,20,.45);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:  #0d1116;
      --surface: #171c23;
      --raised:  #1f262f;
      --ink:     #e8eaed;
      --ink-2:   #97a2af;
      --ink-3:   #7f8b98;
      --accent:  #e8a33d;
      --accent-soft: rgba(232,163,61,.12);
      --line:    #2b333d;
      --line-2:  #3b4653;
      --shadow:  0 18px 44px -22px rgba(0,0,0,.7);
    }
  }
  :root[data-theme="dark"] {
    --ground:  #0d1116;
    --surface: #171c23;
    --raised:  #1f262f;
    --ink:     #e8eaed;
    --ink-2:   #97a2af;
    --ink-3:   #7f8b98;
    --accent:  #e8a33d;
    --accent-soft: rgba(232,163,61,.12);
    --line:    #2b333d;
    --line-2:  #3b4653;
    --shadow:  0 18px 44px -22px rgba(0,0,0,.7);
  }

  /* All three faces are the product's own stacks — the CV's serif, the app's sans, the app's
     mono. No webfont request, and the display face is literally the type the CV prints in. */
  :root {
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
    --sans: "Segoe UI Variable Text", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    --mono: "SF Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--ground); color: var(--ink); font-family: var(--sans);
    line-height: 1.55; -webkit-font-smoothing: antialiased; min-height: 100vh;
    display: flex; flex-direction: column;
  }
  a { color: var(--accent); }
  :where(button, a, [tabindex]):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

  /* ── the bar ── */
  .bar {
    position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 18px;
    flex-wrap: wrap; padding: 11px 20px; background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .brand .nm { font-size: 15px; font-weight: 660; letter-spacing: -.012em; white-space: nowrap; }
  .brand .q { font-family: var(--serif); font-size: 15.5px; font-style: italic; color: var(--ink-2); white-space: nowrap; }
  .bar .spacer { flex: 1 1 auto; }

  /* The switch IS the instrument on this page — the whole job is flipping between two shapes of
     the same moment, so it carries the weight rather than a gallery of thumbnails. */
  .switch { display: flex; gap: 2px; padding: 3px; background: var(--ground); border: 1px solid var(--line); border-radius: 999px; }
  .switch button {
    appearance: none; border: 0; background: transparent; font: inherit; font-size: 13px;
    color: var(--ink-2); padding: 7px 15px; border-radius: 999px; cursor: pointer; white-space: nowrap;
    display: inline-flex; align-items: baseline; gap: 8px; transition: color 140ms ease, background 140ms ease;
  }
  .switch button:hover { color: var(--ink); }
  .switch button[aria-pressed="true"] { background: var(--raised); color: var(--ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.10); }
  .switch button .k { font-family: var(--mono); font-size: 10px; color: var(--ink-3); }
  .switch button[aria-pressed="true"] .k { color: var(--accent); }

  .util { display: flex; align-items: center; gap: 6px; }
  .ghost {
    appearance: none; font: inherit; font-size: 12.5px; color: var(--ink-2); background: transparent;
    border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; cursor: pointer;
    transition: color 140ms ease, border-color 140ms ease;
  }
  .ghost:hover { color: var(--ink); border-color: var(--line-2); }

  /* ── the stage ── */
  .stage { flex: 1 1 auto; position: relative; min-height: 520px; }
  .frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
  .frame[hidden] { display: none; }

  .caption {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 10px 20px 12px; border-top: 1px solid var(--line); background: var(--surface);
  }
  .caption .what { font-size: 13px; color: var(--ink-2); }
  .caption .what b { color: var(--ink); font-weight: 620; }
  .caption .hint { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--ink-3); white-space: nowrap; }
  kbd {
    font-family: var(--mono); font-size: 10.5px; background: var(--ground); border: 1px solid var(--line);
    border-bottom-width: 2px; border-radius: 4px; padding: 1px 5px; color: var(--ink-2);
  }

  /* ── the opening panel ── */
  .veil { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, var(--ground) 80%, transparent); backdrop-filter: blur(6px); display: grid; place-items: center; padding: 24px; overflow-y: auto; }
  .veil[hidden] { display: none; }
  .sheet {
    width: min(680px, 100%); background: var(--raised); border: 1px solid var(--line);
    border-radius: 16px; box-shadow: var(--shadow); padding: 30px 34px 28px; margin: auto;
  }
  .sheet .eyebrow { font-family: var(--mono); font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--accent); margin: 0 0 12px; }
  .sheet h1 { font-family: var(--serif); font-size: clamp(26px, 4vw, 34px); line-height: 1.16; font-weight: 600; letter-spacing: -.01em; margin: 0 0 16px; text-wrap: balance; color: var(--ink); }
  .sheet p { margin: 0 0 13px; font-size: 15px; color: var(--ink-2); max-width: 62ch; }
  .sheet p b, .sheet li b { color: var(--ink); font-weight: 620; }
  .sheet .rule { height: 1px; background: var(--line); margin: 24px 0 20px; border: 0; }
  .sheet h2 { font-size: 11.5px; font-family: var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 13px; font-weight: 600; }
  .qs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 11px; counter-reset: q; }
  .qs li { position: relative; padding-left: 30px; font-size: 14.5px; color: var(--ink-2); counter-increment: q; }
  .qs li::before {
    content: counter(q); position: absolute; left: 0; top: 1px; width: 20px; height: 20px;
    display: grid; place-items: center; border-radius: 50%; background: var(--accent-soft);
    color: var(--accent); font-family: var(--mono); font-size: 10.5px; font-weight: 700;
  }
  .note { margin: 22px 0 0; padding: 13px 16px; border-radius: 10px; background: var(--accent-soft); font-size: 13.5px; color: var(--ink-2); }
  .note b { color: var(--ink); }
  .go {
    appearance: none; font: inherit; font-size: 15px; font-weight: 600; margin-top: 24px;
    background: var(--accent); color: var(--ground); border: 0; border-radius: 11px;
    padding: 12px 26px; cursor: pointer; transition: filter 140ms ease;
  }
  .go:hover { filter: brightness(1.08); }

  @media (max-width: 760px) {
    .bar { gap: 10px; padding: 10px 14px; }
    .brand .q { display: none; }
    .switch { order: 3; width: 100%; justify-content: space-between; }
    .switch button { padding: 7px 10px; font-size: 12.5px; }
    .caption .hint { display: none; }
    .sheet { padding: 24px 20px 22px; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: .01ms !important; } }
</style>

<div class="bar">
  <span class="brand">
    <span class="nm">JobCrush</span>
    <span class="q">which one feels better?</span>
  </span>
  <span class="spacer"></span>
  <div class="switch" id="switch" role="group" aria-label="Choose a version"></div>
  <div class="util">
    <button class="ghost" id="again" type="button">Start this one over</button>
    <button class="ghost" id="about" type="button">What is this?</button>
  </div>
</div>

<div class="stage" id="stage"></div>

<div class="caption">
  <span class="what" id="what"></span>
  <span class="hint">press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> to flip between them</span>
</div>

<div class="veil" id="veil">
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="vt">
    <p class="eyebrow">A decision we'd like a second opinion on</p>
    <h1 id="vt">Two ways of showing you what we changed on your CV.</h1>
    <p>This is a job-hunting tool. It has read your CV, you've picked a job advert, and now it does two things at once: it <b>asks you a few questions</b> the advert cares about, and it <b>shows you your CV rewritten for that one job</b> — including the parts it left off, and why.</p>
    <p>We built that same moment two ways for a computer screen. In one, <b>every question sits in a list</b> and you work down it. In the other, <b>questions arrive one at a time</b>, like cards. There's a phone version too. All three do the same things and say the same words — only the shape changes.</p>
    <p>We've already picked one internally. We're not saying which, because we'd rather find out we were wrong.</p>
    <hr class="rule">
    <h2>What we'd love you to tell us</h2>
    <ol class="qs">
      <li>Which of the two computer versions would you rather actually use — and why?</li>
      <li>Was there a moment you weren't sure what the app had done to your CV, or why it did it?</li>
      <li>Did anything feel like it was being kept from you, or like you couldn't undo it?</li>
    </ol>
    <p class="note"><b>None of this is real.</b> It's a made-up person's CV, running entirely in your own browser. Nothing you type is saved and nothing is sent anywhere. Click around freely — you can't break it, and <b>Start this one over</b> resets whichever version you're on.</p>
    <button class="go" id="start" type="button">Have a look</button>
  </div>
</div>

<script>
"use strict";

const SRC = {
  list:  "${LIST}",
  deck:  "${DECK}",
  phone: "${PHONE}",
};

const META = {
  list:  { label: "Desktop — a list",        what: '<b>Every question at once.</b> The advert&rsquo;s asks sit in a list on the left; click any one to answer it. Your CV is on the right the whole time.' },
  deck:  { label: "Desktop — one at a time", what: '<b>One question at a time.</b> The same asks arrive as cards, in order. Your CV is on the right the whole time.' },
  phone: { label: "Phone",                   what: '<b>On a phone.</b> One question at a time, and your CV is tucked away at the bottom &mdash; drag or click the bar to pull it up.' },
};

/* The two desktop versions are offered in a RANDOM order each time this page is opened.
   Whichever comes first tends to become the reference the other gets judged against, and this
   page exists to collect an honest preference — so the running order is not ours to set. */
const desktops = Math.random() < 0.5 ? ["list", "deck"] : ["deck", "list"];
const ORDER = [desktops[0], desktops[1], "phone"];

/* Each prototype carries its own engineering chrome (a build brief, an instrument readout, a
   variant switcher). None of that belongs in front of a reviewer, so it is hidden rather than
   edited out — the embedded files stay byte-identical to the ones in the repo. The transparent
   body lets each one sit on this page's own ground in whichever theme the reader is using. */
const BASE_INJECT = "<style>.ask-brief,.instr,.switcher{display:none!important}"
                  + "html,body{background:transparent!important}"
                  + "body{padding:26px 20px 30px!important}";
const INJECT = {
  list:  BASE_INJECT + "</style>",
  deck:  BASE_INJECT + "</style>",
  /* the handset is a fixed 844px object in a tall frame — centre it rather than pinning it to
     the top, so it reads as a device being shown rather than a page that ran out of content */
  phone: BASE_INJECT + "body{padding:0!important}"
                     + ".desk{align-items:center;min-height:100vh}</style>",
};

function decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

const stage = document.getElementById("stage");
const switcher = document.getElementById("switch");
const whatEl = document.getElementById("what");
const frames = {};
let current = ORDER[0];

/* Each frame is created empty and only loaded the first time its option is opened. That is not
   laziness for speed — a prototype that boots inside a display:none iframe measures a zero-height
   window, and the phone build sizes its pull-up CV sheet from exactly that number, so mounting
   all three up front rendered the phone with its CV stuck wide open. Once mounted a frame is
   never rebuilt, so progress survives flipping: answering the same question in two shapes and
   snapping back and forth IS the comparison, and a reload between them would destroy it. */
const mounted = {};
ORDER.forEach((key, i) => {
  const f = document.createElement("iframe");
  f.className = "frame";
  f.title = META[key].label;
  f.hidden = true;
  stage.appendChild(f);
  frames[key] = f;

  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = '<span class="k">' + (i + 1) + '</span>' + META[key].label;
  b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", function () { show(key); });
  switcher.appendChild(b);
});

function load(key) {
  frames[key].srcdoc = decode(SRC[key]) + INJECT[key];
  mounted[key] = true;
}

function show(key) {
  current = key;
  ORDER.forEach(function (k) { frames[k].hidden = k !== key; });
  Array.prototype.forEach.call(switcher.children, function (b, i) {
    b.setAttribute("aria-pressed", String(ORDER[i] === key));
  });
  whatEl.innerHTML = META[key].what;
  if (!mounted[key]) { load(key); return; }
  /* it was hidden while the window may have changed size; the CV scales to its column, so
     nudge the frame to re-measure now that it can actually see itself */
  try { frames[key].contentWindow.dispatchEvent(new Event("resize")); } catch (e) {}
}
show(current);

document.getElementById("again").addEventListener("click", function () { load(current); });

const veil = document.getElementById("veil");
function openAbout() { veil.hidden = false; document.getElementById("start").focus(); }
function closeAbout() { veil.hidden = true; }
document.getElementById("start").addEventListener("click", closeAbout);
document.getElementById("about").addEventListener("click", openAbout);
veil.addEventListener("click", function (e) { if (e.target === veil) closeAbout(); });

addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !veil.hidden) { closeAbout(); return; }
  if (!veil.hidden) return;
  const i = ["1", "2", "3"].indexOf(e.key);
  if (i > -1 && ORDER[i]) show(ORDER[i]);
});
</script>
`;

fs.writeFileSync(OUT, page, 'utf8');
console.log('written', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
