/**
 * Scenario: the phone's feed filter and the Connect library filter bound the
 * same engine field, moving time, and a locale that names the bound one way on
 * each surface gives the athlete two words for one filter. The same applies to
 * lift ground in zh-Hans, which named it 缆车 in some places and 升降 in others.
 *
 * Expected behaviour: in every locale the Connect duration legend resolves to
 * the phone's duration title, and in zh-Hans every lift key carries the one
 * term 缆车.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvedLocale } from './resolvedLocale';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

type Bundle = Record<string, unknown>;

function bundleOf(locale: string): Bundle {
  return resolvedLocale(locale) as unknown as Bundle;
}

function valueAt(bundle: Bundle, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      bundle
    );
}

function stringLeaves(node: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(node).flatMap(([key, value]) => {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return [[dotted, value] as [string, string]];
    if (value && typeof value === 'object') {
      return stringLeaves(value as Record<string, unknown>, dotted);
    }
    return [];
  });
}

describe('duration bound name', () => {
  describe.each(locales)('%s', (locale) => {
    it('gives the Connect duration legend the phone feed filter name', () => {
      const bundle = bundleOf(locale);
      expect(valueAt(bundle, 'connectPage.library.duration')).toBe(
        valueAt(bundle, 'feed.filter.duration')
      );
    });
  });
});

describe('lift ground term in zh-Hans', () => {
  const liftKeys = stringLeaves(bundleOf('en-GB'))
    .map(([key]) => key)
    .filter((key) => /lift/i.test(key) && !key.startsWith('exerciseLabels.'));
  const zh = bundleOf('zh-Hans');

  it.each(liftKeys)('%s uses 缆车', (key) => {
    const text = valueAt(zh, key);
    expect(typeof text).toBe('string');
    expect(text as string).toContain('缆车');
    expect(text as string).not.toContain('升降');
  });
});
