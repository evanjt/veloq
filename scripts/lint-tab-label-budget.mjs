#!/usr/bin/env node
// A bottom tab label wider than its tab ends in an ellipsis, so the athlete reads half the name of
// a destination. Five tabs share the width equally, so on a 320 dp phone each has 64 dp, and the
// label is 11 sp capped at 1.3 times by the reader's text size. A label has to fit 64 dp at
// 14.3 dp to the em, which is about 4.5 em: eight or nine Latin letters, four full-width glyphs.
//
// The width is an estimate from glyph classes, close to the bold system face the active tab
// draws in. A label near the line may fit on one platform and not the other, so shorten it.
//
// The keys are the ones `MENU_ITEMS` in the tab bar draws, read out of its source. Every locale
// bundle's own value is judged, which covers each fallback chain, since a chain only ever lands on
// another bundle's value.

import { refuseEmptyListing, trackedText, treeSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const LOCALES_DIR = 'src/i18n/locales';
const TAB_BAR = 'src/shared/ui/BottomTabBar.tsx';

const NARROWEST_SCREEN_DP = 320;
const TAB_COUNT = 5;
const LABEL_SP = 11;
const TEXT_SCALE_CAP = 1.3;
const BUDGET_EM = NARROWEST_SCREEN_DP / TAB_COUNT / (LABEL_SP * TEXT_SCALE_CAP);

const FULL_WIDTH = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-｠]/u;
const NARROW = /[\s'.,:;!|ijlrtfIJÌ-Ïì-ïİıłĺľ]/u;
const WIDE = /[mwMWÆæŒœ]/u;

/** A glyph's advance in em, by class. */
function glyphEm(glyph) {
  if (FULL_WIDTH.test(glyph)) return 1;
  const base = glyph.normalize('NFD')[0];
  if (NARROW.test(glyph) || NARROW.test(base)) return 0.28;
  if (WIDE.test(base)) return 0.85;
  if (base !== base.toLowerCase()) return 0.66;
  return 0.56;
}

export function labelEm(label) {
  let em = 0;
  for (const glyph of label) em += glyphEm(glyph);
  return em;
}

function tabKeys(text) {
  const block = text?.match(/const MENU_ITEMS = \[([\s\S]*?)\]/)?.[1] ?? '';
  return [...block.matchAll(/\bkey:\s*'(\w+)'/g)].map((match) => match[1]);
}

const keys = tabKeys(trackedText(root, TAB_BAR));
if (keys.length === 0) {
  console.error(`Tab label budget: read no tab keys from MENU_ITEMS in ${TAB_BAR}.`);
  process.exit(1);
}

const sources = treeSources(root, [LOCALES_DIR]);
refuseEmptyListing(sources, 'Tab label budget');

const failures = [];
for (const [file, content] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
  if (!file.endsWith('.json')) continue;
  const locale = file.slice(LOCALES_DIR.length + 1, -'.json'.length);
  const navigation = JSON.parse(content.toString('utf8')).navigation ?? {};
  for (const key of keys) {
    const label = navigation[key];
    if (typeof label !== 'string') continue;
    const em = labelEm(label);
    if (em > BUDGET_EM) {
      failures.push(
        `${locale}: navigation.${key} "${label}" is about ${em.toFixed(1)} em, over the ${BUDGET_EM.toFixed(1)} em a tab holds`
      );
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  console.error('');
  console.error('A bottom tab label has to fit a fifth of a 320 dp phone at the largest text');
  console.error('size the app allows. Use a shorter word for the destination.');
  process.exit(1);
}
console.log('Every bottom tab label fits its tab.');
