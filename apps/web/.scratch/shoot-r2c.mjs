import { chromium } from '@playwright/test';

const FILE = 'file:///C:/Users/adrie/AI/Projects/jobcrush-app/apps/web/prototypes/profile-desktop.prototype.html';
const OUT = 'C:/Users/adrie/AI/Projects/jobcrush-app/screenshots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1160 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
await page.goto(FILE);
await page.waitForTimeout(600);

const app = () => page.locator('.app');
const shot = async name => {
  await app().screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};
const setStyle = s => page.click(`.switcher [data-style="${s}"]`);
const setScale = n => page.click(`.switcher [data-scale="${n}"]`);
const setView = v => page.click(`[data-view="${v}"]`);

// 1. default: style B, 28 facts, with a grey experience fact selected (detail shows job + "left out for space")
await page.click('text=Chaired a steering committee of nine');
await page.waitForTimeout(200);
await shot('r2c-list-B-28');

// 2. style A (all rows)
await setStyle('A'); await page.waitForTimeout(200);
await shot('r2c-list-A-28');

// 3. style C (lead + chips, the shipped pattern applied naively)
await setStyle('C'); await page.waitForTimeout(200);
await shot('r2c-list-C-28');

// 4. back to B at 6 facts — empty sections never drawn
await setStyle('B'); await setScale(6); await page.waitForTimeout(200);
await shot('r2c-list-B-6');

// 5. B at 200 — top of the list
await setScale(200); await page.waitForTimeout(300);
await shot('r2c-list-B-200-top');

// 6. B at 200 — scrolled into the huge experience cluster
await page.locator('#field').evaluate(el => { el.scrollTop = 1800; });
await page.waitForTimeout(200);
await shot('r2c-list-B-200-mid');

// 7. sky at 28
await setScale(28); await setView('sky'); await page.waitForTimeout(1600);
await shot('r2c-sky-28');

// 8. sky at 200 (lopsided test)
await setScale(200); await page.waitForTimeout(1600);
await shot('r2c-sky-200');

// 9. sky at 6
await setScale(6); await page.waitForTimeout(1600);
await shot('r2c-sky-6');

await browser.close();
console.log('done');
