// Text metrics for the store compositor's captions, read straight from the
// bundled font files so a line count can be checked without a browser.
import * as fs from 'node:fs';

export interface Face {
  unitsPerEm: number;
  /** Advance width in font units, or undefined where the face has no glyph. */
  advance(codePoint: number): number | undefined;
}

function table(buf: Buffer, tag: string): number {
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (buf.toString('latin1', at, at + 4) === tag) return buf.readUInt32BE(at + 8);
  }
  throw new Error(`Font has no ${tag} table`);
}

function readCmap(buf: Buffer, cmap: number): Map<number, number> {
  const map = new Map<number, number>();
  const subtables = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const at = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(at);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(at + 6);
      const ends = at + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const offsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = buf.readUInt16BE(ends + s);
        const start = buf.readUInt16BE(starts + s);
        const delta = buf.readInt16BE(deltas + s);
        const offset = buf.readUInt16BE(offsets + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const raw = offset === 0 ? c : buf.readUInt16BE(offsets + s + offset + (c - start) * 2);
          const glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
          if (glyph !== 0) map.set(c, glyph);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g++) {
        const start = buf.readUInt32BE(at + 16 + g * 12);
        const end = buf.readUInt32BE(at + 20 + g * 12);
        const glyph = buf.readUInt32BE(at + 24 + g * 12);
        for (let c = start; c <= end; c++) map.set(c, glyph + (c - start));
      }
    }
  }
  return map;
}

export function loadFace(file: string): Face {
  const buf = fs.readFileSync(file);
  const unitsPerEm = buf.readUInt16BE(table(buf, 'head') + 18);
  const hhea = table(buf, 'hhea');
  const metrics = buf.readUInt16BE(hhea + 34);
  const hmtx = table(buf, 'hmtx');
  const glyphs = readCmap(buf, table(buf, 'cmap'));
  return {
    unitsPerEm,
    advance(codePoint) {
      const glyph = glyphs.get(codePoint);
      if (glyph === undefined) return undefined;
      return buf.readUInt16BE(hmtx + Math.min(glyph, metrics - 1) * 4);
    },
  };
}

// Han, kana, Hangul and full-width forms: the system falls back to a face that
// draws each at one em, and a line may break between any two of them.
function isWide(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

// Marks that may not start a line, so a break is never placed before them.
const NO_LINE_START = new Set('、。，．！？：；）」』】〉》ー'.split(''));

/** The width of text in px at a font size, with letter spacing in em. */
export function textWidth(face: Face, text: string, size: number, letterSpacingEm = 0): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const units = isWide(cp) ? face.unitsPerEm : face.advance(cp);
    if (units === undefined) throw new Error(`No glyph for U+${cp.toString(16)} in "${text}"`);
    width += (units / face.unitsPerEm + letterSpacingEm) * size;
  }
  return width;
}

/**
 * The lines a greedy wrap gives text in a box: breaks at spaces, and between
 * any two wide characters. A word longer than the box takes a line of its own
 * and overflows it.
 */
export function wrapLines(
  face: Face,
  text: string,
  size: number,
  boxWidth: number,
  letterSpacingEm = 0
): string[] {
  const units: string[] = [];
  let word = '';
  const flush = () => {
    if (word) units.push(word);
    word = '';
  };
  for (const ch of text.replace(/\s+/g, ' ').trim()) {
    if (ch === ' ') {
      flush();
      units.push(' ');
    } else if (isWide(ch.codePointAt(0) ?? 0) && !NO_LINE_START.has(ch)) {
      flush();
      word = ch;
    } else {
      if (isWide(word.codePointAt(word.length - 1) ?? 0) && !NO_LINE_START.has(ch)) flush();
      word += ch;
    }
  }
  flush();

  const lines: string[] = [];
  let line = '';
  for (const unit of units) {
    const next = line + unit;
    const fits = textWidth(face, next.trimEnd(), size, letterSpacingEm) <= boxWidth;
    if (line === '' || fits) {
      line = next;
    } else {
      lines.push(line.trimEnd());
      line = unit;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
