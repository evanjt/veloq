#!/usr/bin/env node

// Regenerates the bundled basemap assets. The sprite and the Latin glyph
// ranges are byte-identical for every install and a map without them draws no
// icons and no labels, so they ship in the app rather than being fetched once
// per device.
//
// The bytes are written as the files the platform interceptor serves, under
// `modules/veloqrs/assets/basemap`, which Android packages as assets and iOS
// as a resource bundle.
//
// Every label stack is Manrope with a Noto face behind it for what Manrope
// lacks. Each bundled range file is the Noto range from the glyph host followed
// by the Manrope range rendered from `assets/fonts`, and the renderer keeps the
// last glyph it reads for a code point, so Manrope draws wherever it has one.
// The Manrope ranges are rendered by `build_pbf_glyphs`
// (`cargo install build_pbf_glyphs`), named by GLYPH_BUILDER or found on PATH.
//
// The glyph set is deliberately partial. Every range of the Noto faces is
// 104 MB, which is CJK. The ranges below cover Latin, Latin Extended
// Additional and General Punctuation. Rust fetches any other range of the Noto
// face on a miss.

import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'modules/veloqrs/assets/basemap');

const ORIGIN = 'https://tiles.openfreemap.org';
const SPRITE_DIR = 'sprites/ofm_f384';
const SPRITE_FILES = ['ofm.json', 'ofm.png', 'ofm@2x.json', 'ofm@2x.png'];
// Each label stack, its Manrope file and its Noto fallback, as
// `src/features/maps/lib/bundledGlyphs.ts` names them.
const STACKS = [
  { face: 'Manrope Regular', file: 'Manrope-Regular', fallback: 'Noto Sans Regular' },
  { face: 'Manrope Bold', file: 'Manrope-Bold', fallback: 'Noto Sans Bold' },
];
const FONT_DIR = join(root, 'assets/fonts');
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447'];

const FLOOR_DIR = join(root, 'modules/veloqrs/rust/veloqrs/floor');
const FLOOR_TILES = ['0/0/0', '1/0/0', '1/0/1', '1/1/0', '1/1/1'];

async function fetchBytes(path) {
  const url = path.startsWith('https://') ? path : `${ORIGIN}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`${url}: empty`);
  return bytes;
}

async function download(path) {
  const target = join(outDir, path);
  mkdirSync(dirname(target), { recursive: true });
  const bytes = await fetchBytes(path);
  writeFileSync(target, bytes);
  return bytes.length;
}

// The z0-1 ground the engine answers when the store holds nothing, from the
// planet run the vector TileJSON names today. Its segment is kept beside the
// bytes so the vintage is known.
async function fetchFloor() {
  const tilejson = JSON.parse((await fetchBytes('planet')).toString('utf8'));
  const template = tilejson.tiles[0];
  const segment = template.match(/planet\/([^/]+)\/\{z\}/)?.[1];
  if (!segment) throw new Error(`no snapshot segment in ${template}`);
  rmSync(FLOOR_DIR, { recursive: true, force: true });
  let total = 0;
  for (const tile of FLOOR_TILES) {
    const sources = [
      ['openmaptiles', template.replace('{z}/{x}/{y}', tile), 'pbf'],
      ['ne2_shaded', `${ORIGIN}/natural_earth/ne2sr/${tile}.png`, 'png'],
    ];
    for (const [dir, url, ext] of sources) {
      const bytes = await fetchBytes(url);
      const target = join(FLOOR_DIR, dir, `${tile}.${ext}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      total += bytes.length;
    }
  }
  writeFileSync(join(FLOOR_DIR, 'SNAPSHOT'), `${segment}\n`);
  console.log(`ground floor ${total} B from planet ${segment}`);
}

// The Manrope ranges, rendered as signed distance fields into a scratch
// directory holding one subdirectory per font file.
function renderManrope() {
  const scratch = mkdtempSync(join(tmpdir(), 'manrope-glyphs-'));
  const fonts = join(scratch, 'in');
  const out = join(scratch, 'out');
  mkdirSync(fonts);
  mkdirSync(out);
  for (const { file } of STACKS)
    copyFileSync(join(FONT_DIR, `${file}.ttf`), join(fonts, `${file}.ttf`));
  const builder = process.env.GLYPH_BUILDER ?? 'build_pbf_glyphs';
  const run = spawnSync(builder, [fonts, out], { stdio: 'inherit' });
  if (run.error || run.status !== 0) {
    throw new Error(`${builder} failed: install it with cargo install build_pbf_glyphs`);
  }
  return out;
}

async function main() {
  await fetchFloor();
  // Only the two directories written here: the map renderer sits beside them
  // and is scripts/fetch-maplibre-renderer.mjs's to replace.
  rmSync(join(outDir, 'sprites'), { recursive: true, force: true });
  rmSync(join(outDir, 'fonts'), { recursive: true, force: true });

  let spriteBytes = 0;
  for (const file of SPRITE_FILES) {
    spriteBytes += await download(`${SPRITE_DIR}/${file}`);
  }
  const manrope = renderManrope();
  let glyphBytes = 0;
  for (const { face, file, fallback } of STACKS) {
    const dir = join(outDir, 'fonts', `${face},${fallback}`);
    mkdirSync(dir, { recursive: true });
    for (const range of RANGES) {
      const bytes = Buffer.concat([
        await fetchBytes(`fonts/${fallback}/${range}.pbf`),
        readFileSync(join(manrope, file, `${range}.pbf`)),
      ]);
      writeFileSync(join(dir, `${range}.pbf`), bytes);
      glyphBytes += bytes.length;
    }
  }
  rmSync(dirname(manrope), { recursive: true, force: true });
  console.log(
    `sprite ${spriteBytes} B, ${STACKS.length} stacks x ${RANGES.length} ranges, ${glyphBytes} B written`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
