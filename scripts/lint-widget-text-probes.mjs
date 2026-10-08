#!/usr/bin/env node
// Every text an iOS widget draws carries `.measuredText(name)`, inside its line limit.
//
// SwiftUI does not say whether a `Text` was truncated, so the widget capture test judges only the
// texts that measure themselves: a text without the probe is never judged, and the capture passes
// over a cut it cannot see. The probe reads the line limit and the scale factor from the
// environment, so a `.lineLimit` or `.minimumScaleFactor` chained before it is one the probe
// never sees, and it judges the text by the wrong rule.
//
// The Live Activity is drawn on the Lock Screen and in the Dynamic Island, which the capture
// does not draw, so its file is left out.

import { resolve } from 'node:path';

import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);
const TREE = 'widget/ios/VeloqWidget';
const NOT_CAPTURED = new Set(['RecordingLiveActivity.swift']);
const BEFORE_PROBE = new Set(['lineLimit', 'minimumScaleFactor']);

/** The source with comments blanked and string contents replaced, so offsets and lines hold. */
function mask(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"' && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** The offset just past the parenthesis that closes the one at `open`, or -1. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** The modifiers chained onto the call that ends at `end`, in order. */
function chain(text, end) {
  const names = [];
  let at = end;
  for (;;) {
    const m = /^\s*\.(\w+)\s*\(/.exec(text.slice(at));
    if (!m) return names;
    names.push(m[1]);
    const next = closing(text, at + m[0].length - 1);
    if (next === -1) return names;
    at = next;
  }
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

// Out of the index inside a checkout, so the verdict is on what a commit records and not on
// whichever session has a file open; a fixture root that is not a repository is read off the disk.
const listing = treeSources(root, [TREE]);
refuseEmptyListing(listing, 'Widget text probe guard');

const found = [];
for (const [path, bytes] of listing) {
  const file = path.slice(TREE.length + 1);
  if (!file.endsWith('.swift') || NOT_CAPTURED.has(file)) continue;
  const text = mask(bytes.toString('utf8'));
  for (const m of text.matchAll(/(?<![\w.])Text\s*\(/g)) {
    const end = closing(text, m.index + m[0].length - 1);
    if (end === -1) continue;
    const names = chain(text, end);
    const probe = names.indexOf('measuredText');
    const where = `${TREE}/${file}:${lineOf(text, m.index)}`;
    if (probe === -1) {
      found.push(
        `${where}: a Text with no .measuredText(name), which the widget capture never judges`
      );
    } else if (names.slice(0, probe).some((name) => BEFORE_PROBE.has(name))) {
      found.push(
        `${where}: .measuredText comes after the line limit or scale factor it has to read`
      );
    }
  }
}

if (found.length > 0) {
  console.error(found.join('\n'));
  process.exit(1);
}
