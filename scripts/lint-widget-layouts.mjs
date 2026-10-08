#!/usr/bin/env node
// Widget layouts must fit the host's layout rules.
//
// A LinearLayout with no orientation, or `horizontal`, lays its children in a row. A child
// `match_parent` wide and carrying no weight takes the whole row, so every sibling given 0dp and a
// weight measures 0 wide and its subtree draws nothing. The widget still inflates and binds, and
// the only sign is a card with one line on it. A full-width child belongs in a vertical
// container beside the row.
//
// A widget whose info sets `resizeMode="none"` is drawn in the cell its minimum size declares and
// never grows, so its layout must fit that cell: padding, glyph, margins and one line of label at
// the smallest size the label may shrink to. The label must shrink, since a translation can be
// several times the English word and a fixed text size clips it.
//
// The layouts are read from the disk on purpose: a layout is a resource file the build reads as it
// stands, and the test points `--root` at fixture trees that are not repositories.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);
const res = join(root, 'widget/android/res');
const dir = join(res, 'layout');

const attr = (tag, name) => tag.match(new RegExp(`android:${name}="([^"]*)"`))?.[1];

/** Every element as { tag, attrs, children }, from a flat tag scan. */
function parse(xml) {
  const top = { children: [] };
  const stack = [top];
  for (const m of xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .matchAll(/<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>/g)) {
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
  if (node.name === 'View' || node.name === 'android.view.View') {
    out.push(`${file}: android.view.View is not allowed in RemoteViews`);
  }
  if (node.name === 'LinearLayout') {
    const orientation = attr(node.rest, 'orientation') ?? 'horizontal';
    if (orientation === 'horizontal') {
      const weighted = node.children.some(
        (c) => attr(c.rest, 'layout_width') === '0dp' && attr(c.rest, 'layout_weight')
      );
      for (const c of node.children) {
        if (
          weighted &&
          attr(c.rest, 'layout_width') === 'match_parent' &&
          !attr(c.rest, 'layout_weight')
        ) {
          const id = attr(c.rest, 'id') ?? c.name;
          out.push(
            `${file}: ${id} is match_parent wide beside weighted columns in a horizontal row`
          );
        }
      }
    }
  }
  for (const c of node.children) violations(c, file, out);
}

const dimensions = new Map();
const theme = join(res, 'values/widget_theme.xml');
if (existsSync(theme)) {
  for (const [, name, value] of readFileSync(theme, 'utf8').matchAll(
    /<dimen name="([^"]+)">([\d.]+)(?:dp|sp)<\/dimen>/g
  )) {
    dimensions.set(name, Number(value));
  }
}

/** A size in dp or sp, or `undefined` when it is absent, or a name for a missing dimension. */
function size(value) {
  if (value === undefined) return undefined;
  if (value.startsWith('@dimen/')) {
    const name = value.slice('@dimen/'.length);
    return dimensions.has(name) ? dimensions.get(name) : name;
  }
  const m = value.match(/^([\d.]+)(?:dp|sp)$/);
  return m ? Number(m[1]) : value;
}

// One line of Roboto with its font padding is a little over its text size.
const LINE = 1.2;
// Android's own floor when a label shrinks with no minimum given.
const AUTO_SIZE_MIN_DEFAULT = 12;

/** What a fixed-size layout's vertical root needs, as violations against the declared cell. */
function fixedCell(node, file, cell, out) {
  const unknown = [];
  const read = (tag, name, fallback = 0) => {
    const v = size(attr(tag, name));
    if (v === undefined) return fallback;
    if (typeof v === 'string') {
      unknown.push(v);
      return 0;
    }
    return v;
  };
  const pad = (tag, side) => read(tag, `padding${side}`, read(tag, 'padding'));
  if (node.name !== 'LinearLayout' || attr(node.rest, 'orientation') !== 'vertical') {
    out.push(`${file}: a fixed-size widget's root must be a vertical LinearLayout to be measured`);
    return;
  }
  let height = pad(node.rest, 'Top') + pad(node.rest, 'Bottom');
  const inner = cell.width - pad(node.rest, 'Left') - pad(node.rest, 'Right');
  for (const c of node.children) {
    height += read(c.rest, 'layout_marginTop') + read(c.rest, 'layout_marginBottom');
    const h = attr(c.rest, 'layout_height');
    if (c.name === 'TextView') {
      if (attr(c.rest, 'autoSizeTextType') !== 'uniform') {
        out.push(`${file}: a label in a fixed-size widget needs autoSizeTextType="uniform"`);
      }
      const min = read(c.rest, 'autoSizeMinTextSize', AUTO_SIZE_MIN_DEFAULT);
      const lines = Number(attr(c.rest, 'maxLines') ?? 1);
      if (h === 'wrap_content') height += read(c.rest, 'textSize') * LINE * lines;
      else if (h === '0dp' || h === 'match_parent') height += min * LINE * lines;
      else height += read(c.rest, 'layout_height');
    } else if (h !== 'match_parent' && h !== 'wrap_content') {
      height += read(c.rest, 'layout_height');
    }
    const w = attr(c.rest, 'layout_width');
    if (w !== 'match_parent' && w !== 'wrap_content' && read(c.rest, 'layout_width') > inner) {
      out.push(`${file}: a child is wider than the ${cell.width}dp cell less its padding`);
    }
  }
  for (const name of unknown) out.push(`${file}: ${name} is not a declared dimension`);
  if (height > cell.height) {
    out.push(`${file}: needs ${height.toFixed(1)}dp but the fixed cell is ${cell.height}dp`);
  }
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

let infos = [];
try {
  infos = readdirSync(join(res, 'xml')).filter((f) => f.endsWith('.xml'));
} catch {
  infos = [];
}
for (const name of infos) {
  const xml = readFileSync(join(res, 'xml', name), 'utf8');
  const layout = attr(xml, 'initialLayout')?.replace('@layout/', '');
  if (attr(xml, 'resizeMode') !== 'none' || !layout) continue;
  const cell = { width: size(attr(xml, 'minWidth')), height: size(attr(xml, 'minHeight')) };
  const file = `${layout}.xml`;
  const [rootNode] = parse(readFileSync(join(dir, file), 'utf8'));
  if (rootNode) fixedCell(rootNode, file, cell, found);
}

if (found.length > 0) {
  console.error(found.join('\n'));
  process.exit(1);
}
