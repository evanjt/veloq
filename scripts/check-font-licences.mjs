#!/usr/bin/env node
// Guard the typeface files the app embeds.
//
// The SIL Open Font License lets a font ship inside an app only with the
// licence text distributed alongside it, so a font file added under
// `assets/fonts/` without its licence is a distribution the licence does not
// grant. And the `expo-font` plugin in `app.json` copies the files it names
// into both native projects at prebuild, so a path it names that the tree does
// not hold fails the native build on a machine nobody is watching.
//
// So, read from the tree:
//   every .ttf or .otf under assets/fonts/  has <Family>-OFL.txt beside it,
//                                           the family being the name before
//                                           the first hyphen, carrying the OFL
//   every font path the expo-font plugin names, on either platform, is a font
//   file under assets/fonts/
//
// Usage: node scripts/check-font-licences.mjs [--root DIR]

import { posix, resolve } from 'node:path';

import { trackedText, treeSources } from './lib/indexedSources.mjs';

const FONT_DIR = 'assets/fonts';
const FONT_FILE = /\.(ttf|otf)$/i;
const OFL_TITLE = /SIL OPEN FONT LICENSE/i;

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg === -1 ? '.' : process.argv[rootArg + 1]);

const problems = [];
const sources = treeSources(root, [FONT_DIR]);
const fonts = [...sources.keys()].filter((file) => FONT_FILE.test(file)).sort();

for (const font of fonts) {
  const name = posix.basename(font);
  const family = name.replace(FONT_FILE, '').split('-')[0];
  const licence = posix.join(posix.dirname(font), `${family}-OFL.txt`);
  const text = sources.get(licence);
  if (!text) {
    problems.push(`${font} has no ${licence} beside it`);
  } else if (!OFL_TITLE.test(text.toString('utf8'))) {
    problems.push(`${licence} does not carry the SIL Open Font License text`);
  }
}

/** Every font path the `expo-font` plugin entry names, as tree paths. */
function pluginFontPaths() {
  const text = trackedText(root, 'app.json');
  if (text === undefined) return [];
  const plugins = JSON.parse(text)?.expo?.plugins ?? [];
  const entry = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-font');
  if (!entry) return [];
  const props = entry[1] ?? {};
  const listed = [
    ...(props.fonts ?? []),
    ...(props.ios?.fonts ?? []),
    ...(props.android?.fonts ?? []),
  ];
  return listed.flatMap((font) =>
    typeof font === 'string' ? [font] : (font?.fontDefinitions ?? []).map((d) => d.path)
  );
}

const shipped = new Set(fonts);
for (const path of pluginFontPaths()) {
  const file = posix.normalize(String(path));
  if (!shipped.has(file)) {
    problems.push(
      `app.json's expo-font plugin names ${path}, which is not a font under ${FONT_DIR}/`
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-font-licences: ${problem}`);
  process.exit(1);
}
