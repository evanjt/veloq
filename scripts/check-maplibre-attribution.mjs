#!/usr/bin/env node
// No map page mounts an attribution control while the bundled renderer is
// below 6.4.1.
//
// Up to 6.4.0 the control's HTML sanitiser lets markup through
// (GHSA-jrc7-96c5-q579), so attribution text reaching a page that shows the
// control runs as script in it. Every page turns the control off and the
// credits are drawn natively, which keeps the path closed. 5.x carries no fix,
// so the rule holds until the renderer moves to 6.4.1 or later, and then this
// guard lets the control through without an edit.
//
// A file that constructs a map has to say `attributionControl: false`, since
// leaving the option out mounts the control. `AttributionControl` by name is a
// control added by constructor.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

// `--root` points the guard at another tree, so the rule itself can be tested.
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);

const RENDERER = 'src/features/maps/assets/maplibreRenderer.generated.ts';
const PAGES = 'src/features/maps';
const SAFE_FROM = [6, 4, 1];

const COMMENT = /^\s*(\/\/|\*|\/\*)/;
const CONSTRUCTS_MAP = /new\s+maplibregl\.Map\s*\(/;
const OFF = /attributionControl\s*:\s*false\b/;
const ON = /attributionControl\s*:(?!\s*false\b)/;
const BY_NAME = /\bAttributionControl\b/;

const rendererText = treeSources(ROOT, [RENDERER]).get(RENDERER)?.toString('utf8');
const version = rendererText?.match(/MAPLIBRE_GL_VERSION = '(\d+)\.(\d+)\.(\d+)'/);
if (!version) {
  console.error(`check-maplibre-attribution: no MAPLIBRE_GL_VERSION in ${RENDERER}.`);
  process.exit(1);
}
const bundled = version.slice(1, 4).map(Number);
const below = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};
if (!below(bundled, SAFE_FROM)) process.exit(0);

const offenders = [];
for (const [file, bytes] of treeSources(ROOT, [PAGES])) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const lines = bytes.toString('utf8').split('\n');
  const code = lines.filter((line) => !COMMENT.test(line));
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;
    if (ON.test(line) || BY_NAME.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  if (code.some((line) => CONSTRUCTS_MAP.test(line)) && !code.some((line) => OFF.test(line))) {
    offenders.push(`${file}: constructs a map without attributionControl: false`);
  }
}

if (offenders.length > 0) {
  console.error(
    `check-maplibre-attribution: the bundled renderer is ${bundled.join('.')}, below ` +
      `${SAFE_FROM.join('.')}, whose attribution control sanitises its HTML safely. ` +
      'Keep the control off on every map page:'
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}
