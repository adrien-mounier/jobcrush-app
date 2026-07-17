// JC-11 upload rows + server-side type validation. MIME is sniffed from magic bytes
// (file-type), never trusted from the extension or the browser's content-type header.
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadStatus = "pending" | "uploaded" | "rejected";
export type CvKind = "pdf" | "docx" | "txt";

export interface UploadRecord {
  id: string;
  sessionId: string;
  filename: string;
  status: UploadStatus;
  kind: CvKind | null;
  size: number | null;
  rejectReason: string | null;
  createdAt: string;
}

export class InMemoryUploadStore {
  private rows = new Map<string, UploadRecord>();

  create(sessionId: string, filename: string): UploadRecord {
    const row: UploadRecord = {
      id: randomUUID(),
      sessionId,
      filename,
      status: "pending",
      kind: null,
      size: null,
      rejectReason: null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  get(id: string): UploadRecord | null {
    return this.rows.get(id) ?? null;
  }
}

/** Friendly-error strings: the UI shows these verbatim (dev-plan JC-11 AC). */
export const REJECT_MESSAGES = {
  tooBig: "That file is over 10 MB. Please upload a smaller CV (PDF, Word, or plain text).",
  wrongType:
    "That doesn't look like a PDF, Word document, or plain-text file. Please upload your CV as .pdf, .docx, or .txt.",
} as const;

/**
 * Sniff the real file kind from magic bytes. Plain text has no magic bytes: file-type
 * returns undefined, so we accept it only if the buffer decodes as text (no NUL bytes).
 */
export async function sniffCvKind(data: Buffer): Promise<CvKind | null> {
  const detected = await fileTypeFromBuffer(data);
  if (detected?.ext === "pdf") return "pdf";
  if (detected?.ext === "docx") return "docx";
  if (detected) return null; // some other real format (png, zip, exe, legacy .doc…)
  if (data.length === 0 || data.includes(0)) return null;
  return "txt";
}
