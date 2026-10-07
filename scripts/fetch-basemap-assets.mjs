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
// The glyph set is deliberately partial. Every range of the three stacks is
// 104 MB, which is CJK. The ranges below are 1.7 MB and cover Latin, Latin
// Extended Additional and General Punctuation. The interceptor answers 404 for
// any other range, which draws as a box.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'modules/veloqrs/assets/basemap');

const ORIGIN = 'https://tiles.openfreemap.org';
const SPRITE_DIR = 'sprites/ofm_f384';
const SPRITE_FILES = ['ofm.json', 'ofm.png', 'ofm@2x.json', 'ofm@2x.png'];
const STACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
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

async function main() {
  await fetchFloor();
  rmSync(outDir, { recursive: true, force: true });

  let spriteBytes = 0;
  for (const file of SPRITE_FILES) {
    spriteBytes += await download(`${SPRITE_DIR}/${file}`);
  }
  for (const stack of STACKS) {
    for (const range of RANGES) {
      await download(`fonts/${stack}/${range}.pbf`);
    }
  }
  console.log(`sprite ${spriteBytes} B, ${STACKS.length} stacks x ${RANGES.length} ranges written`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
