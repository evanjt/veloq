#!/usr/bin/env node
// Every image an Android widget layout draws either says what it shows or is marked as saying
// nothing. TalkBack reads an image with no words as an unlabelled image, so a chart, a route, a
// body or a tone drawn that way is lost to anyone who cannot see it.
//
// An image passes when its layout marks it `importantForAccessibility="no"`, gives it a
// description other than `@null`, or the widget code hands its id to `setContentDescription`,
// directly or through a field of an id holder such as `RowIds(R.id.row0, R.id.dot0)`.
//
// Usage: node scripts/lint-widget-image-labels.mjs [--root DIR]

import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex === -1 ? process.cwd() : process.argv[rootIndex + 1];

const LAYOUTS = /^widget\/android\/res\/layout\/[^/]+\.xml$/;
const CODE = /^widget\/android\/java\/.+\.kt$/;

const sources = treeSources(root, ['widget/android']);
const text = (pattern) =>
  [...sources].filter(([file]) => pattern.test(file)).map(([file, body]) => [file, `${body}`]);
const layouts = text(LAYOUTS);
refuseEmptyListing(new Map(layouts), 'lint-widget-image-labels: widget layouts');
const code = text(CODE)
  .map(([, body]) => body)
  .join('\n');

/** The ids the widget code gives words to at render time. */
function describedIds() {
  const ids = new Set(
    [...code.matchAll(/setContentDescription\(\s*R\.id\.(\w+)/g)].map((match) => match[1])
  );
  const fields = new Set(
    [...code.matchAll(/setContentDescription\(\s*\w+\.(\w+)\s*,/g)].map((match) => match[1])
  );
  for (const holder of code.matchAll(/class\s+(\w+)\s*\(([^)]*)\)/g)) {
    const params = holder[2].split(',').map((param) => /val\s+(\w+)/.exec(param)?.[1]);
    if (!params.some((param) => param && fields.has(param))) continue;
    for (const built of code.matchAll(new RegExp(`\\b${holder[1]}\\(([^()]*)\\)`, 'g'))) {
      built[1].split(',').forEach((arg, i) => {
        const id = /R\.id\.(\w+)/.exec(arg)?.[1];
        if (id && params[i] && fields.has(params[i])) ids.add(id);
      });
    }
  }
  return ids;
}

const described = describedIds();
const failures = [];
for (const [file, xml] of layouts) {
  for (const tag of xml.matchAll(/<ImageView\b([^>]*?)\/?>/gs)) {
    const attrs = tag[1];
    const id = /android:id="@\+id\/(\w+)"/.exec(attrs)?.[1];
    const description = /android:contentDescription="([^"]*)"/.exec(attrs)?.[1];
    if (/android:importantForAccessibility="no"/.test(attrs)) continue;
    if (description && description !== '@null') continue;
    if (id && described.has(id)) continue;
    const line = xml.slice(0, tag.index).split('\n').length;
    failures.push(
      `${file}:${line}: ${id ?? 'an unnamed ImageView'} says nothing to a screen reader. ` +
        'Give it a description, set one with setContentDescription, or mark it ' +
        'importantForAccessibility="no" if it repeats a text beside it.'
    );
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Every widget image says what it shows or is marked as saying nothing.');
