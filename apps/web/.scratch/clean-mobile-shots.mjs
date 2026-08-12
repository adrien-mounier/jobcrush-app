// Throwaway: clean phone screenshots of the stacked profile layout for design record #176.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const OUT = process.env.OUT ?? '.';
fs.mkdirSync(OUT, { recursive: true });

const JOB_A = 'IT Project Manager · Veolia';
const JOB_B = 'Senior Consultant · Capgemini';
const MEI = {
  factCount: 12,
  search: { role: 'IT project manager in Hong Kong', family: null, siblingTitles: [], openJobs: null },
  contact: { phone: { value: '+852 1234 5678', origin: 'read' }, email: null },
  location: {
    area: 'Hong Kong',
    workRights: {
      market: 'Hong Kong',
      answer: 'Yes — no sponsorship needed',
      questionId: 'eligibility:work-rights:hong-kong',
      question: 'Can you work in Hong Kong without sponsorship?',
      options: ['Yes — no sponsorship needed', "Not yet — I'd need sponsorship", "I'd rather not say"],
    },
  },
  languagesQuestion: {
    questionId: 'eligibility-languages',
    question: "Which of these can you work in professionally? Anything you leave unticked, I'll treat as a no.",
    consequence: 'A no takes jobs that require that language out of your deck.',
    options: ['English', 'Mandarin', 'Cantonese', 'Vietnamese', 'Ask me later'],
    answer: ['English', 'Mandarin'],
  },
  domains: [
    { tag: 'profile', heading: 'About you', facts: [{ id: 'p1', text: 'Based in Hong Kong, open to hybrid work.', colour: 'gold', source: 'told', job: null }] },
    {
      tag: 'experience', heading: 'Professional Experience', facts: [
        { id: 'a1', text: 'Ran the SAP S/4HANA cutover across three manufacturing sites.', colour: 'gold', source: 'told', job: JOB_A },
        { id: 'a2', text: 'Coordinated vendor contracts across three markets.', colour: 'grey', source: 'read', job: JOB_A },
        { id: 'b1', text: 'Delivered a treasury reporting platform for a regional bank.', colour: 'gold', source: 'told', job: JOB_B },
        { id: 'b2', text: 'Built the delivery governance pack used by four teams.', colour: 'grey', source: 'told', job: JOB_B },
      ],
    },
    { tag: 'skill', heading: 'Skills', facts: [
      { id: 's1', text: 'SQL.', colour: 'gold', source: 'told', job: null },
      { id: 's2', text: 'Jira.', colour: 'gold', source: 'read', job: null },
      { id: 's3', text: 'Excel.', colour: 'grey', source: 'read', job: null }] },
    { tag: 'cert', heading: 'Certifications', facts: [{ id: 'c1', text: 'PMP.', colour: 'gold', source: 'told', job: null }] },
    { tag: 'lang', heading: 'Languages', facts: [{ id: 'l1', text: 'Fluent in English and Mandarin.', colour: 'gold', source: 'read', job: null }] },
    { tag: 'edu', heading: 'Education', facts: [{ id: 'd1', text: 'MBA, INSEAD.', colour: 'gold', source: 'told', job: null }] },
  ],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (r) => r.fulfill({ json: MEI }));
await page.route('**/api/onboarding/cards', (r) => r.fulfill({ json: { cards: [], checkpoint: 'cards_ready' } }));

const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}` }); console.log(name); };
const scrollTo = (t) => page.evaluate((y) => { const s = document.querySelector('.stage'); if (s) s.scrollTop = y; }, t);

await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('mobile-rail-hero-and-location.png');

await scrollTo(430);
await shot('mobile-rail-job-family-and-contact.png');

await scrollTo(99999);
await shot('mobile-rail-bottom.png');

// The facts sheet, pulled up.
await scrollTo(0);
const sheet = page.getByRole('button', { name: /Your facts/ });
if (await sheet.count()) { await sheet.click(); await page.waitForTimeout(900); }
await shot('mobile-list-top.png');
await page.evaluate(() => { const s = document.querySelector('#profileview'); if (s) s.scrollTop = 380; });
await shot('mobile-list-jobs-and-chips.png');

await page.getByRole('button', { name: 'Constellation' }).click();
await page.waitForTimeout(1600);
await shot('mobile-constellation.png');

await page.setViewportSize({ width: 360, height: 800 });
await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('mobile-rail-360-stacked.png');

await browser.close();
