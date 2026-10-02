// Repro for "can't upload any CV in PDF": drive the current front-door CV path with a
// real PDF through the browser and observe whether the upload→read→success path
// completes or surfaces an error. Captures page errors plus upload/job network failures as evidence;
// expected anonymous-auth 401s from unrelated requests are not upload failures.
import { fileURLToPath } from 'node:url';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3015';
const PDF = process.env.PDF ?? fileURLToPath(new URL('../../api/test/fixtures/clean.pdf', import.meta.url));

const qa = await createSession('pdf-upload', { baseURL: BASE });
const { page } = qa;
const failures = [];

page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (/\/api\/(uploads|jobs)/.test(u)) failures.push(`requestfailed: ${u} — ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  const u = r.url();
  if (/\/api\/(uploads|jobs)/.test(u) && r.status() >= 400) failures.push(`response: ${r.status()} ${u}`);
});

try {
  await qa.goto('/', 'front door loads');
  // Tap-to-finish the typewriter so the invitation reveals immediately, then open
  // the current source chooser and choose the supported CV path.
  await page.mouse.click(10, 10);
  await qa.note('tap-to-finish reveals the invitation');
  await qa.click(page.getByRole('button', { name: 'Ready?' }), 'open the source chooser');
  await qa.expectVisible(
    page.getByRole('heading', { name: 'Can something you already have help?' }),
    'the source chooser opens on the front door',
  );

  await qa.click(page.getByRole('button', { name: /Use my CV/ }), 'choose "Use my CV"');

  // Set the PDF on the hidden input opened by the same source action.
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(PDF);
  await qa.note(`set PDF on file input: ${PDF}`);

  // The front door shows "Reading your CV…", then (#325) the job question on a good read, its
  // partly-read screen, or its read/upload error state. Wait generously for the fake-model mine step.
  const outcomeHandle = await page
    .waitForFunction(
      () => {
        const root = document.querySelector('[data-cv]');
        if (root?.getAttribute('data-view') === 'intent') return 'success';
        if (root?.getAttribute('data-cv') === 'proof') return 'success';
        if (root?.getAttribute('data-cv') === 'error') return 'error';
        return null;
      },
      null,
      { timeout: 90_000, polling: 500 },
    )
    .catch(() => null);
  const outcome = outcomeHandle ? await outcomeHandle.jsonValue() : 'timeout';

  await qa.note(`outcome: ${outcome}`);
  if (outcome !== 'success') {
    failures.push(`upload did not reach success — outcome=${outcome}`);
  }

  // #325: a good read hands straight on to the job question — no facts screen in between.
  await qa.expectVisible(
    page.getByRole('heading', { name: /(What kind of job are you going for|We read part of your CV)/ }),
    'front door moves on to the job question (or says it read part) after a PDF upload',
  );
} catch (err) {
  failures.push(`flow threw: ${err.message}`);
}

if (failures.length) await qa.note(`FAILURES:\n- ${failures.join('\n- ')}`);
await qa.expectText(
  'body',
  failures.length === 0 ? '' : ' -IMPOSSIBLE-',
  failures.length === 0
    ? 'no page, upload-network, job-network, or flow failure was observed'
    : `relevant failures make the HTML report fail too: ${failures.join(' | ')}`,
);
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
