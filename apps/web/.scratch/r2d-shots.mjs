// R2-d — screenshot walk of the round-2 prototype's new rail (throwaway).
// Run: node apps/web/.scratch/r2d-shots.mjs
import { chromium } from '@playwright/test';

const FILE = 'file:///C:/Users/adrie/AI/Projects/jobcrush-app/apps/web/prototypes/profile-desktop.prototype.html';
const OUT = 'C:/Users/adrie/AI/Projects/jobcrush-app/screenshots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const app = page.locator('#app');
const shot = name => app.screenshot({ path: `${OUT}/${name}.png` });

await page.goto(FILE);
await page.waitForTimeout(900);
await shot('r2d-1-rail-default');

// the sky view with the same rail
await page.click('[data-view="sky"]');
await page.waitForTimeout(1300);
await shot('r2d-2-sky-rail');
await page.click('[data-view="sorted"]');
await page.waitForTimeout(400);

// area change -> honest fetching -> Hong Kong, where work rights is honestly open
await page.click('#chg');
await shot('r2d-3-area-options');
await page.click('[data-area="Hong Kong"]');
await page.waitForTimeout(350);
await shot('r2d-4-area-fetching');
await page.waitForTimeout(1800);
await shot('r2d-5-hongkong-rights-unanswered');

// answer it in place — the one original question, re-opened
await page.click('#rightsChange');
await shot('r2d-6-rights-question');
await page.click('[data-rights="yes"]');
await page.waitForTimeout(200);
await shot('r2d-7-rights-answered');

// the family door: re-opens the role question with the answer kept
await page.click('#roleDoor');
await page.waitForTimeout(200);
await shot('r2d-8-role-question');
await page.fill('#rolein', 'business analyst');
await page.click('#roleGo');
await page.waitForTimeout(1900);
await shot('r2d-9-family-analysis');

await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('9 screenshots written to screenshots/r2d-*.png');
