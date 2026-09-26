# Can our API container make a PDF, what does it cost, and does the machine fit?

_Reading and measurement legwork for [#295](https://github.com/adrien-mounier/jobcrush-app/issues/295),
a `/research` ticket on map [#290](https://github.com/adrien-mounier/jobcrush-app/issues/290).
Completed 2026-09-27. **Nothing was deployed, nothing was scaled, no money was spent.** No `fly`
command that writes was run. Every figure below is either quoted from a vendor's own page, computed
from a vendor's own published constants (with the arithmetic shown), or measured first-hand in this
session against the repo's own pinned dependencies — each one labelled._

> 🚨 **The headline reverses the ticket's own worry, then replaces it with a worse one.**
> Money is **not** the obstacle: because the machine is billed per running second and auto-stops to
> zero, taking it from 256MB to 1GB costs **about three cents a month** at any duty cycle this app
> will see — not the $4.76 the sticker price suggests. The obstacle is **cold start**: the machine
> must read ~260MB of browser binary off a disk Fly throttles to 8MB/s, and Fly's own users measured
> 15–30 seconds for exactly this workload. That lands on the one press this map cares about.
> Read [The verdict](#the-verdict) and [Cold start is the real cost](#4-cold-start-is-the-real-cost-and-it-is-not-the-machine).

---

## The verdict

**Put the browser in the container. Ruling 5 stands — but it is not free, and the thing it costs is
not money.**

1. **Affordable: yes, decisively.** The machine upgrade is cents per month, the image growth is
   $0.07/month, and every browserless alternative either re-authors the CV layout in a second
   language (which this repo has already refused) or ships the document to a third party.
2. **At what settings:** `chrome-headless-shell` (not full Chromium), apt dependencies
   **hand-picked, never `--with-deps`**, `fonts-crosextra-carlito` installed, and the machine at
   **1GB minimum — 2GB is the honest number.** 256MB cannot run it.
3. **The bill that is not in dollars:** the first PDF after an idle spell will take **tens of
   seconds**, and no amount of code fixes that. The only real mitigation costs **$7.23/month** (one
   warm machine) and the owner has to decide whether that press is worth it.

**One decision is now owed that #295 did not ask for:** whether to pay $7.23/month to keep a machine
warm, or to accept a slow first PDF and design the waiting screen honestly. See
[What is now owed to the owner](#what-is-now-owed-to-the-owner).

---

## What was measured here, first-hand

Separated out because these are the only numbers in this document that are ours rather than
somebody's. All taken 2026-09-27 against the repo's own pinned versions.

| Measurement | Result | How |
|---|---|---|
| **Our real CV, rendered to PDF** | **exactly 2 pages** | the actual `renderPreviewHtml()` from `apps/api/dist/preview.js`, at the repo's own documented two-page density (24 experience bullets, 4 roles × 6), `page.pdf({format:'A4', margin:12mm, printBackground:true})` |
| HTML size of that document | 7,524 bytes | same run |
| PDF size out | 66 KB | same run |
| Page count read back | 2, via **`pdf-parse`** | `PDFParse(...).getText().total` — already a **production** dependency of `apps/api` |
| **Peak browser RSS, full Chromium** | **201 MB** | sum of all `chrome`/`headless_shell` process working sets, sampled every 100ms, baseline subtracted |
| **Peak browser RSS, headless shell** | **202 MB** | same — the shell saves **nothing** on memory |
| Browser launch | 132–146 ms | `chromium.launch()`, warm page cache |
| `setContent` + `pdf()` | 2.34–2.48 s | first page in a fresh browser |
| `chrome-linux64.zip` (pinned ver.) | **177.0 MB zip → 378.0 MB unpacked** | ZIP central directory read over HTTP Range from Google's bucket |
| `chrome-headless-shell-linux64.zip` | **114.2 MB zip → 260.3 MB unpacked** | same |
| `node:22-slim` amd64 | 76.1 MB compressed | Docker Hub registry API, image pushed 2026-09-23 |
| apt closure, chromium libs only | 86 pkgs, 76.8 MB | Debian bookworm's own `Packages` index, Depends+Pre-Depends |
| apt closure, **lean set** | 88 pkgs, **81.5 MB** | same |
| apt closure, `--with-deps` | 151 pkgs, **363.5 MB** | same |

⚠️ **The RSS and timing figures were taken on Windows 11 with an NVMe disk, not on Debian inside a
Firecracker microVM on Fly's throttled ephemeral disk.** Linux RSS for the same work is typically
somewhat lower than a Windows working set, and Fly's disk is dramatically slower. Treat ~200MB as the
right order of magnitude for the browser's memory and treat the *timings as a best case that Fly will
not match* — section 4 has the Fly-measured numbers, and they are 10× worse.

Sources: `node_modules/.pnpm/playwright-core@1.61.1/.../browsers.json` and `.../lib/coreBundle.js`
(the repo's own installed copy), `https://storage.googleapis.com/chrome-for-testing-public/`,
`http://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz`,
`https://hub.docker.com/v2/repositories/library/node/tags/`.

---

## Two things about our own renderer that change the shape of the work

Found by reading `apps/api/src/preview.ts`, and neither is in #295 or #156.

### The CV asks for three fonts the container does not have, and page count is a function of fonts

`renderPreviewHtml()` line 831:

```css
body{font-family:Calibri,'Segoe UI',Arial,sans-serif; ...}
```

**Calibri, Segoe UI and Arial are all absent from `node:22-slim`** — it ships no fonts at all. The
function's own docstring says it is styled *"like the engine's DOCX output (`_docx_build/build_cv.mjs`):
Calibri, #1F4E79 accent…"*, so Calibri is a deliberate choice inherited from the DOCX builder, not an
accident.

Debian bookworm has metric-compatible substitutes, and their package descriptions say so verbatim
(read from the bookworm `Packages` index):

| Package | Debian's own description | Installed |
|---|---|---|
| `fonts-crosextra-carlito` | *"Sans-serif font metric-compatible with Calibri font"* | 2.7 MB |
| `fonts-liberation` | *"Fonts with the same metrics as Times, Arial and Courier"* | 2.0 MB |

**Why this is load-bearing and not a detail:** #156's acceptance criteria are *"the pipeline can state
how many pages it occupies"* and *"the ~24-bullets-per-two-pages figure is measured against our
renderer."* Page count is a direct function of font metrics. Render with a fallback font and the
number measured is the page count of a document **nobody will ever see**, and the ~24-bullet figure
gets "confirmed" against the wrong typeface. `fonts-crosextra-carlito` costs 2.7 MB and makes the
measurement mean what it says.

### `page.pdf()` prints with `print` media and shifts colours — neither is currently handled

From the repo's own pinned Playwright type definitions
(`playwright-core@1.61.1/types/types.d.ts`, around line 3671):

> `page.pdf()` generates a pdf of the page with `print` css media.

> **NOTE** By default, `page.pdf()` generates a pdf with modified colors for printing. Use the
> [`-webkit-print-color-adjust`] property to force rendering of exact colors.

Consequences for our page, all verified by reading the stylesheet:

- The CSS contains **no `@media print` block and no `@page` rule** (#156 already says this). The only
  media query is `@media (max-width:600px)`, which will not fire.
- The **`#1F4E79` accent** on `h1`/`h2`, the `1.5px` section rules, and the red `DRAFT` watermark
  (`WATERMARK_SVG`, a `background-image` data URI) are all subject to that colour shift. Fixing it is
  `print-color-adjust: exact`, plus `printBackground: true` on the call — the watermark is a
  background image and **will not print at all** without the latter.
- `@page` is **optional**: `page.pdf({format:'A4', margin:{…}})` sets the sheet without it. What is
  *not* optional is `break-inside: avoid` on `.role`, or a role's bullets will split across the page
  boundary. The current CSS has no break control of any kind.

**So "it reuses the renderer we already own" is true of the content and false of the print layout.**
The print stylesheet does not exist yet and has to be written whichever route is taken. That does not
overturn ruling 5 — it is a smaller job than a second layout — but it should not be costed at zero.

### One thing that genuinely is free

`pdf-parse` is **already a production dependency** of `apps/api` (`package.json`), and
`extractText()` in `apps/api/src/extract.ts` already reads `result.total` off it to page-count
**uploaded** CVs. Feeding our own generated PDF back through the same call answers #156's page-count
criterion with **zero new dependencies**. Confirmed by running it: it returned `2`.

---

## 1. The pattern, and what each option adds to the image

### What Playwright actually downloads, and the trap in it

Read from the repo's own installed `playwright-core@1.61.1`:

- It pins **Chrome for Testing 149.0.7827.55**, revision 1228.
- **`chromium` and `chromium-headless-shell` are both `installByDefault: true`.** So plain
  `npx playwright install chromium` fetches **both** — 291 MB of download, 638 MB on disk, when only
  one of them will ever be launched.
- On `debian12-x64` — which is exactly what `node:22-slim` is — Playwright does **not** ship its own
  Chromium. `DOWNLOAD_PATHS` maps it to `cftUrl('linux64/chrome-linux64.zip')`, i.e. it downloads
  Google's Chrome for Testing zips. The figures below are therefore the same artefacts whether you
  come via Playwright or via `@puppeteer/browsers`.

| Option | Download | On disk | Measured how |
|---|---|---|---|
| Full Chrome for Testing, linux64 | **177.0 MB** | **378.0 MB** | ZIP central directory, this session |
| **`chrome-headless-shell`, linux64** | **114.2 MB** | **260.3 MB** | ZIP central directory, this session |
| Saving by choosing the shell | −62.8 MB | **−117.7 MB** | |

⚠️ **Playwright's published disk-space table is stale.** `playwright.dev/docs/browsers` lists
`281M chromium` and does not list the headless-shell directory at all. Measured unpacked is 378 MB.
Do not quote the docs figure.

### The apt dependencies — and why `--with-deps` must not be used

`--with-deps` is what CI already runs (`.github/workflows/ci.yml` line 81) and it is the wrong call
for a production image. Playwright's `installDeps()` adds the `tools` group **unconditionally**, and
on Debian 12 `tools` includes `xvfb` — an X server a headless PDF renderer never touches — which
drags in Mesa and LLVM.

Computed over Debian bookworm's own `Packages` index (Depends + Pre-Depends, first alternative,
no Recommends):

| Set | Packages in closure | Gross installed |
|---|---|---|
| A — the 21 chromium libs only | 86 | 76.8 MB |
| **B — lean: A + Carlito + Liberation + fontconfig** | **88** | **81.5 MB** |
| C — what `playwright install --with-deps chromium` gives you | 151 | **363.5 MB** |

**`--with-deps` costs 282 MB more than the lean set**, and it is nearly all waste for us:
`libllvm15` **111.9 MB**, `libicu72` 35.3 MB, `libgl1-mesa-dri` 24.7 MB, `libz3-4` 22.2 MB, plus
**52 MB of CJK and emoji fonts** (`fonts-wqy-zenhei` 16.0, `fonts-unifont` 13.8,
`fonts-ipafont-gothic` 11.9, `fonts-noto-color-emoji` 10.5) that a Latin-script CV will never use.

⚠️ These are **gross** figures — `libc6`, `dpkg`, `libssl3` and friends are already in `node:22-slim`,
so the real net addition is lower. The *comparison* between the three rows is the reliable part.

Two independent computations (mine and a second pass over the same index) produced 76.8 MB and
363.5 MB identically, which is the cross-check that the method is sound.

Source for the dependency lists: `playwright-core`'s own `nativeDeps` table, read out of the installed
`lib/coreBundle.js` at line 26979 (`debian12-x64`), corroborated against
https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/nativeDeps.ts
and the unconditional `targets.add('tools')` in `registry/index.ts`.

### Does `chrome-headless-shell` still print PDFs faithfully?

**Yes.** No vendor sentence says it in so many words, so the evidence is circumstantial but strong:

1. **Playwright's default headless *is* the shell** — `playwright.dev/docs/browsers#chromium-headless-shell`:
   *"Playwright ships a regular Chromium build for headed operations and a separate chromium headless
   shell for headless mode."*
2. **Playwright's PDF test suite therefore runs against the shell on every CI run.**
   `tests/library/pdf.spec.ts` guards only on `browserName !== 'chromium'` — *"Printing to pdf is
   currently only supported in chromium"* — and never on headless mode. Those tests include `tagged`
   and `outline` PDFs.
3. **`page.pdf()`'s API docs carry no headless caveat** and explicitly support `@page` via
   `preferCSSPageSize`: *"Give any CSS `@page` size declared in the page priority over what is
   declared in width/height or format options."* The old *"only supported in Chromium headless"* note
   is gone from the current source.
4. **Architecturally it is the same Blink.** Google describes the shell as *"a lightweight wrapper
   around Chromium's `//content` module"* that *"does not require X11/Wayland, D-Bus, and is in some
   ways more performant than the fully-fledged Chrome browser"*
   (https://developer.chrome.com/blog/chrome-headless-shell). `@page`, `break-inside`, `@font-face`
   are Blink features, not shell features.
5. **The known regression runs the other way.** Playwright's v1.49 notes say that in *new* headless
   *"PDF documents are now rendered in the page, instead of being downloaded"*, and Chromium tracked
   `--print-to-pdf` regressing in new headless (https://issues.chromium.org/issues/362301064). The
   shell is the one that behaves like the classic print pipeline.

⚠️ **Corrections to two things it is easy to assume:** `--only-shell` does **not** skip ffmpeg, and it
does **not** change the apt set — `chromium-headless-shell` carries
`_dependencyGroup: 'chromium'`, so the dependency list is identical either way. Hand-picking the apt
packages is what saves the 282 MB, not `--only-shell`.

### Alpine is not the answer

- **Playwright refuses it outright** — `playwright.dev/docs/docker#alpine`: *"Browser builds for
  Firefox and WebKit are built for the glibc library. Alpine Linux and other distributions that are
  based on the musl standard library are not supported."* Supported Linux is *"Debian 12 / 13,
  Ubuntu 22.04 / 24.04 / 26.04"*. The Chrome for Testing zips are glibc-linked too.
- **Puppeteer documents it as a workaround with a live warning** — `pptr.dev/troubleshooting#running-on-alpine`:
  *"The current Chromium version in Alpine 3.20 is causing timeout issues with Puppeteer.
  Downgrading to Alpine 3.19 fixes the issue."*
- **And it is not even smaller.** Alpine v3.22's `chromium` apk is **263.0 MB installed**
  (117.4 MB download) against the shell's 260.3 MB, and it Depends on 63 packages including GTK+3,
  Mesa, ffmpeg and PulseAudio (https://pkgs.alpinelinux.org/package/v3.22/community/x86_64/chromium).

### The official Docker base images are far too big

Measured from each registry's own manifest (compressed layer sums; `docker images` reports
uncompressed, typically 2–2.5× larger):

| Image | Compressed |
|---|---|
| `node:22-slim` — what we build on today | **76.1 MB** |
| `chromedp/headless-shell:latest` (shell only, Debian, no Node) | 143.4 MB |
| `ghcr.io/puppeteer/puppeteer:latest` (`FROM node:24-bookworm`, not slim) | 755.6 MB |
| `mcr.microsoft.com/playwright:v1.63.0-noble-amd64` | 911.5 MB |

Playwright's own Docker page publishes no size figure. Both official images carry browsers we would
never launch — the Playwright image carries Firefox and WebKit as well. **Neither is worth adopting**;
they would replace a 76 MB base with a 750–900 MB one to get something a hand-written layer does in
~340 MB.

### The recommended shape

```
FROM node:22-slim
# 21 chromium libs, hand-picked — NEVER `playwright install --with-deps`
# + fonts-crosextra-carlito   (Calibri metrics — the CV's first-choice font)
# + fonts-liberation          (Arial/Times metrics — the fallback the CSS names)
# + fontconfig
# then: chrome-headless-shell only (playwright install --only-shell chromium,
#       or @puppeteer/browsers install chrome-headless-shell)
ENV LANG=en_US.UTF-8   # Puppeteer's own Dockerfile: "important for chrome-headless-shell"
```

**Total added, uncompressed: ~260 MB browser + ~82 MB apt (gross) + ~13 MB npm ≈ 355 MB.** Against a
base that is 76 MB compressed / roughly 220 MB on disk, the image **roughly triples**. Section 3 prices
that: it is $0.07 a month.

`ENV LANG` per https://github.com/puppeteer/puppeteer/blob/main/docker/Dockerfile.

---

## 2. The memory floor

### What is actually published

**No vendor publishes a measured peak RSS for "launch a headless browser and print one small styled
document."** That figure does not exist in any primary source. What exists:

| Source | Figure | Standing |
|---|---|---|
| `@sparticuz/chromium` README | *"You should allocate at least 512 MB of RAM to your instance; however, 1600 MB (or more) is recommended."* | **vendor documented** |
| Fly.io staff (`rubys`), community forum | *"Chrome is a memory hog. At a minimum, you will likely need 1G of RAM."* | staff comment, not docs |
| Browserless production docs | smallest published tier is **2 CPU / 4 GB** for 5–10 concurrent sessions | **vendor documented** |
| Browserless blog | *"you can typically run roughly 10 concurrent requests per GB of memory"* | vendor blog |
| `sambaiz/puppeteer-lambda-starter-kit` | *"Lambda's memory needs to be set to at least 384 MB"*; measured 512 MB → 6.48s vs 1536 MB → 2.15s for one `goto` | one person's repo |

⚠️ A *"300–500 MB per concurrent instance"* figure circulates widely and is **not on any
browserless.io docs page**. Treat as unsourced.

### Our own measurement closes the gap

The one number nobody publishes, we now have: **201–202 MB peak RSS** for the browser alone, printing
our actual two-page CV. The headless shell used **the same memory as full Chromium** — its saving is
entirely disk and download, not RAM.

Add the Node API process (typically 50–90 MB for a Fastify app) and the floor for *browser + app* is
**~260–300 MB before the OS gets anything.**

### So: 256MB will not run it

Confirmed by evidence rather than assertion, four ways:

1. **Our measured browser peak alone (201 MB) plus Node leaves nothing** on a 256MB machine — and the
   machine must also hold the OS and page cache.
2. **Every published recommendation is above 256MB**: 384 MB (lowest anyone claims), 512 MB
   (Sparticuz's stated minimum), 1 GB (Fly's own staff), 4 GB (Browserless's smallest tier). **Not one
   source says 256MB.**
3. **Fly's OOM behaviour is a crash, not degradation** — `docs.fly.io/getting-started/troubleshooting/`:
   *"OOM kills look like crashes to the proxy… If your app OOMs, the Machine crashes and health checks
   fail by definition."* So the failure mode at 256MB is the **whole API going down mid-request**,
   taking the health check with it — not a slow PDF.
4. **Swap is off by default** and Fly explicitly deprecates it as the fix — `fly.toml` reference:
   *"Swapping to disk can help avoid out-of-memory crashes on brief spikes… Swap is much slower than
   RAM, so if performance is important, a better solution is to increase the Machine memory with
   `fly scale memory`."*

**The floor is 1GB. 2GB is the honest number** — see the page-cache argument in section 4, which is
the reason to prefer it.

### Container gotchas, and which ones apply on Fly

- **`/dev/shm` at 64MB is a Docker default and does not apply to us.** Puppeteer's (v1.12.1) docs:
  *"By default, Docker runs a container with a `/dev/shm` shared memory space 64MB. This is typically
  too small for Chrome and will cause Chrome to crash when rendering large pages."* ⚠️ That text has
  been **removed from the current pptr.dev pages** — cite the versioned URL.
  **Fly runs a Firecracker microVM, not the Docker daemon, so there is no 64MB `--shm-size` default
  to inherit.** Fly's own docs show a real `df` from inside a Machine with `shm` at 113,224 KiB
  ≈ 110 MiB (https://docs.fly.io/volumes/volume-manage/) — consistent with the standard Linux tmpfs
  default of *"half of your physical RAM"* on a 256MB machine. ⚠️ Fly does not state this rule
  anywhere; verify on the real size with `fly ssh console -C 'df -h /dev/shm'`.
- **`--disable-dev-shm-usage` is probably unnecessary on Fly, and has a real cost.** Chromium's own
  switch description: *"The /dev/shm partition is too small in certain VM environments, causing Chrome
  to fail or crash (see crbug.com/715363). Use this flag to work-around this issue (a temporary
  directory will always be used…)."* Browserless's docs call it a performance degradation because it
  *"forces Chrome to write to `/tmp` instead of `/dev/shm`"*. On Fly that converts a RAM problem into
  a **throttled-disk** problem, which is precisely the thing that is already killing us in section 4.
  **Set it only if a real crash is observed.**
- **`--no-sandbox` is needed and is defensible here.** Playwright's Docker docs: *"the Docker image
  will use the `root` user to run the browsers. This will disable the Chromium sandbox which is not
  available with root"*, and *"If you run trusted code… the root user may be fine"* — for scraping
  they recommend a separate user plus a seccomp profile. **Our HTML is generated by our own pipeline
  from our own database and loaded via `setContent`, never fetched from a remote origin, and the
  renderer already escapes every claim-derived string (`esc()`, tested in `preview.test.ts`).** That
  is what makes `--no-sandbox` acceptable. ⚠️ **It stops being acceptable the moment the document
  embeds remote content** — an external image, a webfont from a CDN, anything. Keep the document
  self-contained. Note it does **not** reduce memory; no source claims it does.
- **Playwright prescribes `--ipc=host`, not `--shm-size`** — `playwright.dev/docs/docker`: *"Using
  `--ipc=host` is recommended when using Chromium. Without it, Chromium can run out of memory and
  crash."* ⚠️ There is no `fly.toml` equivalent of either flag; this needs checking against a real
  Fly machine.
- **`--single-process`: do not use.** Widely reported to crash new headless (puppeteer #5258, #5487,
  puppeteer-sharp #2512, Chromium 41442585), and **no published figure for what it saves**. Not
  documented as supported or unsupported.
- **`--disable-gpu`: pointless now.** Google's own `chrome-launcher` flag reference: *"Was often used
  along with `--headless`, but as of 2021, isn't needed."*

---

## 3. The machine, and what changing it costs

### The machine is the constraining case

**`jobcrush-api-staging` runs one machine: `shared-cpu-1x`, 256MB, region `sin`, currently stopped.**
(Confirmed by the owner 2026-09-27 via `fly machines list -a jobcrush-api-staging`. The research agent
was denied that command and did not obtain it; the sizing below is on the owner's figure.)

This is the smallest shared machine Fly sells, and per section 2 it is **below every published floor
for a headless browser.** `fly.api.toml` declares no `[[vm]]` block, which turns out to be lucky —
see the deploy trap below.

### Fly publishes constants, not a price table

⚠️ **The pricing page no longer publishes a static per-preset price table.** It renders from a
client-side region calculator. Any per-preset dollar figure must be computed from the four constants
the page does publish, and the arithmetic shown. From https://docs.fly.io/about/pricing/:

```
PRICE_PER_VCPU_SECOND  shared = 0.00000075      →  $1.944 per vCPU / 30 days
RAM_PRICE_PER_GB_SECOND       = 0.00000193      →  $5.00  per GB  / 30 days
INCLUDED_RAM_GB_PER_VCPU shared = 0.25          →  256MB free with one shared vCPU
SECONDS_PER_MONTH             = 2,592,000       →  a month is 30 days exactly
```

> "The price of a running Fly Machine VM is the price of a named CPU/RAM preset, plus about
> {BASELINE_RAM_PRICE_PER_30_DAYS × region.markup} per 30 days per GB of additional RAM."

**Our region matters: `sin` carries a markup of 1.269230769**, the joint-highest of the Asia-Pacific
group. So RAM in Singapore is **$6.35 per GB per 30 days**, not $5.00.

⚠️ **There is no free tier.** The old 3× `shared-cpu-1x` allowance is gone from the page entirely;
what remains is a trial — *"2 hours of machine runtime or 7 days of access, whichever comes first"*
(https://docs.fly.io/about/free-trial/).

### Computed for `sin`

| Preset | RAM | $/running hour | $/mo if it never stopped | Δ vs today |
|---|---|---|---|---|
| shared-cpu-1x | **256MB — today** | $0.00343 | **$2.47** | — |
| shared-cpu-1x | 512MB | $0.00563 | $4.05 | +$1.59 |
| **shared-cpu-1x** | **1GB — the floor** | **$0.01004** | **$7.23** | **+$4.76** |
| **shared-cpu-1x** | **2GB — the honest number** | **$0.01886** | **$13.58** | **+$11.11** |
| shared-cpu-2x | 2GB | $0.01886 | $14.46 | +$11.99 |

**`shared-cpu-1x` tops out at 2GB**, so the floor and the comfortable size both fit on the CPU preset
we already have — no CPU change needed. Fly's rule, verbatim from
https://docs.fly.io/machines/guides-examples/machine-sizing/: *"Memory limits are `2gb * shared CPU
size`… Minimum memory is `256m * shared CPU size`… Memory must be a multiple of 256 for shared
sizes."*

### 🚨 The figure that reverses the ticket's worry: billing follows running seconds, not provisioned size

This is the single most important number in the document.

> "Started Machines are billed **per second that they're running** (the time they spend in the
> `started` state), based on the price of a named CPU/RAM combination."
> "Stopped and suspended Machines are billed based on their root file system (rootfs) usage per second
> … by $0.15 per GB per month." — https://docs.fly.io/about/billing

> "Fly Machines are fast to start and stop, and **you don't pay for their CPU and RAM when they're in
> a `stopped` or `suspended` state**." — https://docs.fly.io/launch/autostop-autostart/

The app runs `auto_stop_machines = "stop"` with `min_machines_running = 0`, and the machine **is
currently stopped**. So the $4.76/month sticker price for 1GB is the **worst case, reached only if the
machine never stops again.** What it actually costs:

| Actual running time | Cost of the 256MB → 1GB upgrade |
|---|---|
| 1 hour / month | **+$0.007** |
| 5 hours / month | **+$0.033** |
| 20 hours / month | **+$0.132** |
| 100 hours / month | +$0.661 |
| never stops (720 h) | +$4.762 |

**For a single-user app that wakes up to answer a request, scaling to 1GB costs about three cents a
month. To 2GB, about eight.** The memory question is settled: it is not a cost question at all.

### The image growth is the part you pay for continuously

A stopped machine still pays for its root filesystem: **$0.15/GB/30 days**, ×1.269 in `sin` =
**$0.1904/GB/30 days**. So the ~355 MB the browser adds costs:

| Image growth | While stopped |
|---|---|
| +355 MB (lean: headless shell + hand-picked apt) | **+$0.066/month** |
| +750 MB (full Chromium + `--with-deps`) | +$0.139/month |

Seven cents a month, forever, versus fourteen. Worth choosing the lean path for tidiness; **not worth
one minute of argument on cost grounds.**

### ⚠️ The deploy trap, and why the missing `[[vm]]` block is lucky

From https://docs.fly.io/reference/configuration/:

> "The default Machine size is `shared-cpu-1x` but **it is not enforced if not specified in
> `fly.toml`**. It means commands like `fly deploy` won't attempt to update the compute requirements
> (or size) for a Machine."

> "If you update your Machine size using `fly scale vm` or `fly scale memory` **but you still have a
> `[[vm]]` section in your `fly.toml` file, the next `fly deploy` will reset your Machines to the
> configuration in the file.**"

`fly.api.toml` has **no `[[vm]]` block**, so a hand-scale will persist across deploys. **Two ways to
get this wrong:**

1. Scale by hand and then *add* a `[[vm]]` block later without matching it → the next deploy silently
   reverts the machine to 256MB and the PDF route starts OOM-crashing the whole API in production.
2. Add a `[[vm]]` block with the right memory and **never** scale by hand — this is the safer option,
   because the size then lives in version control where a reviewer can see it.

**Recommendation: declare it in `fly.api.toml`**, so the machine's size is a reviewable fact rather
than an undocumented property of a long-lived machine. And because both projects share the account,
`SHARED_INFRA.md` rule 7 puts the actual scaling command behind the owner's explicit approval, and its
inventory must be updated when it happens.

⚠️ `memory_mb` and `gpu_kind` **do not appear** in the current `fly.toml` reference. Use `memory`.

---

## 4. Cold start is the real cost, and it is not the machine

### Fly's own published figures

From https://docs.fly.io/reference/suspend-resume/ — the one page that states both:

> **Resume from suspend: a few hundred ms**
> **Cold start: ~2+ seconds for common apps**

⚠️ Fly's marketing *"boot instances in about 300ms"* (https://fly.io/blog/fly-machines/, 2022)
describes the **microVM boot, not your app answering a request.** Fly's own current docs put the
app-inclusive figure at "~2+ seconds". Do not quote the 300ms.

### 🚨 But for a container with a browser in it, Fly's own users measured 15–30 seconds

There is a community thread that is precisely our workload — "Chromium takes too long to initialize"
(https://community.fly.io/t/chromium-takes-too-long-to-initialize/26571):

| Reporter | Machine | Measured |
|---|---|---|
| `jaimeiniesta` | shared-4x / 4 GB | **25 seconds to initialize Chromium** on first request; *"less than 1 second"* in local dev |
| `lubien` | Puppeteer scraper | **~30s cold, ~2s warm**; machine reachable in ~1s |
| `halfer` | **shared-cpu-1x @ 256MB**, plaintext crawler, no browser | **7.5s boot** |
| `halfer` | shared-cpu-4x @ 2048MB, Playwright + Firefox | **15s boot, 18s to serving** |

**And the diagnosis in-thread names the mechanism:** Fly's ephemeral disk is throttled to
**2000 IOPS / 8 MB/s**, so reading the browser binary on first launch is itself ~20 seconds.

**Check that against our own measurement: the headless shell is 260.3 MB unpacked. At 8 MB/s that is
~33 seconds of pure disk read** before Chromium has executed a single instruction. Our locally
measured 135ms launch was against a warm NVMe page cache and is not transferable.

That is the answer to #295's question 4, and it is worse than the ticket feared. **The cold start is
not the machine and it is not Node — it is the browser binary coming off a throttled disk.** It is
also the only cost here that the owner will actually feel, because it lands on the press the map
cares about: *"the moment he presses approve."*

Note `halfer`'s 7.5s figure is a plain Node crawler on **our exact current machine** — so even today,
with no browser at all, a cold start is already several seconds.

### The mitigations, honestly priced

**1. Keep one machine warm — `min_machines_running = 1`.** The only mitigation that actually works.
> "To keep one or more Machines running all the time in your primary region, set
> `min_machines_running` to `1` or higher." — https://docs.fly.io/launch/autostop-autostart/

That machine is then permanently in `started` state and billed at the full per-second rate:

| Warm at | Cost in `sin` |
|---|---|
| 1GB | **$7.23/month** |
| 2GB | **$13.58/month** |

This is the real decision. Note it also **erases the "billing follows running seconds" saving** — a
warm machine runs 720 hours a month by definition, which is the row where the upgrade costs its full
sticker price.

**2. `auto_stop_machines = "suspend"` — eligible, but it does not solve this.**
> "Suspending a Machine pauses the Machine and takes a snapshot of its state, including its memory.
> The next start operation will **attempt (but is not guaranteed)** to resume the Machine from the
> snapshot, rather than performing a cold boot." — https://docs.fly.io/machines/api/machines-resource/

Three reasons not to rely on it:

- **The 2GB ceiling.** Suspend requires *"≤ 2 GB memory"* and is *"not currently recommended for large
  machine memory sizes (> 2 GB)"*. 1GB and 2GB both qualify — but a machine above the limit *"will
  fall back to autostopping"* **silently**, so choosing 2GB puts us exactly on the boundary.
- **Every deploy destroys the snapshot.** *"deployments rebuild the machine image, which invalidates
  the old snapshot"* — so **the first PDF after every push pays the full cold start**, and this repo
  auto-deploys on every green push to `main`.
- **It was measured not to help for this workload.** In the Chromium thread above, `jaimeiniesta`
  reported it *"still takes 25 seconds"* with suspend.

Also: *"On resume, the machine thinks its network connections are still live. External systems
(databases, APIs) may disagree."* We hold a Postgres connection, so this needs testing before it is
trusted.

**3. Pre-launch the browser at boot / keep one browser process alive.** Documented and correct, but it
fixes the **wrong** cost. It removes the per-request launch, not the per-cold-start binary read.

Playwright documents both halves properly:
- **Contexts are cheap** — `playwright.dev/docs/browser-contexts`: *"They are fast and cheap to create
  and are completely isolated, even when running in a single browser."*
- **And warns against the shortcut we would reach for first** —
  `playwright.dev/docs/api/class-browser`: `browser.newPage()` *"is a convenience API that should only
  be used for the single-page scenarios and short snippets. Production code and testing frameworks
  should explicitly create `browser.newContext()` followed by `browserContext.newPage()` to control
  their exact life times."* ⚠️ **Our probe used `newPage()`** — production code should not.
- Out-of-process reuse via `chromium.launchServer()` → `wsEndpoint()` → `chromium.connect()` is
  documented if a persistent browser outliving the app process is ever wanted.

Measured launch cost this saves: SuperPat45 on puppeteer#8261 reports *"1.5 to 3 seconds are needed
just to launch() chromium and open newPage()"*; a vendor benchmark puts cold browser launch at
400–600ms and a warm render at 50–200ms. ⚠️ That same vendor elsewhere claims a 30–35ms Chromium
process launch, which is not credible and contradicts its own other page — treat all of its figures
with suspicion.

**4. 🚨 The page-cache argument for 2GB over 1GB — the subtle one.** After the first launch the 260 MB
binary is in the kernel page cache and subsequent launches are fast. **But a 1GB machine has to hold
260 MB of binary page cache *plus* ~200 MB of browser RSS *plus* Node *plus* the OS.** Under pressure
the kernel evicts the page cache first — which means **the binary gets re-read off the 8 MB/s disk
again**, and a machine that seemed fine in testing goes slow later under no obvious change. 2GB buys
headroom for the cache, not just for the render. ⚠️ **This is reasoning from the measured binary size
and measured RSS, not a published figure** — but it is the reason to spend the extra $6.35/month if a
machine is kept warm at all.

---

## Does something cheaper dominate? The browserless routes

#295 asks this squarely, because a yes would invalidate ruling 5. **The answer is no** — but two of
the four routes deserved the look, and one is genuinely close.

### Route A — a PDF library that draws the document directly: ruled out

`pdfkit`, `pdf-lib`, `@react-pdf/renderer`, `jspdf`. **Not one of them consumes HTML or CSS.**

- **`pdf-lib` says so in its own README** (and it is *already a devDependency* of `apps/api`, used by
  `test/fixtures/generate.mjs`, so it was the tempting option): *"`pdf-lib` does **not** support the
  use of HTML or CSS when adding content to a PDF. Similarly, `pdf-lib` **cannot** embed HTML/CSS
  content into PDFs."* No text wrapping, no pagination — **we would write the line-breaking engine.**
- **`@react-pdf/renderer` is the trap**, because its style objects look like CSS. It is its own React
  primitives over a Yoga flexbox engine: `Document`/`Page`/`View`/`Text`, no `div`, no `p`, no
  `table`, and `display: flex | none` **only** — no `display:block`, no grid, no tables
  (https://react-pdf.org/styling). Our stylesheet would appear portable and then fail silently.
- **`pdfkit`** has the best typography of the four (*"PDFKit automatically inserts new pages as
  necessary"*, real columns, auto line wrap) but is still imperative draw calls.
- **`jspdf`'s `html()` method is not an exception** — it rasterises via html2canvas, whose own README
  says *"this library is not suitable to be used in nodejs"*. It would produce an **unselectable
  bitmap**, which fails the CV brain's own ATS rule that a PDF *"must be text-based"*
  (`docs/cv-brain/cv-authoring-rules.md`).

**All four mean re-authoring the CV layout in a second language. That is exactly the second layout
this repo has refused**, and the refusal is well-founded in its own history: `lessons.md` records
*"Two renderers exist and they behave differently… Check which one your design is asking to be clever
before you pitch it"*, and ADR-0002 costs a per-element CV section as *"a CV-template change on top of
ADR-0001's cost."* A drawing library does not just duplicate the layout — it duplicates it in a
language where `display:flex`, which our `.role-head` and `.cert` rules depend on, does not exist.

**Verdict: ruled out on the repo's own standing grounds, and independently on ATS grounds for
`jspdf`.**

### Route B — WeasyPrint: the one that genuinely competes, and still loses

**WeasyPrint is the only browser-free engine that consumes our actual HTML and CSS**
(https://doc.courtbouillon.org/weasyprint/stable/). It is not a browser: *"The CSS layout engine is
written in Python, designed for pagination."* Its print-CSS support is the best of anything on the
list — `@page` and margin boxes, `break-before`/`break-after`/`break-inside`, orphans and widows,
`@font-face`, tables, floats, multi-column, and *"All flex-*, align-*, justify-* and order properties
are supported"* (which our stylesheet needs).

On paper it dominates: no 260 MB binary, so no 33-second disk read, so **no cold-start problem**.

**Three reasons it still loses:**

1. **It is Python, and there is no Node binding.** It means a Python + Pango layer in a Node image
   plus a subprocess or an internal HTTP hop. ⚠️ I could not compute a trustworthy installed-size
   figure for it: my dependency-closure method exploded to 895 MB through `python3-pil` →
   `python3-scipy` → OpenBLAS → Boost/GCC, which real apt would not do. **That number is wrong and is
   not reported here.** The `weasyprint` package itself is 1.1 MB; the honest statement is that the
   real cost is Python + Pango + Pillow + fontTools and **nobody has measured it for us.**
2. **Debian bookworm ships WeasyPrint 57.2 — current is 70.** Three years behind. The flexbox support
   quoted above is documented for the **current** version, and our role header depends on flexbox. Apt
   gives 57; getting 70 means pip, which means Python build tooling in the image. ⚠️ **Whether 57.2's
   flexbox renders our `.role-head` correctly is unverified** and would have to be tested.
3. **It is a second rendering engine, which is the same objection as Route A wearing a disguise.**
   Not a second *layout* — the HTML and CSS are shared, which is genuinely better than Route A — but
   a second engine that will disagree with Chromium about our page in ways nobody predicts. The screen
   shows the draft in a browser (ruling 8: *"The draft is on screen"*), so **the preview would be
   Blink and the PDF would be Python**, and the two would drift. That is the same failure this repo
   already refused, one level down.

**Verdict: the strongest alternative, and worth revisiting if cold start becomes intolerable.**
Recorded here rather than dismissed — see [What was left open](#what-was-left-open).

### Route C — an external HTML-to-PDF API: ruled out on the document, not the price

Cheap, and all of them take raw HTML in the POST body (which we need, since the HTML is generated
server-side behind auth): Api2Pdf ≈ $0.69–1.59 per 1,000; Browserless $1.25; Urlbox $9.50; PDFShift
$18.00 at entry. Free tiers exist (Browserless 1,000/month, PDFShift 50, HTMLCSStoImage 50).

**Ruled out because of what gets sent.** The payload is **a named individual's full CV** — name,
phone, email, employer history. Sending that to a third party for a product whose whole current scope
is one real user is a data decision the owner has not been asked to make, for a saving of fractions of
a cent. Retention makes it worse: **Urlbox caches for 30 days by default**; HTMLCSStoImage publishes
**nothing** on retention and returns results via its own CDN; PDFShift does not address retention of
the submitted HTML at all. Only DocRaptor publishes an immediate-erase setting — and it is **opt-in**,
and it is the most expensive of the set at $120/1,000 at entry.

The region choice compounds it: `fly.api.toml` puts the API in `sin` with the comment *"Region per
JC-4's data-residency note"* — this repo has already made a deliberate data-residency decision, and
routing CVs through a US SaaS quietly undoes it.

**Verdict: ruled out. Revisit only with a data-processing decision made first, not as an
optimisation.**

### Route D — Gotenberg, Paged.js, wkhtmltopdf, Prince, Typst: all ruled out

- **Gotenberg wraps Chromium.** It moves the browser to another container, not out of our
  infrastructure — same memory, same cold start, one network hop away, and now two things to deploy.
- **Paged.js runs *inside* a browser** — its CLI is *"Command line interface to render out PDFs of HTML
  files **using Puppeteer**"*. It polyfills print CSS; Chromium still does the layout.
- **wkhtmltopdf is archived** (*"This repository was archived by the owner on Jan 2, 2023"*), built on
  a Qt WebKit with no updates since 2012, and carries its own warning: *"Do not use wkhtmltopdf with
  any untrusted HTML."* Its own site now recommends WeasyPrint or Prince.
- **Prince costs USD $3,800 per server licence.** The free tier stamps a logo on page one — *"You are
  not allowed to remove the logo"* — plus mandatory link-backs. **Unusable for a CV.**
- **Typst has no HTML input at all.** Its HTML *export* is *"still very incomplete… Do not use this
  feature for production use cases."* It would mean re-authoring the CV in Typst syntax — Route A
  again.

---

## What is now owed to the owner

Everything below is a decision, not a task.

1. **Scale the machine — approval required.** `shared-cpu-1x` 256MB → **1GB minimum, 2GB
   recommended**. `SHARED_INFRA.md` rule 7 puts scaling behind the owner's explicit approval because
   both projects share the account. Real cost at this app's duty cycle: **~$0.03–0.08/month.** The
   256MB machine cannot run a browser and will **crash the whole API** if asked to (Fly: *"If your app
   OOMs, the Machine crashes and health checks fail by definition"*). Prefer declaring it in
   `fly.api.toml` over a bare `fly scale`, so the size is reviewable — and update `SHARED_INFRA.md`'s
   inventory when it lands.

2. **🚨 Decide the cold start, because code cannot fix it.** The first PDF after an idle spell will
   take **tens of seconds** — Fly's own users measured 15–30s for this exact workload on better
   machines than ours. Three options, and the owner has to pick:
   - **Pay $7.23/month** (1GB warm) or **$13.58/month** (2GB warm) for `min_machines_running = 1`.
     This is the only thing that actually works, and it cancels the per-second billing saving.
   - **Accept it** and design the wait honestly — which collides with ruling 6's *"Approving **is**
     sending — one press, not two"*, because that press now hangs for half a minute.
   - **Try `suspend`** — free, eligible at ≤2GB, but invalidated by every deploy (and this repo
     deploys on every green push), and one Fly user measured no improvement for Chromium.

3. **Note what ruling 5 quietly assumed.** *"It reuses the renderer we already own"* is true of the
   content and **false of the print layout**: there is no `@page`, no `break-inside`, no
   `print-color-adjust`, and the container has **none of the three fonts the CSS asks for.** Smaller
   than a second layout, but not zero — and the font gap in particular would otherwise have silently
   corrupted #156's page measurement.

**Ruling 5 is not invalidated.** It should be annotated: the browser is right, the machine must grow
first, and the cold start is a product decision that was not on the map.

---

## What was left open

- **`fly machines list` was denied to the research agent**, so the machine's size came from the owner
  rather than from a command this document ran. Everything downstream of it is computed on that
  figure.
- **No measured RSS on Linux/Fly.** Our 201 MB is a Windows working set. The real figure should be
  taken with `fly ssh console -C 'free -m'` during a render once the machine is scaled.
- **`/dev/shm` on a Fly machine of our size is inferred**, not documented. One command settles it:
  `fly ssh console -C 'df -h /dev/shm'`.
- **`--ipc=host` has no `fly.toml` equivalent** that this research found. If Chromium proves unstable,
  this is the first thing to investigate.
- **WeasyPrint's real installed size is unmeasured**, and whether Debian's WeasyPrint 57.2 renders our
  flexbox role header is untested. Both matter only if the cold start proves intolerable — at which
  point Route B is the thing to re-open, not Route A or C.
- **No `docker build` was run**, so the ~355 MB image growth is a sum of measured parts, not a measured
  image. A single `docker images` after a real build would confirm it.
- **The two-page measurement used a representative draft**, not one of the owner's real cv-factory
  runs. It used the real renderer and the real CSS at the repo's own documented density (24 bullets)
  and came out at exactly 2 pages — but #156's *"~24-bullets figure confirmed or corrected"*
  criterion deserves the real documents once a PDF route exists.

---

## Sources

**Measured in this session** — `storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/linux64/`
· `deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz` ·
`hub.docker.com/v2/repositories/library/node/tags/` · the repo's own
`node_modules/.pnpm/playwright-core@1.61.1/` (`browsers.json`, `lib/coreBundle.js`,
`types/types.d.ts`) · `apps/api/dist/preview.js`, `apps/api/src/preview.ts`,
`apps/api/src/extract.ts`, `apps/api/package.json`, `fly.api.toml`, `Dockerfile`,
`.github/workflows/ci.yml`

**Fly.io** — https://docs.fly.io/about/pricing/ · /about/billing · /about/free-trial/ ·
/reference/configuration/ · /reference/suspend-resume/ · /launch/autostop-autostart/ ·
/launch/scale-machine/ · /machines/guides-examples/machine-sizing/ · /machines/api/machines-resource/ ·
/getting-started/troubleshooting/ · /volumes/volume-manage/ · https://fly.io/blog/fly-machines/ ·
https://community.fly.io/t/chromium-takes-too-long-to-initialize/26571 ·
https://community.fly.io/t/how-can-i-run-puppeteer-on-fly-io/5435 ·
https://community.fly.io/t/autosuspend-is-here-machine-suspension-is-enabled-everywhere/20942

**Playwright / Puppeteer / Chromium** — https://playwright.dev/docs/browsers ·
/docs/browsers#chromium-headless-shell · /docs/docker · /docs/docker#alpine · /docs/browser-contexts ·
/docs/api/class-browser · /docs/api/class-page#page-pdf · /docs/intro#system-requirements ·
https://github.com/microsoft/playwright/blob/main/tests/library/pdf.spec.ts ·
.../packages/playwright-core/src/server/registry/nativeDeps.ts ·
.../src/server/registry/index.ts · .../browsers.json ·
https://pptr.dev/guides/docker · /troubleshooting · /troubleshooting#running-on-alpine ·
/guides/headless-modes · /guides/installation ·
https://github.com/puppeteer/puppeteer/blob/main/docker/Dockerfile ·
https://github.com/puppeteer/puppeteer/blob/v1.12.1/docs/troubleshooting.md ·
https://developer.chrome.com/docs/chromium/headless ·
https://developer.chrome.com/blog/chrome-headless-shell ·
https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md ·
https://issues.chromium.org/issues/362301064 · https://crbug.com/715363 ·
puppeteer issues #8261, #5258, #5487, #5416, #10071 · playwright issues #4345, #33566 ·
https://googlechromelabs.github.io/chrome-for-testing/

**Memory** — https://github.com/Sparticuz/chromium ·
https://docs.browserless.io/enterprise/docker/best-practices ·
/enterprise/private-deployment/performance ·
https://www.browserless.io/blog/observations-running-headless-browser ·
https://github.com/sambaiz/puppeteer-lambda-starter-kit ·
https://www.kernel.org/doc/html/latest/filesystems/tmpfs.html

**Browserless alternatives** — https://doc.courtbouillon.org/weasyprint/stable/ ·
/stable/api_reference.html · /stable/first_steps.html · https://pdf-lib.js.org/ ·
https://github.com/Hopding/pdf-lib · https://react-pdf.org/ · /styling · https://pdfkit.org/ ·
https://github.com/parallax/jsPDF · https://github.com/niklasvh/html2canvas ·
https://gotenberg.dev/docs/getting-started/introduction · https://pagedjs.org/ ·
https://wkhtmltopdf.org/status.html · https://www.princexml.com/purchase/ · /purchase/license_faq/ ·
https://typst.app/docs/reference/html/ · https://pkgs.alpinelinux.org/package/v3.22/community/x86_64/chromium

**Hosted APIs** — https://www.api2pdf.com/pricing/ · https://www.browserless.io/pricing ·
https://docs.browserless.io/rest-apis/pdf · https://pdfshift.io/pricing ·
https://docs.pdfshift.io/api-reference/convert-to-pdf.md · https://docraptor.com/plans ·
/documentation/api · /security-and-privacy · https://urlbox.com/pricing · /security · /docs/options ·
https://htmlcsstoimage.com/pricing · https://docs.htmlcsstoimage.com/getting-started/using-the-api/ ·
https://www.pdfmonkey.io/pricing · https://pdfmonkey.io/docs/api/documents/ ·
https://cloudconvert.com/pricing · /api/v2/import
