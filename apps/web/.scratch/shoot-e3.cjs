/* Design E register-fix confirmation: every surface, both registers, both frames. */
const { chromium } = require("@playwright/test");
const path = require("path");

const FILE = "file://" + path.resolve(__dirname, "../prototypes/chunked-ingestion.prototype.html").replace(/\\/g, "/");
const OUT = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const park = () => page.mouse.move(5, 5); /* park the cursor so no shot captures a hover state */
  const shot = async (name, sel) => { await park(); await page.waitForTimeout(250); await page.locator(sel).screenshot({ path: path.join(OUT, name + ".png") }); };
  const clickText = async (t) => { await page.click(`text="${t}"`, { timeout: 4000 }); await page.waitForTimeout(450); };

  /* A — light register: teal primaries, teal ticks, light undo toast */
  await page.goto(FILE + "?variant=A");
  await shot("r-a1-intro", ".phone");
  await clickText("Let's do it");
  await shot("r-a2-q1", ".phone");
  await clickText("Stop asking about this");
  await shot("r-a3-stopconfirm", ".phone");
  await clickText("Stop asking");
  await shot("r-a4-undo-toast", ".phone");

  /* B — dark board (gold), light sheet (teal) */
  await page.goto(FILE + "?variant=B");
  await shot("r-b1-board", ".phone");
  await page.click("#tile-cathay");
  await page.waitForTimeout(450);
  await shot("r-b2-sheet", ".phone");

  /* C — dark shell keeps gold; level card gold */
  await page.goto(FILE + "?variant=C");
  await shot("r-c1-home", ".phone");
  await clickText("Take it on");
  await shot("r-c2-sheet", ".phone");

  /* desktop A spot-check */
  await page.goto(FILE + "?variant=A&frame=desktop");
  await clickText("Let's do it");
  await clickText("Yes — I'm still there");
  await shot("r-d-a-paper", ".desk");

  await browser.close();
  console.log("done");
})().catch((e) => { console.error(e.message); process.exit(1); });
