// #202 AC4 — score each prompt sample's RECALL against the answer key.
// The key comes from key-draft.mjs (cached raw CV text only) + the merge groups below,
// which are the ruling-1 semantic judgements. No reader output feeds the key.
import { readFileSync, readdirSync } from 'node:fs';
import { bullets, norm } from './key-draft.mjs';

const HERE = new URL('.', import.meta.url);
const cvs = JSON.parse(readFileSync(new URL('cvs.json', HERE), 'utf8'));

// ---- the answer key -------------------------------------------------------
// Lines NOT under a job (skills / education bullets) are excluded from the bullet key.
// Ruling-1 semantic merges: each array is one fact printed in several wordings.
const KEY = {
  '2024-Thomas Chauviere CV.pdf': {
    exclude: [],
    merges: [[88, 104], [172, 191], [96, 213], [157, 212]],
    jobs: 8, education: 4, certifications: 1, languages: 3,
  },
  'Giuliana_DELRE_Resume V3.pdf': {
    exclude: [61, 62, 63, 64, 65, 66, 68, 77, 78],
    merges: [[22, 27], [26, 35], [34, 42]],
    jobs: 4, education: 1, certifications: 0, languages: 2,
  },
};

export function keyFacts(cv) {
  const spec = KEY[cv];
  const printed = bullets(cvs[cv].text).filter((b) => !spec.exclude.includes(b.line));
  // exact/normalised duplicates collapse first (ruling 1, mechanical half)
  const byText = new Map();
  for (const b of printed) {
    const k = norm(b.text);
    if (!byText.has(k)) byText.set(k, { variants: [], lines: [] });
    byText.get(k).variants.push(b.text);
    byText.get(k).lines.push(b.line);
  }
  let facts = [...byText.values()];
  // then the semantic merges (ruling 1, judgement half)
  for (const group of spec.merges) {
    const hit = facts.filter((f) => group.some((l) => f.lines.includes(l)));
    if (hit.length < 2) continue;
    const merged = { variants: hit.flatMap((f) => f.variants), lines: hit.flatMap((f) => f.lines) };
    facts = facts.filter((f) => !hit.includes(f)).concat([merged]);
  }
  return { printed: printed.length, facts };
}

// ---- matching -------------------------------------------------------------
const STOP = new Set(('de des du la le les un une et en pour sur dans au aux avec par a à l d the of and to for in on with an at as by from is are be').split(' '));
const toks = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

// A key fact is captured if some emitted string contains >=60% of one of its variants'
// content words. Generous by design: recall asks "is the fact anywhere in the output?"
function captured(variants, pool) {
  for (const v of variants) {
    const want = toks(v);
    if (!want.size) continue;
    for (const cand of pool) {
      let hit = 0;
      for (const w of want) if (cand.has(w)) hit++;
      if (hit / want.size >= 0.6) return true;
    }
  }
  return false;
}

const strings = (node, out = []) => {
  if (typeof node === 'string') { if (node.length > 12) out.push(node); }
  else if (Array.isArray(node)) node.forEach((n) => strings(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => strings(n, out));
  return out;
};

const extractJson = (t) => {
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
};

// ---- run ------------------------------------------------------------------
const SLUG = {
  '2024-Thomas Chauviere CV.pdf': '2024_Thomas_Chauviere_CV_pdf',
  'Giuliana_DELRE_Resume V3.pdf': 'Giuliana_DELRE_Resume_V3_pdf',
};
const CELLS = ['batched-rich', 'perdecision-rich', 'perdecision-lean', 'compact'];
const files = readdirSync(new URL('out', HERE));

for (const cv of Object.keys(KEY)) {
  const { printed, facts } = keyFacts(cv);
  console.log(`\n=== ${cv} ===`);
  console.log(`printed bullets: ${printed}   key facts (after ruling 1): ${facts.length}`);
  for (const cell of CELLS) {
    for (const f of files.filter((f) => f.startsWith(`${cell}__${SLUG[cv]}__`)).sort()) {
      const j = JSON.parse(readFileSync(new URL(`out/${f}`, HERE), 'utf8'));
      const parsed = extractJson(j.text);
      if (!parsed) { console.log(`${cell} s${j.sample}: UNPARSEABLE`); continue; }
      const pool = strings(parsed).map(toks);
      const found = facts.filter((x) => captured(x.variants, pool));
      const pct = ((found.length / facts.length) * 100).toFixed(0);
      console.log(
        `${cell.padEnd(17)} s${j.sample}: ${String(found.length).padStart(2)}/${facts.length}  ${pct}%`,
      );
      if (process.argv[2] === '--misses') {
        for (const m of facts.filter((x) => !found.includes(x))) {
          console.log(`      MISS @${m.lines.join('/')}  ${m.variants[0].slice(0, 80)}`);
        }
      }
    }
  }
}
