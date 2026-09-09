/**
 * Scenario: 456 strings survived the features that used them, in all 17
 * locales at once, because nothing ever asked whether a key still had a
 * reader.
 *
 * Expected behaviour: every key in the reference locale is reached, either by
 * its full dotted path appearing in the source or by one of the template
 * prefixes below, which are built at runtime from a last segment the sweep
 * cannot see. A new orphan fails here rather than waiting for the next audit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const SRC_DIR = path.join(__dirname, '../../');
const REFERENCE = path.join(SRC_DIR, 'i18n/locales/en-GB.json');

// Every `t(`prefix.${…}`)` in the app whose appended segment the sweep cannot
// see. A prefix is only listed when the runtime can append a value that is not
// a closed set: an activity type, a sport, a ledger kind. Where the set IS
// closed, the exact keys go in DYNAMIC_KEYS instead, so a stale one still fails
// here. Widening a prefix to cover a whole subtree is what let 72 orphans sit
// under `settings.` unseen.
const DYNAMIC_PREFIXES = [
  'activityTypes.',
  'feed.groups.',
  'filters.',
  'fitnessScreen.guidance.',
  'formZones.',
  'insights.hrvTrend.',
  'insights.sectionChanged.',
  'maps.activityTypes.',
  'recording.categories.',
  'recording.fields.',
  'recording.gpsModes.',
  'recording.library.status.',
  'recording.rpeLabels.',
  'recording.timeOfDay.',
  'sectionHistory.kind_',
  'sensors.kinds.',
  'sensors.status.',
];

// Closed sets, built at runtime from a value the sweep cannot see but whose
// members are enumerable from the source.
const DYNAMIC_KEYS = [
  // `navigation.${item.key}`, BottomTabBar.tsx:127, over MENU_ITEMS.
  'navigation.feed',
  'navigation.fitness',
  'navigation.map',
  'navigation.insights',
  'navigation.health',
  // `settings.${themePreference}`, settings.tsx:145.
  'settings.light',
  'settings.dark',
  'settings.system',
  // `settings.${mapPreferences.defaultStyle}` and `settings.terrain3D${mode}`,
  // settings.tsx:155.
  'settings.satellite',
  'settings.terrain3DOff',
  'settings.terrain3DAlways',
];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...leafKeys(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

async function dottedTokensInSource(): Promise<Set<string>> {
  const files = await glob('**/*.{ts,tsx}', {
    cwd: SRC_DIR,
    ignore: ['**/node_modules/**', '**/__tests__/**', 'i18n/locales/**', 'i18n/types.ts'],
    absolute: true,
  });
  const tokens = new Set<string>();
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const token of content.match(/[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+/g) ?? []) {
      tokens.add(token);
    }
  }
  return tokens;
}

describe('i18n keys have a reader', () => {
  it('every reference key is reached by a literal or a template prefix', async () => {
    const reference = JSON.parse(fs.readFileSync(REFERENCE, 'utf-8')) as Record<string, unknown>;
    const tokens = await dottedTokensInSource();

    const reached = (key: string) =>
      tokens.has(key) ||
      DYNAMIC_KEYS.includes(key) ||
      DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix));

    const orphans = leafKeys(reference).filter((key) => {
      if (reached(key)) return false;
      const base = key.replace(PLURAL_SUFFIX, '');
      return base === key || !reached(base);
    });

    expect(orphans).toEqual([]);
  });
});
