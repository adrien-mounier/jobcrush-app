// Staging-only CORS preflight check for the real R2 presigned-PUT path.
// This exercises the cross-origin OPTIONS request a browser sends before PUTting a CV
// straight to R2. It is NOT wired into `pnpm test` because CI uses InMemoryBlobStorage
// and has no real R2 bucket to preflight against.
//
// Run against staging:
//   BASE_URL=https://jobcrush-api-staging.fly.dev pnpm --filter @jobcrush/web e2e:r2-cors
// Run locally with real R2 creds configured:
//   BASE_URL=http://localhost:3015 pnpm --filter @jobcrush/web e2e:r2-cors

const BASE = process.env.BASE_URL ?? 'http://localhost:3015';
const ORIGIN = process.env.CORS_ORIGIN ?? 'https://jobcrush.org';
const UPLOAD_FILENAME = 'cors-check.pdf';

let cookie = '';

function extractSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of cookies) {
    const m = c.match(/^jc_session=([^;]+)/);
    if (m) return `jc_session=${m[1]}`;
  }
  return null;
}

async function apiFetch(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? res.headers.get('set-cookie') ?? [];
  const sessionCookie = extractSessionCookie(setCookie);
  if (sessionCookie) cookie = sessionCookie;
  return res;
}

async function main() {
  // 1. Create an anonymous session — the upload route requires it.
  const sessionRes = await apiFetch('/api/sessions/anonymous', { method: 'POST' });
  if (!sessionRes.ok) {
    throw new Error(`anonymous session failed: ${sessionRes.status} ${sessionRes.statusText}`);
  }

  // 2. Ask the API for a presigned R2 PUT URL.
  const uploadRes = await apiFetch('/api/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: UPLOAD_FILENAME }),
  });
  if (!uploadRes.ok) {
    throw new Error(`upload create failed: ${uploadRes.status} ${uploadRes.statusText}`);
  }
  const { id, putUrl } = await uploadRes.json();
  if (!putUrl || !putUrl.startsWith('http')) {
    throw new Error(`expected presigned R2 URL (http...), got ${JSON.stringify(putUrl)}`);
  }

  // 3. Send the browser's preflight OPTIONS request to the R2 URL.
  const preflight = await fetch(putUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  const allowedOrigin = preflight.headers.get('access-control-allow-origin');
  const ok = preflight.status === 204 && allowedOrigin === ORIGIN;

  if (!ok) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: CORS preflight for upload ${id}`);
    // eslint-disable-next-line no-console
    console.error(`  status: ${preflight.status} ${preflight.statusText}`);
    // eslint-disable-next-line no-console
    console.error(`  access-control-allow-origin: ${allowedOrigin}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`PASS: CORS preflight for upload ${id}`);
  // eslint-disable-next-line no-console
  console.log(`  status: ${preflight.status}`);
  // eslint-disable-next-line no-console
  console.log(`  access-control-allow-origin: ${allowedOrigin}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
