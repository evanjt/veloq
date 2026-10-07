/**
 * Scenario: `headerShown: false` was set once for the whole root stack, so no
 * screen had a native header and 24 of them grew their own: an arrow-left
 * TouchableOpacity, a title Text and a spacer View, copied from
 * `styles/shared.ts` or rewritten locally.
 *
 * Expected behaviour: the navigation chrome is the platform's, declared once
 * per route in `screenHeaders`, and no screen draws a back button of its own.
 * That is the rule in `src/shared/ui/CLAUDE.md`. That no screen draws a
 * header of its own is `lint:native-header`, and this suite holds the table.
 */

import fs from 'fs';
import path from 'path';

import { SCREEN_HEADERS, SCREEN_SHEETS, sheetScreenOptions } from '@/shared/app/screenHeaders';
import type { ScreenHeader } from '@/shared/app/screenHeaders';
import { resolvedLocale } from '../i18n/resolvedLocale';

const APP_ROOT = path.resolve(__dirname, '../../app');

/**
 * Every route the root stack owns. The tab group is one route from the root
 * stack's side, so its children belong to `(tabs)/_layout` and are not listed.
 */
function rootStackRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name.replace(/\.tsx?$/, '');
      if (entry.isDirectory()) {
        if (name.startsWith('(')) {
          routes.push(prefix + name);
          continue;
        }
        walk(path.join(dir, entry.name), `${prefix}${name}/`);
        continue;
      }
      if (!/\.tsx$/.test(entry.name) || name === '_layout') continue;
      routes.push(prefix + name);
    }
  };
  walk(APP_ROOT, '');
  return routes.sort();
}

function headered(): [string, ScreenHeader][] {
  return Object.entries(SCREEN_HEADERS).filter(
    (entry): entry is [string, ScreenHeader] => entry[1] !== null
  );
}

describe('the native stack header', () => {
  it('declares chrome for every route the root stack owns', () => {
    const declared = Object.keys(SCREEN_HEADERS).sort();
    expect(declared).toEqual(rootStackRoutes());
  });

  it('gives every route that takes a header a title to show', () => {
    const untitled = headered()
      .filter(([, header]) => !header.overMap && !header.titleKey && !header.title)
      .map(([route]) => route);
    expect(untitled).toEqual([]);
  });

  it('lays the native header over the map on the three map-hero detail screens', () => {
    const overMap = headered()
      .filter(([, header]) => header.overMap)
      .map(([route]) => route)
      .sort();
    expect(overMap).toEqual(['activity/[id]', 'route/[id]', 'section/[id]']);
  });

  it('titles every header from an i18n key that exists, bar the developer screen', () => {
    const strings = resolvedLocale('en-AU');
    const lookup = (key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => {
        if (!node || typeof node !== 'object') return undefined;
        return (node as Record<string, unknown>)[part];
      }, strings);

    const missing = headered()
      .filter(([, header]) => header.titleKey && typeof lookup(header.titleKey) !== 'string')
      .map(([route]) => route);
    expect(missing).toEqual([]);
  });
});

describe('sheet routes', () => {
  it('presents each listed sheet as a formSheet with a grabber and no header', () => {
    expect(Object.keys(SCREEN_SHEETS)).toContain('sheets/activity-type');
    for (const name of Object.keys(SCREEN_SHEETS)) {
      expect(sheetScreenOptions(name)).toMatchObject({
        presentation: 'formSheet',
        sheetGrabberVisible: true,
        headerShown: false,
      });
      expect(sheetScreenOptions(name)?.sheetAllowedDetents).toBe(SCREEN_SHEETS[name]);
    }
  });

  it('leaves an ordinary route without sheet options', () => {
    expect(sheetScreenOptions('settings')).toBeUndefined();
  });

  it('registers every sheet in the header table without a header', () => {
    for (const name of Object.keys(SCREEN_SHEETS)) expect(SCREEN_HEADERS[name]).toBeNull();
  });
});
