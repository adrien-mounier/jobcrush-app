/* Round-2 confirmation: A's visibility mechanism + C's wording ladders. */
const { chromium } = require("@playwright/test");
const path = require("path");
const FILE = "file://" + path.resolve(__dirname, "../prototypes/chunked-ingestion.prototype.html").replace(/\\/g, "/");
const OUT = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const shot = async (name) => { await page.mouse.move(5, 5); await page.waitForTimeout(250); await page.locator(".phone").screenshot({ path: path.join(OUT, name + ".png") }); };
  const clickText = async (t) => { await page.click(`text="${t}"`, { timeout: 4000 }); await page.waitForTimeout(450); };

  await page.goto(FILE + "?variant=A");
  await shot("v2-a1-plan");
  await clickText("Let's do it");
  await shot("v2-a2-dots");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(700);
  await clickText("Save — 2022");
  await page.waitForTimeout(900);
  await clickText("Next: the basics");
  await page.keyboard.press("Escape"); /* leave sheet? A: leaveNow → saved */
  await page.waitForTimeout(3200);
  await page.click("#i-return");
  await page.waitForTimeout(400);
  await shot("v2-a3-agenda-mid");

  await page.goto(FILE + "?variant=C");
  await shot("v2-c1-draft-home");
  await clickText("Take it on");
  await clickText("Yes — I'm still there");
  await page.waitForTimeout(700);
  await clickText("Save — 2022");
  await page.waitForTimeout(800);
  await clickText("Next: the basics");
  await clickText("Yes — no sponsorship needed");
  await page.waitForTimeout(800);
  await clickText("Next: your freelance year");
  await shot("v2-c2-levelup-draft");
  await clickText("Keep going");
  await page.click("#i-ladder");
  await shot("v2-c3-candidate-home");

  await browser.close();
  console.log("done");
})().catch((e) => { console.error(e.message); process.exit(1); });
