// One-shot: set the CORS rule on the jobcrush R2 bucket so the browser can PUT uploads
// straight to R2 (cross-origin). R2 CORS isn't exposed in the Cloudflare dashboard — only
// Object Lifecycle and Bucket Lock are — so this is the only way to set it short of wrangler.
//
// The API's normal R2 token is object-only (can't PutBucketCors), so run this once with a
// TEMPORARY admin R2 token, then delete that token. The persistent Fly secret stays
// object-scoped to jobcrush-staging — no admin credential lives anywhere permanent.
//
// Usage (from apps/api, with a temp admin R2 token in the env):
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=<temp-admin> R2_SECRET_ACCESS_KEY=<temp-admin> \
//   R2_BUCKET=jobcrush-staging WEB_URL=https://jobcrush.org pnpm set-r2-cors
//
// Allowed origins: WEB_URL plus any comma-separated R2_CORS_ORIGINS. Defaults to
// https://jobcrush.org if neither is set. Trailing slashes are stripped.
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET ?? "jobcrush-staging";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error(
    "Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY. Set them (use a TEMPORARY admin R2 token) and re-run.",
  );
  process.exit(1);
}

const origins = [
  process.env.WEB_URL,
  ...(process.env.R2_CORS_ORIGINS?.split(",") ?? []),
]
  .map((o) => o?.trim().replace(/\/$/, ""))
  .filter((o) => !!o);

if (origins.length === 0) {
  console.error("No allowed origins: set WEB_URL (or R2_CORS_ORIGINS) and re-run.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const CORSConfiguration = {
  CORSRules: [
    {
      AllowedOrigins: origins,
      AllowedMethods: ["PUT"],
      AllowedHeaders: ["content-type"],
      MaxAgeSeconds: 3600,
    },
  ],
};

console.log(`Setting CORS on bucket "${bucket}" to allow PUT from:`);
for (const o of origins) console.log(`  ${o}`);

await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration }));

// Read it back so we never assume PutBucketCors succeeded — the original fd5cef6 bug was
// exactly that: the call was denied every boot, swallowed, and nobody checked.
const res = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
const rules = res.CORSRules ?? [];
console.log("\nCORS config now on the bucket:");
for (const rule of rules) {
  console.log(
    `  origins=${(rule.AllowedOrigins ?? []).join(",")} methods=${(rule.AllowedMethods ?? []).join(",")} headers=${(rule.AllowedHeaders ?? []).join(",")}`,
  );
}
const ok = rules.some(
  (r) =>
    (r.AllowedOrigins ?? []).some((o) => origins.includes(o)) &&
    (r.AllowedMethods ?? []).includes("PUT"),
);
if (!ok) {
  console.error("\nVerification failed: the expected rule is not on the bucket.");
  process.exit(1);
}
console.log("\nDone. You can now delete the temporary admin R2 token.");
