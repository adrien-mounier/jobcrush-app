// JC-11 blob storage. Three drivers behind one interface: in-memory (tests), local disk
// (dev fallback), and R2 (production — S3-compatible presigned PUT). The local drivers
// "presign" the API's own PUT /uploads/:id/content route; R2 presigns the real bucket URL,
// so upload bytes never pass through the API.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface BlobStorage {
  /** Where the browser should PUT the file. Local drivers return an API-relative path. */
  presignPut(key: string): Promise<{ url: string; method: "PUT" }>;
  /** Local-driver ingest (the PUT route calls this); the R2 driver never receives bodies. */
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /**
   * Best-effort: ensure the bucket accepts cross-origin browser PUTs. Only the R2 driver
   * implements this (R2 CORS isn't exposed in the Cloudflare dashboard, so the API sets it
   * via the S3 API on boot). Optional because local/in-memory drivers don't need it.
   */
  ensureCors?(allowedOrigins: string[]): Promise<void>;
}

export class InMemoryBlobStorage implements BlobStorage {
  private blobs = new Map<string, Buffer>();
  async presignPut(key: string) {
    return { url: `/uploads/${key}/content`, method: "PUT" as const };
  }
  async put(key: string, data: Buffer) {
    this.blobs.set(key, data);
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export class R2Storage implements BlobStorage {
  private client: S3Client;
  constructor(private config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async presignPut(key: string) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: 600 },
    );
    return { url, method: "PUT" as const };
  }

  // The browser PUTs straight to the presigned URL; this path only serves tests/tools.
  async put(key: string, data: Buffer) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }

  /**
   * Ensure the bucket allows cross-origin PUT from the web app. R2 CORS isn't configurable
   * from the Cloudflare dashboard, so the API sets it on boot via the S3 API, using the same
   * scoped R2 credentials it already has. PutBucketCors replaces the bucket's CORS config,
   * so this is idempotent across restarts; the env (WEB_URL + R2_CORS_ORIGINS) is the source
   * of truth for allowed origins.
   */
  async ensureCors(allowedOrigins: string[]): Promise<void> {
    if (allowedOrigins.length === 0) return;
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.config.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: allowedOrigins,
              AllowedMethods: ["PUT"],
              AllowedHeaders: ["content-type"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  }
}

/** Pick the blob driver from the environment: R2 when configured, local disk otherwise. */
export function storageFromEnv(uploadDir: string): BlobStorage {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return new R2Storage({
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET ?? "jobcrush-staging",
    });
  }
  return new LocalDiskStorage(uploadDir);
}

export class LocalDiskStorage implements BlobStorage {
  constructor(private rootDir: string) {}
  private path(key: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error(`unsafe blob key: ${key}`);
    return join(this.rootDir, key);
  }
  async presignPut(key: string) {
    return { url: `/uploads/${key}/content`, method: "PUT" as const };
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.path(key), data);
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }
}
