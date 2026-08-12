const { chromium } = require("@playwright/test");
const path = require("path");
const FILE = "file://" + path.resolve(__dirname, "../prototypes/chunked-ingestion.prototype.html").replace(/\\/g, "/");
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const shot = async (n) => { await p.mouse.move(5, 5); await p.waitForTimeout(250); await p.locator(".phone").screenshot({ path: path.join(OUT, n + ".png") }); };
  await p.goto(FILE + "?variant=A");
  await p.click("#i-finish");
  await p.waitForTimeout(4000);
  await shot("v4-a1-finale");
  await p.click('text="Show me the jobs"');
  await p.waitForTimeout(500);
  await shot("v4-a2-hunt-handoff");
  await b.close();
  console.log("done");
})().catch((e) => { console.error(e.message); process.exit(1); });
