#!/usr/bin/env node
// `colors.successFill` (#069E47) measures 3.10:1 on the neutral fill and
// `colors.warningFill` (#BF7A05) 3.09:1. Neither clears the 4.5:1 a text
// colour needs, and both sit on the 3:1 line a graphical object owes. As a
// *fill* they are fine, because the mark on top carries the contrast; as the
// mark itself they are not.
//
// So this guard holds the mark and leaves the ground alone: `color`,
// `iconColor`, `borderColor`, `tintColor` and `tint` fail, `backgroundColor`
// does not. Each tone has a text role for its mark, `successText`,
// `warningText` and `errorText`.
//
// A token routed through a local, a record entry or a name read out of one
// (`const c = ok ? colors.successFill : colors.warningFill`) is followed to the
// `color`, `iconColor` or `tint` it reaches, since the same-line check cannot
// see it. A bare `color={x}` counts only on an icon or text element, because
// on a button it is the fill.
//
// Dark mode is not the problem: `darkColors.successFill` and `.warningFill`
// are light tones on a near-black surface and clear the bar comfortably. It is
// `colors.*`, the light set, that this names.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

const EXEMPT = ['src/theme/colors.ts', 'src/theme/index.ts'];

/** The props that draw a mark, set as an object key or as a JSX prop. */
const MARK_PROP = '(?:color|iconColor|borderColor|tintColor|tint)';

/** A line that sets a mark, read for a fill token written straight into it. */
const PROP = new RegExp(`\\b${MARK_PROP}\\b`);

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

function walk(dir) {
  return tree.files(dir, (rel) => {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((part) => part === '__tests__' || part === '__mocks__'))
      return false;
    if (!/\.tsx?$/.test(name)) return false;
    return !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
  });
}

/**
 * The `darkColors` status tones. These are chosen for a near-black surface, so
 * one read with no theme branch is the same defect in the other direction: the
 * energy card drew the dark warning text (#FBBF24, 2.15:1 on white) in both
 * themes. Only the status tones, not the text ones: a `textLight` or
 * `textSecondaryDark` style is dark-only by convention and applied conditionally,
 * which is correct and is most of what a wider rule would flag.
 */
const DARK_TONE = new RegExp(
  `\\b${MARK_PROP}\\s*[:=]\\s*darkColors\\.(warningText|successText|successFill|warningFill|errorText|dangerFill)\\b`
);

/** A style key ending in `Dark` is a dark-only entry, applied under `isDark`. */
const DARK_KEY = /^\s*([A-Za-z0-9_]+):\s*\{\s*$/;

function unbranchedDarkTones(file, rel) {
  const lines = tree.text(file).split('\n');
  const out = [];
  let key = null;
  lines.forEach((line, i) => {
    const k = line.match(DARK_KEY);
    if (k) key = k[1];
    if (!DARK_TONE.test(line)) return;
    if (/isDark|\?/.test(line)) return;
    if (key && /Dark$/.test(key)) return;
    // A guard a line or two above, the shape `if (isDark && ...) { color = ... }`.
    if (lines.slice(Math.max(0, i - 3), i).some((l) => /isDark/.test(l))) return;
    out.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
  return out;
}

const FILL_TOKEN = /(?<![\w.])colors\.(successFill|warningFill)\b/;
const DECL = /\b(?:const|let|var)\s+([A-Za-z_]\w*)\b[^=]*=\s*(\{)?/;

/**
 * A fill token routed through a name before it reaches a mark: a local
 * (`const c = ok ? colors.successFill : colors.warningFill`), a record entry
 * (`const LEVELS = { ok: colors.successFill }`), or a name read out of either
 * (`const color = LEVELS[level]`). The same-line check cannot see these.
 */
function routedMarks(file, rel) {
  const lines = tree.text(file).split('\n');
  const tainted = new Set();
  let record = null;
  let depth = 0;
  lines.forEach((line, i) => {
    const decl = line.match(DECL);
    if (!record && decl?.[2]) {
      record = decl[1];
      depth = 0;
    }
    if (record) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      const entry = line.match(/^\s*([A-Za-z_]\w*):/);
      if (FILL_TOKEN.test(line) && !/backgroundColor/.test(line)) {
        // Keep the entry's key so a read of another key of the record is clear.
        tainted.add(entry && depth > 0 ? `${record}.${entry[1]}` : record);
      }
      if (depth <= 0) record = null;
      return;
    }
    if (!decl) return;
    const statement = lines
      .slice(i, i + 4)
      .join(' ')
      .split(';')[0];
    if (FILL_TOKEN.test(statement)) tainted.add(decl[1]);
  });
  lines.forEach((line) => {
    const read = line.match(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)/);
    if (read && [...tainted].some((t) => read[2] === t || read[2] === t.split('.')[0])) {
      tainted.add(read[1]);
    }
  });
  const out = [];
  lines.forEach((line, i) => {
    for (const name of tainted) {
      const escaped = name.replace('.', '\\.');
      const asKey = new RegExp(`\\b${MARK_PROP}\\s*:\\s*${escaped}\\b`);
      const asJsx = new RegExp(`\\b(?:iconColor|tintColor|tint)=\\{\\s*${escaped}\\b`);
      // A bare `color={x}` is a fill on a button and a mark on an icon or text.
      const asMarkJsx = new RegExp(`\\bcolor=\\{\\s*${escaped}\\b`);
      const markElement = /Icon|<Text/.test(line);
      const shorthand = new RegExp(`[{,]\\s*(?:color|tint)\\s*[,}]`);
      if (
        asKey.test(line) ||
        asJsx.test(line) ||
        (markElement && asMarkJsx.test(line)) ||
        (name === 'color' && shorthand.test(line))
      ) {
        out.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
        break;
      }
    }
  });
  return out;
}

const failures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (EXEMPT.includes(rel)) continue;
  failures.push(...unbranchedDarkTones(file, rel));
  failures.push(...routedMarks(file, rel));
  const lines = tree.text(file).split('\n');
  lines.forEach((line, i) => {
    if (/backgroundColor/.test(line)) return;
    // A map layer's line is drawn over tiles, not over an app surface, so the
    // surface bar does not describe it and its own item decides its colour.
    if (/'line-color'|'circle-color'|'fill-color'/.test(line)) return;
    // A border washed at a tint step is decoration on a tinted card, not a
    // mark: the text inside it is what has to be legible. Any other alpha is
    // judged as a mark.
    if (/colorWithOpacity\([^)]*opacity\.tint[1-4]\)/.test(line)) return;
    if (!PROP.test(line)) return;
    if (!/colors\.(successFill|warningFill)\b/.test(line)) return;
    if (
      /darkColors\.(successFill|warningFill)\b/.test(line) &&
      !/[^k]colors\.(successFill|warningFill)\b/.test(line)
    )
      return;
    failures.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
}

if (failures.length > 0) {
  console.error(
    `A mark drawn in a token that cannot carry one: ${failures.length}. colors.successFill and colors.warningFill are 3.10:1 and 3.09:1 on the neutral fill.`
  );
  console.error(
    'Use verdictColor(rung, isDark) for a verdict, or colors.successText / colors.warningText for a mark that is not one.\n'
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Mark contrast guard: no icon, border or text drawn in a fill-only token.');
