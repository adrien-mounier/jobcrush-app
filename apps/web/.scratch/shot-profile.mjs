import { chromium } from "@playwright/test";
import { pathToFileURL } from "url";

const OUT = "C:/Users/adrie/AppData/Local/Temp/claude/C--Users-adrie-AI-Projects-jobcrush-app/60400e99-3888-486e-9a22-849bb0a26b3f/scratchpad";
const FILE = "C:/Users/adrie/AI/Projects/jobcrush-app/apps/web/prototypes/profile-desktop-options.prototype.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", m => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text()); });
page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
await page.goto(pathToFileURL(FILE).href);
await page.waitForTimeout(1500);

const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });

// A sorted
await shot("A-sorted");
// A sorted with a fact selected
await page.locator(".chip").first().click();
await page.waitForTimeout(400);
await shot("A-sorted-selected");
// A sky
await page.locator('.seg button[data-view="sky"]').click();
await page.waitForTimeout(1600);
await shot("A-sky");

// B sorted
await page.locator('.switcher button[data-v="B"]').click();
await page.waitForTimeout(600);
await shot("B-sorted-top");
await page.locator(".vB").evaluate(el => el.scrollTo(0, el.scrollHeight));
await page.waitForTimeout(400);
await shot("B-sorted-bottom");
// B sky
await page.locator('.seg button[data-view="sky"]').click();
await page.waitForTimeout(1600);
await shot("B-sky");

// C
await page.locator('.switcher button[data-v="C"]').click();
await page.waitForTimeout(1800);
await shot("C-sky");
await page.locator("#sortbtn").click();
await page.waitForTimeout(600);
await shot("C-sorted-overlay");

await browser.close();
console.log("done");
