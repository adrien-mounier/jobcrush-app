// #202 AC3 — mechanical draft of the answer key from the CACHED RAW CV TEXT ONLY.
// No reader output is read here. Splits lines, rejoins page-wraps, flags repeats.
// The judgement (which job owns which block, semantic merges) is applied by hand
// in answer-key-*.md; this file only produces the raw material and the checks.
import { readFileSync } from 'node:fs';

const cvs = JSON.parse(readFileSync(new URL('./cvs.json', import.meta.url), 'utf8'));

const BULLET = /^\s*[·•.•]\s*/;
// A bullet marker followed by a lowercase word is a page-wrap that kept the marker
// (Thomas line 100: "·traverses, poutres de rive").

export function bullets(text) {
  const lines = text.split('\n');
  const out = [];
  let last = -99; // 0-based index of the last line absorbed into a bullet
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const prev = out[out.length - 1];
    const contd = i === last + 1 && prev && !/[.:;]$/.test(prev.text);
    // a wrap can start with a capital ("SIA)" on Thomas line 56) — an unclosed "(" proves it
    const open = prev && (prev.text.split('(').length > prev.text.split(')').length);
    const wraps = (s) => /^[a-zà-ÿ]/.test(s) || (open && /^[^\s]{1,20}[).,]/.test(s));
    if (BULLET.test(raw) && raw.trim().length > 3) {
      const body = raw.replace(BULLET, '').trim();
      // ruling 3: a wrap that kept its bullet marker (Thomas line 100 "·traverses, poutres…")
      if (contd && wraps(body)) {
        prev.text += ' ' + body;
        prev.wrapped.push(i + 1);
      } else {
        out.push({ line: i + 1, text: body, wrapped: [] });
      }
      last = i;
    } else if (contd && wraps(raw.trim())) {
      // ruling 3: unmarked wrap on the immediately following line
      prev.text += ' ' + raw.trim();
      prev.wrapped.push(i + 1);
      last = i;
    }
  }
  return out;
}

export const norm = (s) =>
  s.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9à-ÿ' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

if (process.argv[1]?.endsWith('key-draft.mjs')) {
  for (const name of ['2024-Thomas Chauviere CV.pdf', 'Giuliana_DELRE_Resume V3.pdf']) {
    const b = bullets(cvs[name].text);
    const seen = new Map();
    for (const x of b) {
      const k = norm(x.text);
      seen.set(k, (seen.get(k) || []).concat(x.line));
    }
    console.log(`\n=== ${name} ===`);
    console.log(`printed bullets (wraps rejoined): ${b.length}`);
    console.log(`distinct texts (exact, normalised): ${seen.size}`);
    for (const [k, ls] of seen) if (ls.length > 1) console.log(`  x${ls.length} @${ls.join(',')}  ${k.slice(0, 70)}`);
    console.log('--- all ---');
    for (const x of b) console.log(`${String(x.line).padStart(3)}${x.wrapped.length ? '+' + x.wrapped.join('+') : ''}\t${x.text}`);
  }
}
