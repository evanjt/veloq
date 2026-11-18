#!/usr/bin/env node
// Writes docs/api/index.html, the link's API reference, from web/connect/schema.json.
//
// Usage: node scripts/build-api-reference.mjs [--check]
//   --check  exit 1 when the page is not the render of the schema, both as the tree records them

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderApiReference } from './lib/apiReference.mjs';
import { trackedText } from './lib/indexedSources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'docs/api/index.html';
const SCHEMA = 'web/connect/schema.json';

// The check reads the index, so an unsaved edit in this checkout is not what a landing is judged
// on. The write path keeps the disk: it renders the schema the developer has just edited into the
// page the checkout shows.
if (process.argv.includes('--check')) {
  const schemaText = trackedText(ROOT, SCHEMA);
  if (schemaText === undefined) {
    console.error(`${SCHEMA} is not in the tree`);
    process.exit(1);
  }
  const html = renderApiReference(JSON.parse(schemaText));
  // a missing page is out of date
  const kept = trackedText(ROOT, PAGE) ?? '';
  if (kept !== html) {
    console.error('docs/api/index.html is out of date; run: node scripts/build-api-reference.mjs');
    process.exit(1);
  }
} else {
  const schema = JSON.parse(readFileSync(join(ROOT, SCHEMA), 'utf8'));
  const html = renderApiReference(schema);
  mkdirSync(dirname(join(ROOT, PAGE)), { recursive: true });
  writeFileSync(join(ROOT, PAGE), html);
}
