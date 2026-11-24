#!/usr/bin/env node
// The connect page sets text and links on its neutral grounds, in both schemes. A
// token that is right on one ground can fail on another, and the token file alone
// does not show which. `--colour-action-primary` is a fill, and on the dark page it
// reads at 3.8:1 as a link.
//
// So this computes the WCAG ratio of every text and link colour against every
// neutral ground, in the light and the dark scheme. A link colour is whatever an
// `a` rule in `web/connect/` reads, or the rail wordmark (`#rail .brand`) reads, followed through a `--name: var(--token)` alias,
// so a link that moves to another token is judged on that token.
//
// Usage: node scripts/lint-connect-contrast.mjs [--root DIR]

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const GENERATED = 'web/connect/tokens.generated.css';
const BAR = 4.5;
const TEXT_ROLES = [
  '--colour-text-primary',
  '--colour-text-secondary',
  '--colour-text-tertiary',
  '--colour-success-text',
  '--colour-warning-text',
  '--colour-error-text',
  '--colour-action-link',
];
const GROUNDS = [
  '--colour-surface-page',
  '--colour-surface',
  '--colour-surface-raised',
  '--colour-surface-input',
];

const sources = indexedSources(root, ['web/connect']);
refuseEmptyListing(sources, 'Connect page contrast guard');

const generated = sources.get(GENERATED)?.toString('utf8');
if (generated === undefined) {
  console.error(`The connect page contrast guard cannot read ${GENERATED}.`);
  process.exit(1);
}

const DECLARATION = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
const RULE = /([^{}]+)\{([^{}]*)\}/g;

/** The token values of each scheme: `:root` for light, the dark selectors for dark. */
function schemes(css) {
  const light = {};
  const dark = {};
  for (const [, selector, body] of css.matchAll(RULE)) {
    const target = selector.trim();
    const into =
      target === ':root'
        ? light
        : target === ':root[data-theme="dark"]' || target === ':root:not([data-theme="light"])'
          ? dark
          : null;
    if (!into) continue;
    for (const [, name, value] of body.matchAll(DECLARATION)) into[name] = value.trim();
  }
  return { light, dark: { ...light, ...dark } };
}

function luminance(hex) {
  const digits = hex.length === 4 ? [...hex.slice(1)].map((d) => d + d).join('') : hex.slice(1);
  const channel = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255);
  const linear = channel.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// Every custom property any stylesheet under `web/connect/` defines as another's `var()`.
const aliases = new Map();
const linkReads = new Set();
for (const [file, bytes] of sources) {
  if (!file.endsWith('.css') || file === GENERATED) continue;
  const css = bytes.toString('utf8');
  for (const [, name, target] of css.matchAll(
    /(--[A-Za-z0-9_-]+)\s*:\s*var\(\s*(--[A-Za-z0-9_-]+)/g
  ))
    aliases.set(name, target);
  for (const [, selector, body] of css.matchAll(RULE)) {
    const isTextRead = selector
      .split(',')
      .some((part) => /(^|[\s>+~])a(:[a-z-]+)*\s*$|#rail \.brand\s*$/.test(part.trim()));
    if (!isTextRead) continue;
    for (const [, name] of body.matchAll(/(?:^|[\s;{])color\s*:\s*var\(\s*(--[A-Za-z0-9_-]+)/g))
      linkReads.add(name);
  }
}

function resolve(name, values) {
  let at = name;
  for (let hops = 0; hops < 8 && !(at in values) && aliases.has(at); hops++) at = aliases.get(at);
  return at;
}

const { light, dark } = schemes(generated);
const failures = [];
const roles = new Set([...TEXT_ROLES, ...[...linkReads].map((name) => resolve(name, light))]);

for (const [scheme, values] of [
  ['light', light],
  ['dark', dark],
]) {
  for (const role of roles) {
    const ink = values[role];
    if (ink === undefined) {
      failures.push(`${scheme}: ${role} is not a colour the token file defines`);
      continue;
    }
    for (const ground of GROUNDS) {
      const surface = values[ground];
      if (surface === undefined) {
        failures.push(`${scheme}: ${ground} is not a colour the token file defines`);
        continue;
      }
      const reads = ratio(ink, surface);
      if (reads < BAR)
        failures.push(`${scheme}: ${role} ${ink} on ${ground} ${surface} is ${reads.toFixed(2)}:1`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `The connect page has text or links under ${BAR}:1 on a ground: ${failures.length}.\n`
  );
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nRead a text or link colour that clears the bar on each ground, such as');
  console.error('--colour-action-link for a link in the dark scheme.');
  process.exit(1);
}

console.log(
  `Connect page contrast guard: every text and link role clears ${BAR}:1 in both schemes.`
);
