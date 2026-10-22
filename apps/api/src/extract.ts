// JC-12 text extraction: uploaded bytes → one normalized `raw_cv` document (ordered blocks
// with kind + confidence). Scanned-image PDFs (empty text layer) are detected and reported as
// `unparseable` — never OCR-guessed (spec §6); JC-17's paste fallback takes over from there.
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { CvKind } from "./uploads.js";
import { marketForLocationText } from "./postingRetrieval.js";

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
  // #360: a summary heading ends the preamble, so the letterhead stops at name/title/contact and
  // the summary keeps its own block (whole, for the miner). Anchored on the whole line: "Profile:
  // linkedin.com/…" is a contact line, not a heading.
  { kind: "other", re: /^(?:(?:professional|executive|career|personal) )?(?:summary|profile|objective)$|^about(?: me)?$/i },
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
  /** #310: the CV's own letterhead — the same contact/preamble slice the deleted upload-pipeline
   *  draft caller fed the tailor (preview.ts's old makePreviewStep recipe, byte for byte), captured
   *  here so the draft door can hand the engine a name and city after the raw CV is gone. Empty
   *  string is an honest absence, never invented. */
  header: string;
  /** #381: the letterhead split into the fields Your details shows — read from `header`, each an
   *  honest null when the letterhead has no such line. */
  name: ContactFieldRead | null;
  title: ContactFieldRead | null;
  location: ContactFieldRead | null;
}

/** #404: a spaced hyphen/dash separates parts too; an unspaced one ("Jean-Pierre") is a word. */
const PART_SEP = /\s*[|·•]\s*|\s+[-–—]\s+/;
/** Separator punctuation left at a part's ends once its contact details are taken out. */
const PART_EDGE_RE = /^[\s|·•\-–—,]+|[\s|·•\-–—,]+$/g;
/** "City, Country" — two comma-separated words-only parts. */
const CITY_COUNTRY_RE = /^[^\d@,]{2,40},\s*[^\d@,]{2,30}$/;
const isLocation = (part: string) => CITY_COUNTRY_RE.test(part) || marketForLocationText(part) !== null;
const isLink = (part: string) => /linkedin|https?:|www\./i.test(part);
/** #398/#402: the label a contact detail carries ("Mobile:", "Natel:", "Portable :") — one word and
 *  a colon with nothing after it once the value is taken out — is never a title. A run of them
 *  ("Mobile:  Email:", two contacts on one line with no separator) goes the same way. Only a label
 *  left dangling at the part's end is dropped: a colon inside a title ("Head of Delivery: EMEA") is
 *  a word. No per-language word list. */
const LABEL_TAIL_RE = /(?:^|\s)(?:\S+\s*:\s*)+$/;

/** #381: name = the first line unless it carries contact details; location = the first part that
 *  reads as a place ("City, Country" or a known market); title = the first other part. Parts are
 *  the letterhead's lines split on `|`, `·`, `•` or a spaced dash, with email/phone/links taken out.
 *  ponytail: a title spelled "Director, Operations" reads as a location — widen isLocation with a
 *  place vocabulary if that shows up. */
export function splitLetterhead(header: string): Pick<ContactExtraction, "name" | "title" | "location"> {
  const read = (value: string): ContactFieldRead => ({ value, sourceText: value });
  const lines = header.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0];
  const name = first && !EMAIL_RE.test(first) && !PHONE_RE.test(first) ? read(first) : null;
  const parts = (name ? lines.slice(1) : lines)
    .flatMap((l) => l.split(PART_SEP))
    .map((p) => p.replace(EMAIL_RE, "").replace(PHONE_RE, "").replace(LABEL_TAIL_RE, "").replace(PART_EDGE_RE, ""))
    .filter((p) => /\p{L}/u.test(p) && !isLink(p));
  const location = parts.find(isLocation);
  const title = parts.find((p) => p !== location);
  return { name, title: title ? read(title) : null, location: location ? read(location) : null };
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
  const header = capAtWord(
    blocks
      // #360: the letterhead is the preamble (what sits above the first heading) plus an explicit
      // "Contact" section — never a headed "other" block such as the summary.
      .filter((b) => b.kind === "contact" || (b.kind === "other" && b.confidence < 0.9))
      .slice(0, 2)
      .map((b) => b.text)
      .join("\n"),
    600,
  );
  return {
    email: email ? { value: email[0], sourceText: email[0] } : null,
    phone: phone ? { value: phone[0].trim(), sourceText: phone[0].trim() } : null,
    header,
    ...splitLetterhead(header),
  };
}

/** #360: the letterhead cap never cuts mid-word — a letterhead ending in "Brings ad" is a bug. */
function capAtWord(text: string, max: number): string {
  // One char past the cap: if that char is inside a word, the whole word goes; if it is a space,
  // the word before it was complete and stays.
  return text.length <= max ? text : text.slice(0, max + 1).replace(/\S*$/, "").trimEnd();
}

export async function extractRawCv(data: Buffer, kind: CvKind): Promise<RawCv> {
  const { text, pages } = await extractText(data, kind);
  return buildRawCv("upload", text, pages, kind);
}
