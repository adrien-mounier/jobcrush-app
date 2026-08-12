import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
const file = pathToFileURL("C:/Users/adrie/AI/Projects/jobcrush-app/apps/web/prototypes/tailor-merged.prototype.html").href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(file);
await page.waitForTimeout(2500);
const probe = await page.evaluate(() => ({
  liveScript: !!document.querySelector('script[src*="8400"], script[data-impeccable-live], #impeccable-live'),
  anyImp: [...document.querySelectorAll('*')].filter(e => (e.id + ' ' + e.className).toString().toLowerCase().includes('impeccable')).map(e => e.tagName + '#' + e.id).slice(0, 5),
  shadowHosts: [...document.querySelectorAll('*')].filter(e => e.shadowRoot).map(e => e.tagName).slice(0, 5),
}));
console.log(JSON.stringify({ probe, errors: errors.slice(0, 5) }, null, 2));
await page.screenshot({ path: "C:/Users/adrie/AI/Projects/jobcrush-app/screenshots/live-bar-check.png" });
await browser.close();
