#!/usr/bin/env node
// The connect page's kit (`web/connect/ui/` and `web/connect/charts/`) sizes its own components,
// so a page stylesheet that names a bare element (`svg`, `section`, `table`, `td`, `th`) styles
// every such element on the page, the kit's included. The page's rules carry a class, and the
// kit's rules are the only ones that reach a drawing or a table.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const KIT = ['web/connect/ui/', 'web/connect/charts/'];
const BARE = /^(svg|section|table|td|th)(?![\w-])/;

const sources = indexedSources(root, ['web/connect']);
refuseEmptyListing(sources, 'Connect page element selector guard');

/** The selector with the contents of `:is()`, `:where()`, `:not()` and `:has()` removed. */
function outerSelector(selector) {
  let text = selector;
  let previous;
  do {
    previous = text;
    text = text.replace(/:(is|where|not|has)\([^()]*\)/g, '');
  } while (text !== previous);
  return text;
}

const failures = [];
for (const [file, bytes] of sources) {
  if (!file.endsWith('.css') || KIT.some((dir) => file.startsWith(dir))) continue;
  const css = bytes
    .toString('utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1].trim();
    if (prelude.startsWith('@')) continue;
    const start = match.index + match[1].length - match[1].trimStart().length;
    const line = css.slice(0, start).split('\n').length;
    const bare = outerSelector(prelude)
      .split(',')
      .some(
        (part) =>
          !part.includes('.') &&
          !part.includes('[') &&
          part
            .split(/[\s>+~]+/)
            .filter(Boolean)
            .some((token) => BARE.test(token))
      );
    if (bare) failures.push(`${file}:${line} ${prelude.replace(/\s+/g, ' ')}`);
  }
}

if (failures.length > 0) {
  console.error(`The connect page's stylesheets name a bare element: ${failures.length}.\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nGive the element a class in the page stylesheet, or draw it with the kit in');
  console.error('web/connect/ui or web/connect/charts, which sizes it.');
  process.exit(1);
}

console.log(
  'Connect page element selector guard: no page stylesheet names a bare svg, section, table, td or th.'
);
