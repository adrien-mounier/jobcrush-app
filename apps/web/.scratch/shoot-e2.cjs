/* Design E confirmation round: desktop frames + fixed phone copy. */
const { chromium } = require("@playwright/test");
const path = require("path");

const FILE = "file://" + path.resolve(__dirname, "../prototypes/chunked-ingestion.prototype.html").replace(/\\/g, "/");
const OUT = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const shot = async (name, sel) => { await page.waitForTimeout(200); await page.locator(sel).screenshot({ path: path.join(OUT, name + ".png") }); };
  const clickText = async (t) => { await page.click(`text="${t}"`, { timeout: 4000 }); await page.waitForTimeout(500); };

  /* desktop A: intro, then answer q1 so the paper fills + flash */
  await page.goto(FILE + "?variant=A&frame=desktop");
  await shot("d-a1-intro", ".desk");
  await clickText("Let's do it");
  await shot("d-a2-q1", ".desk");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(400);
  await shot("d-a3-paper-filling", ".desk");
  await page.waitForTimeout(900);

  /* desktop B: board + paper */
  await page.goto(FILE + "?variant=B&frame=desktop");
  await shot("d-b1-board", ".desk");
  await page.click("#tile-cathay");
  await page.waitForTimeout(500);
  await shot("d-b2-sheet", ".desk");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(400);
  await shot("d-b3-paper-filling", ".desk");

  /* desktop C */
  await page.goto(FILE + "?variant=C&frame=desktop");
  await shot("d-c1-climb", ".desk");

  /* phone re-check of fixed copy */
  await page.goto(FILE + "?variant=B");
  await shot("p-b1-intro-copy", ".phone");
  await page.goto(FILE + "?variant=A");
  await clickText("Let's do it");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(600);
  await page.click("#one-m ~ *", { timeout: 1000 }).catch(() => {});
  await clickText("Save — 2022");
  await page.waitForTimeout(900);
  await shot("p-a5-topicdone-copy", ".phone");

  await browser.close();
  console.log("done");
})().catch((e) => { console.error(e.message); process.exit(1); });
