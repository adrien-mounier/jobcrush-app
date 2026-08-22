// #272 — the honesty check on everything a LOGGED-OUT visitor can reach.
//
// #272 deleted the pre-signup tailored draft. Two shipped surfaces were still selling it, and a
// regression here is silent: nothing else in the suite reads the <title>, the meta description, or
// the wall's lede, so the copy can drift back to promising a draft and every other spec stays
// green. This journey is the guard.
//
// What it asserts, as a human sees it:
//   1. the front door's browser tab + link preview promise reading the CV into facts and matching
//      real jobs — NOT "see your CV tailored in 2 minutes";
//   2. the login wall (reached the real way: a logged-out /deck/<id> that 401s and redirects) says
//      "Save your progress", and its lede offers the facts read from the CV — not a ready draft;
//   3. the words "draft" and "tailored" appear NOWHERE in the visible text of any page a
//      signed-out visitor can reach. Both are true only after sign-up, so before it they are a lie.
//      This is a whole-page sweep, not a selector: new copy is covered the day it is written.
//
// Free + deterministic — the fake-model API, no paid calls:
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next start -p 34190
//   BASE_URL=http://127.0.0.1:34190 node apps/web/e2e/signup-wall-honesty-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:34190';
// Words that are TRUE only behind the wall. Kept as a list so adding one is a one-line change.
const FORBIDDEN = [/\bdrafts?\b/i, /\btailor(ed|ing|s)?\b/i];

const qa = await createSession('signup-wall-honesty', { baseURL: BASE_URL });

/** Visible text of the page — what a person actually reads. Script/style/hidden nodes excluded, so
 *  a framework payload mentioning "draft" in serialized state is correctly ignored. */
const visibleText = () =>
  qa.page.evaluate(() => {
    const walk = document.createElement('div');
    walk.innerHTML = document.body.innerHTML;
    walk.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());
    return (walk.textContent || '').replace(/\s+/g, ' ').trim();
  });

async function sweep(where) {
  const text = await visibleText();
  const hits = FORBIDDEN.flatMap((re) => {
    const m = text.match(new RegExp(re.source, 'gi'));
    return m ? m : [];
  });
  if (hits.length) {
    await qa.note(`DEFECT — ${where} shows pre-signup words that are not true yet: ${[...new Set(hits)].join(', ')}`);
    return false;
  }
  await qa.note(`${where}: no "draft"/"tailored" promise in the visible copy`);
  return true;
}

let clean = true;

// --- 1. the front door -------------------------------------------------------------------------
await qa.goto('/', 'a visitor arrives at the front door');
await qa.scrollThrough('reads the whole front door the way a person would');

const title = await qa.page.title();
const desc = await qa.page.getAttribute('meta[name="description"]', 'content');
await qa.note(`browser tab + link preview — title: "${title}" · description: "${desc}"`);
if (FORBIDDEN.some((re) => re.test(title) || re.test(desc || ''))) {
  await qa.note('DEFECT — the tab/link preview still sells a tailored draft before sign-up');
  clean = false;
}
if (!/facts/i.test(title) || !/facts/i.test(desc || '')) {
  await qa.note('DEFECT — the tab/link preview no longer says what the product actually does (read the CV into facts)');
  clean = false;
}
clean = (await sweep('the front door')) && clean;

// --- 2. the wall, reached the real way ---------------------------------------------------------
await qa.goto('/deck/any-job-id', 'tries to open a deck while logged out — the server should refuse');
await qa.page.waitForURL(/\/signup/, { timeout: 45_000 });
await qa.note(`the wall caught her — she is now on ${new URL(qa.page.url()).pathname}`);
await qa.scrollThrough('reads the wall before deciding whether to hand over an email');

await qa.expectVisible('h1', 'the wall shows a heading');
await qa.expectText('h1', 'Save your progress', 'the wall asks to save PROGRESS — it promises no finished draft');
await qa.expectText('p.lede', 'facts we read from your CV', 'the lede offers the facts read from the CV, ready to confirm');
clean = (await sweep('the sign-up wall')) && clean;

// The two doors still work — a wall that is honest but broken is no better.
await qa.expectVisible('a[href="/api/auth/google"]', 'Continue with Google is still offered');
await qa.expectVisible('input[type="email"]', 'the email sign-in link door is still offered');

const ok = await qa.finish();
process.exit(ok && clean ? 0 : 1);
