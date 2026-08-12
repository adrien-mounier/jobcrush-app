/* Design E round-1 inspection: drive all three variants through the full journey. */
const { chromium } = require("@playwright/test");
const path = require("path");

const FILE = "file://" + path.resolve(__dirname, "../prototypes/chunked-ingestion.prototype.html").replace(/\\/g, "/");
const OUT = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 980, height: 1080 } });
  const phone = () => page.locator(".phone");
  const shot = async (name) => { await page.waitForTimeout(150); await phone().screenshot({ path: path.join(OUT, name + ".png") }); };
  const click = async (sel) => { await page.click(sel); await page.waitForTimeout(500); };
  const clickText = async (t) => { await page.click(`text="${t}"`, { timeout: 4000 }); await page.waitForTimeout(500); };

  /* ── variant A ── */
  await page.goto(FILE + "?variant=A");
  await shot("a1-intro");
  await clickText("Let's do it");
  await shot("a2-q1");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(900);
  await shot("a3-q2-gain");
  await clickText("Stop asking about this");
  await shot("a4-stop-confirm");
  await clickText("Just not now");
  await clickText("Save — 2022");
  await page.waitForTimeout(900);
  await shot("a5-topicdone");
  await clickText("Next: the basics");
  await shot("a6-basics-q");
  await clickText("I'm done for now — everything's saved");
  await shot("a7-saved");
  await page.waitForTimeout(2700);
  await shot("a8-away");
  await click("#i-return");
  await shot("a9-back");
  await clickText("Pick up where we left off");
  await shot("a10-resumed-exact");

  /* ── variant B ── */
  await page.goto(FILE + "?variant=B");
  await shot("b1-board-intro");
  await click("#tile-cathay");
  await shot("b2-sheet-q1");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(900);
  await shot("b3-sheet-q2-gain");
  await page.click(".sheetveil", { position: { x: 190, y: 40 } }); /* the strip above the sheet → leaveSheet */
  await page.waitForTimeout(500);
  await shot("b4-board-midthought");
  await click("#tile-cathay");
  await shot("b5-resumed-exact");
  await clickText("Save — 2022");
  await page.waitForTimeout(1100);
  await shot("b6-board-tile-lit");
  await click("#i-leave");
  await page.waitForTimeout(2900);
  await click("#i-return");
  await shot("b7-back");

  /* ── variant C ── */
  await page.goto(FILE + "?variant=C");
  await shot("c1-intro-solid");
  await clickText("Take it on");
  await shot("c2-sheet-q1");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(900);
  await clickText("Save — 2022");
  await page.waitForTimeout(900);
  await shot("c3-topicdone");
  await clickText("Next: the basics");
  await clickText("Yes — no sponsorship needed");
  await page.waitForTimeout(900);
  await shot("c4-topicdone-2");
  await clickText("Next: your freelance year");
  await shot("c5-levelup");
  await clickText("Keep going");
  await shot("c6-home-strong");
  await click("#i-leave");
  await page.waitForTimeout(2900);
  await click("#i-return");
  await shot("c7-back-momentum");

  await browser.close();
  console.log("done");
})().catch((e) => { console.error(e.message); process.exit(1); });
