// JC-12 text extraction: uploaded bytes → one normalized `raw_cv` document (ordered blocks
// with kind + confidence). Scanned-image PDFs (empty text layer) are detected and reported as
// `unparseable` — never OCR-guessed (spec §6); JC-17's paste fallback takes over from there.
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { CvKind } from "./uploads.js";

export type BlockKind = "role" | "education" | "skills" | "contact" | "other";

export interface RawCvBlock {
  kind: BlockKind;
  text: string;
  /** 0.9 = under an explicit section heading; lower = inferred from content. */
  confidence: number;
}

export interface RawCv {
  source: "upload" | "paste";
  status: "ok" | "unparseable";
  fullText: string;
  blocks: RawCvBlock[];
  stats: { roles: number; bullets: number; chars: number; pages: number | null };
}

// A PDF whose whole text layer is shorter than this is treated as a scan.
const SCANNED_PDF_TEXT_THRESHOLD = 100;

export async function extractText(
  data: Buffer,
  kind: CvKind,
): Promise<{ text: string; pages: number | null }> {
  if (kind === "pdf") {
    // pdfjs wants a plain Uint8Array, not a Node Buffer view
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const result = await parser.getText();
      return { text: result.text, pages: result.total ?? null };
    } finally {
      await parser.destroy?.();
    }
  }
  if (kind === "docx") {
    const result = await mammoth.extractRawText({ buffer: data });
    return { text: result.value, pages: null };
  }
  return { text: data.toString("utf8"), pages: null };
}

const HEADINGS: Array<{ kind: BlockKind; re: RegExp }> = [
  { kind: "role", re: /^(professional |work |relevant )?experience\b|^employment( history)?\b|^work history\b/i },
  { kind: "education", re: /^education\b|^qualifications\b|^academic\b/i },
  {
    kind: "skills",
    re: /^(top )?skills\b|^competenc|^technolog|^certifications?\b|^languages?\b|^tools\b/i,
  },
  { kind: "contact", re: /^contact\b/i },
];

function headingKind(line: string): BlockKind | null {
  const t = line.trim().replace(/[:\s]+$/, "");
  if (t.length === 0 || t.length > 40) return null;
  for (const h of HEADINGS) if (h.re.test(t)) return h.kind;
  return null;
}

export const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
// QA #190 blocking: the old `\+?\d...` couldn't START on "(", so a bracketed code like "(852) 1234
// 5678" or "(02) 9000 1000" matched from INSIDE the bracket ("852) 1234 5678") — a mined value
// pointing at words the document never contained (ADR-0004 clause 1a defect). `\(?\+?` admits an
// optional leading "(" (and "(+" for "(+852) …") without widening what counts as digits-and-
// separators after it, so isContact's classifier truth value is unchanged (that span already
// matched before; only the captured start position moves left to include the bracket).
export const PHONE_RE = /\(?\+?\d[\d ()-]{7,}/;
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
const DATE_RANGE_RE = new RegExp(
  `(?:\\b${MONTH}\\s+)?\\b(?:19|20)\\d{2}\\b\\s*(?:[-–—]|to)\\s*` +
    `(?:(?:${MONTH}\\s+)?(?:19|20)\\d{2}\\b|present|now|current)`,
  "i",
);
const BULLET_RE = /^\s*[-*•▪‣·]\s+/;

/** Segment extracted text into ordered blocks. Heuristic by design — the miner does the deep parse. */
export function segment(fullText: string): RawCvBlock[] {
  const lines = fullText.split(/\r?\n/);
  const blocks: RawCvBlock[] = [];
  let current: { kind: BlockKind; confidence: number; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text) blocks.push({ kind: current.kind, text, confidence: current.confidence });
    current = null;
  };

  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) {
      flush();
      current = { kind, confidence: 0.9, lines: [line.trim()] };
    } else {
      if (!current) {
        // preamble before any heading: contact details if we see an email/phone, else header text
        const isContact = EMAIL_RE.test(line) || PHONE_RE.test(line);
        current = { kind: isContact ? "contact" : "other", confidence: isContact ? 0.7 : 0.5, lines: [] };
      } else if (!headingKind(line)) {
        // preamble blocks upgrade to contact the moment an email appears
        if (current.confidence <= 0.7 && current.kind === "other" && EMAIL_RE.test(line)) {
          current.kind = "contact";
          current.confidence = 0.7;
        }
      }
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}

export function buildRawCv(
  source: RawCv["source"],
  text: string,
  pages: number | null,
  kind?: CvKind,
): RawCv {
  const trimmed = text.trim();
  if (kind === "pdf" && trimmed.length < SCANNED_PDF_TEXT_THRESHOLD) {
    return {
      source,
      status: "unparseable",
      fullText: trimmed,
      blocks: [],
      stats: { roles: 0, bullets: 0, chars: trimmed.length, pages },
    };
  }
  const blocks = segment(text);
  const roleText = blocks.filter((b) => b.kind === "role").map((b) => b.text).join("\n");
  const lines = text.split(/\r?\n/);
  return {
    source,
    status: "ok",
    fullText: text,
    blocks,
    stats: {
      roles: (roleText.match(new RegExp(DATE_RANGE_RE.source, "gi")) ?? []).length,
      // ponytail: date-range count as role proxy; the JC-13 miner does the real role parse
      bullets: lines.filter((l) => BULLET_RE.test(l)).length,
      chars: trimmed.length,
      pages,
    },
  };
}

export interface ContactFieldRead {
  value: string;
  /** The exact source words the value was parsed from (ADR-0004 clause 1a). */
  sourceText: string;
}
export interface ContactExtraction {
  phone: ContactFieldRead | null;
  email: ContactFieldRead | null;
}

/** #190: deterministic phone/email parse over the already-tagged contact block(s) — reuses the same
 *  EMAIL_RE/PHONE_RE the block classifier tags a region with, so "tagged as contact" and "parses as
 *  contact" never disagree. No match is an honest absence: never invented, never guessed. */
export function extractContact(blocks: RawCvBlock[]): ContactExtraction {
  const text = blocks
    .filter((b) => b.kind === "contact")
    .map((b) => b.text)
    .join("\n");
  const email = text.match(EMAIL_RE);
  const phone = text.match(PHONE_RE);
  return {
    email: email ? { value: email[0], sourceText: email[0] } : null,
    phone: phone ? { value: phone[0].trim(), sourceText: phone[0].trim() } : null,
  };
}

export async function extractRawCv(data: Buffer, kind: CvKind): Promise<RawCv> {
  const { text, pages } = await extractText(data, kind);
  return buildRawCv("upload", text, pages, kind);
}
