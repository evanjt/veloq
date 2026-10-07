#!/usr/bin/env node
// A widget layout must not squeeze its own columns to nothing.
//
// A LinearLayout with no orientation, or `horizontal`, lays its children in a row. A child
// `match_parent` wide and carrying no weight takes the whole row, so every sibling given 0dp and a
// weight measures 0 wide and its subtree draws nothing. The widget still inflates and binds, and
// the only sign is a card with one line on it. A full-width child belongs in a vertical
// container beside the row.
//
// The layouts are read from the disk on purpose: a layout is a resource file the build reads as it
// stands, and the test points `--root` at fixture trees that are not repositories.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);
const dir = join(root, 'widget/android/res/layout');

const attr = (tag, name) => tag.match(new RegExp(`android:${name}="([^"]*)"`))?.[1];

/** Every element as { tag, attrs, children }, from a flat tag scan. */
function parse(xml) {
  const top = { children: [] };
  const stack = [top];
  for (const m of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, rest, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const node = { name, rest, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return top.children;
}

function violations(node, file, out) {
  if (node.name === 'LinearLayout') {
    const orientation = attr(node.rest, 'orientation') ?? 'horizontal';
    if (orientation === 'horizontal') {
      const weighted = node.children.some(
        (c) => attr(c.rest, 'layout_width') === '0dp' && attr(c.rest, 'layout_weight')
      );
      for (const c of node.children) {
        if (weighted && attr(c.rest, 'layout_width') === 'match_parent' && !attr(c.rest, 'layout_weight')) {
          const id = attr(c.rest, 'id') ?? c.name;
          out.push(`${file}: ${id} is match_parent wide beside weighted columns in a horizontal row`);
        }
      }
    }
  }
  for (const c of node.children) violations(c, file, out);
}

const found = [];
let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
} catch {
  process.exit(0);
}
for (const file of files) {
  for (const node of parse(readFileSync(join(dir, file), 'utf8'))) violations(node, file, found);
}

if (found.length > 0) {
  console.error(found.join('\n'));
  process.exit(1);
}
