#!/usr/bin/env node
// The connect page's top bar names the screen (`web/connect/shell/TopBar.tsx`, from the page
// table in `web/connect/pages.ts`). A page that draws the same name again as an h1 or h2 shows
// its title twice on every screen. A heading that carries something the top bar does not, such as
// a panel's own name beside its list, is a panel title at h3.
//
// Counted: an `<h1>` or `<h2>` under `web/connect/pages/` whose text is a literal
// `connectPage.*.heading` or `connectPage.screens.*` key. A name read from data is not counted,
// and the shell test in `src/__tests__/lib/connectShell.browser.test.ts` covers those.
//
// Usage: node scripts/lint-connect-page-titles.mjs [--root DIR]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt === -1 ? resolve(HERE, '..') : resolve(args[rootAt + 1]);
const PAGES = 'web/connect/pages';

const HEADING = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/g;
const SCREEN_KEY = /['"`]connectPage\.(?:[\w.]*\.heading|screens\.\w+)['"`]/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function titleFailures(source) {
  const found = [];
  for (const match of source.matchAll(HEADING)) {
    if (!SCREEN_KEY.test(match[2])) continue;
    const line = source.slice(0, match.index).split('\n').length;
    found.push({ line, level: match[1] });
  }
  return found;
}

const failures = [];
for (const path of files(join(root, PAGES))) {
  const rel = relative(root, path).split('\\').join('/');
  if (!rel.endsWith('.tsx')) continue;
  for (const { line, level } of titleFailures(readFileSync(path, 'utf8'))) {
    failures.push(
      `${rel}:${line} a page heading at h${level} carries the screen's name, which the top bar already shows. Use a panel title (h3) or drop it.`
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
