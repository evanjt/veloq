#!/usr/bin/env node
// Every TextView in a widget layout draws the app's face.
//
// A TextView that names no family draws in the phone's own sans, whatever the rest of the widget
// draws in, and nothing on the app's side fails: the launcher simply shows two faces. The widget
// family is a font resource the widget plugin writes, at 400 and 700, so `textStyle="bold"` picks
// the bold file. The configure screens are held to it too, since they are the widget's own
// screens.
//
// The layouts are read from the disk on purpose: a layout is a resource file the build reads as it
// stands, and the test points `--root` at fixture trees that are not repositories.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FAMILY = '@font/widget_manrope';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);
const dir = join(root, 'widget/android/res/layout');

let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
} catch {
  process.exit(0);
}

const found = [];
for (const file of files) {
  const xml = readFileSync(join(dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const [, rest] of xml.matchAll(/<TextView\b([^>]*?)\/?>/g)) {
    const family = rest.match(/android:fontFamily="([^"]*)"/)?.[1];
    if (family === FAMILY) continue;
    const id = rest.match(/android:id="([^"]*)"/)?.[1];
    found.push(
      `${file}: TextView${id ? ` ${id}` : ''} ${family ? `names ${family}` : 'names no family'}, not ${FAMILY}`
    );
  }
}

if (found.length > 0) {
  console.error(found.join('\n'));
  console.error(`${found.length} widget label(s) would draw outside the app's face.`);
  process.exit(1);
}
