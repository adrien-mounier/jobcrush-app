// JC-11 blob storage. R2 is the production target but is blocked on account creation
// (docs/deploy.md), so the interface ships with two drivers: in-memory (tests) and local disk
// (dev). The R2 driver implements presignPut with a real presigned URL; the local drivers
// "presign" the API's own PUT /uploads/:id/content route instead.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface BlobStorage {
  /** Where the browser should PUT the file. Local drivers return an API-relative path. */
  presignPut(key: string): Promise<{ url: string; method: "PUT" }>;
  /** Local-driver ingest (the PUT route calls this); the R2 driver never receives bodies. */
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
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
