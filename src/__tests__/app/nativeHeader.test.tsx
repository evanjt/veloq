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
import { processColor } from 'react-native';
import { getHeaderTitle } from 'expo-router/build/react-navigation/elements/Header/getHeaderTitle';

import {
  OVER_MAP_TITLE_COLOR,
  SCREEN_HEADERS,
  SCREEN_SHEETS,
  headerLargeTitle,
  largeTitleScreenOptions,
  noHeroHeaderOptions,
  overMapHeaderOptions,
  sheetFrame,
  sheetHasDetents,
  sheetScreenOptions,
} from '@/shared/app/screenHeaders';
import type { ScreenHeader } from '@/shared/app/screenHeaders';
import { colors, darkColors } from '@/theme';
import { layout } from '@/theme/spacing';
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

/**
 * Scenario: the map-hero screens set an empty `headerTitle`, and the native stack prefers a string
 * `headerTitle` over `title`, so the native item carried no title. Neither screen reader could
 * announce the screen and the next screen's iOS back control had no name to show.
 *
 * Expected behaviour: the over-map header leaves `title` to reach the native item and draws it at
 * an alpha nobody can see, so the header stays visually empty over the hero.
 */
describe('the over-map header', () => {
  it('hands the screen title to the native item', () => {
    const options = overMapHeaderOptions({ title: 'Harbour loop', isDark: false });
    expect(getHeaderTitle(options, 'activity/[id]')).toBe('Harbour loop');
  });

  it('draws that title at an alpha the eye cannot see but the native header still applies', () => {
    const options = overMapHeaderOptions({ isDark: false });
    expect(options.headerTransparent).toBe(true);
    expect(options.headerStyle.backgroundColor).toBe('transparent');
    // The Android header skips a title colour of 0 and draws its default, so the packed colour
    // has to be non-zero while its alpha stays at the floor.
    const packed = processColor(options.headerTitleStyle.color) as number;
    expect(packed).not.toBe(0);
    expect((packed >>> 24) & 0xff).toBe(1);
  });
});

describe('sheet routes', () => {
  it('presents each listed sheet as a formSheet with a grabber and no header', () => {
    expect(Object.keys(SCREEN_SHEETS)).toContain('sheets/activity-type');
    expect(SCREEN_SHEETS['sheets/insight']).toEqual([0.5, 1]);
    for (const os of ['ios', 'android']) {
      for (const name of Object.keys(SCREEN_SHEETS)) {
        expect(sheetScreenOptions(name, os)).toMatchObject({
          presentation: 'formSheet',
          sheetGrabberVisible: true,
          headerShown: false,
        });
        expect(sheetScreenOptions(name, os)?.sheetAllowedDetents).toBe(SCREEN_SHEETS[name]);
      }
    }
  });

  it('leaves an ordinary route without sheet options', () => {
    expect(sheetScreenOptions('settings', 'android')).toBeUndefined();
  });

  it('rounds the Android sheet top corners to the extra-large radius', () => {
    expect(layout.borderRadiusXxl).toBe(28);
    for (const name of Object.keys(SCREEN_SHEETS)) {
      expect(sheetScreenOptions(name, 'android')?.sheetCornerRadius).toBe(layout.borderRadiusXxl);
    }
  });

  it('leaves the iOS sheet corners to the system', () => {
    for (const name of Object.keys(SCREEN_SHEETS)) {
      expect(sheetScreenOptions(name, 'ios')).not.toHaveProperty('sheetCornerRadius');
    }
  });

  it('counts a sheet as resizable only when it rests at more than one detent', () => {
    expect(sheetHasDetents('sheets/insight')).toBe(true);
    expect(sheetHasDetents('sheets/field-picker')).toBe(true);
    expect(sheetHasDetents('sheets/smoothing')).toBe(false);
    expect(sheetHasDetents('settings')).toBe(false);
  });
});

describe('sheet frame', () => {
  it('draws the Android drag handle on a resizable sheet only', () => {
    expect(sheetFrame('sheets/insight', 'android', 48).handle).toBe(true);
    expect(sheetFrame('sheets/field-picker', 'android', 48).handle).toBe(true);
    expect(sheetFrame('sheets/smoothing', 'android', 48).handle).toBe(false);
    expect(sheetFrame('sheets/stat-detail', 'android', 48).handle).toBe(false);
  });

  it('draws no handle of its own on iOS, where the system grabber shows', () => {
    for (const name of Object.keys(SCREEN_SHEETS)) {
      expect(sheetFrame(name, 'ios', 34).handle).toBe(false);
    }
  });

  it('keeps every Android sheet clear of the navigation bar', () => {
    for (const name of Object.keys(SCREEN_SHEETS)) {
      expect(sheetFrame(name, 'android', 48).paddingBottom).toBe(48);
    }
    expect(sheetFrame('sheets/smoothing', 'android', 0).paddingBottom).toBe(0);
  });

  it('pads a resizable iOS sheet above the home indicator and leaves a fitted one to the system', () => {
    expect(sheetFrame('sheets/insight', 'ios', 34).paddingBottom).toBe(34);
    expect(sheetFrame('sheets/merge-confirm', 'ios', 34).paddingBottom).toBe(34);
    expect(sheetFrame('sheets/smoothing', 'ios', 34).paddingBottom).toBe(0);
    expect(sheetFrame('sheets/tile-cache-budget', 'ios', 34).paddingBottom).toBe(0);
  });

  it('registers every sheet in the header table without a header', () => {
    for (const name of Object.keys(SCREEN_SHEETS)) expect(SCREEN_HEADERS[name]).toBeNull();
  });
});

describe('large titles', () => {
  const table: Record<string, ScreenHeader | null> = {
    flagged: { titleKey: 'about.title', largeTitle: true },
    unflagged: { titleKey: 'about.title' },
    overMapFlagged: { overMap: true, largeTitle: true },
    dynamicFlagged: { titleKey: 'about.title', dynamic: true, largeTitle: true },
    none: null,
  };

  it('is true on iOS for an entry that sets the flag', () => {
    expect(headerLargeTitle('flagged', 'ios', table)).toBe(true);
  });

  it('is false on every other platform', () => {
    expect(headerLargeTitle('flagged', 'android', table)).toBe(false);
    expect(headerLargeTitle('flagged', 'web', table)).toBe(false);
  });

  it('is false for an entry without the flag', () => {
    expect(headerLargeTitle('unflagged', 'ios', table)).toBe(false);
  });

  it('is false for a transparent over-map header and for a custom title', () => {
    expect(headerLargeTitle('overMapFlagged', 'ios', table)).toBe(false);
    expect(headerLargeTitle('dynamicFlagged', 'ios', table)).toBe(false);
  });

  it('is false for a headerless entry and for an unknown route', () => {
    expect(headerLargeTitle('none', 'ios', table)).toBe(false);
    expect(headerLargeTitle('missing', 'ios', table)).toBe(false);
  });
});

/**
 * Scenario: on iOS 26 an opaque navigation bar is drawn over its own large title, so the 23
 * flagged screens showed an empty band where the title belongs, light and dark alike.
 *
 * Expected behaviour: a large-title route gives the bar a fully transparent large-title
 * appearance, which is the one form the native header keeps the title visible under, and leaves
 * the collapsed bar's background to the stack. Every other route gets no large-title styling.
 */
describe('large title options', () => {
  const table: Record<string, ScreenHeader | null> = {
    flagged: { titleKey: 'about.title', largeTitle: true },
    unflagged: { titleKey: 'about.title' },
    overMapFlagged: { overMap: true, largeTitle: true },
    none: null,
  };

  it('makes the large-title appearance transparent on iOS for a flagged route', () => {
    expect(largeTitleScreenOptions('flagged', 'ios', table)).toEqual({
      headerLargeTitle: true,
      headerLargeStyle: { backgroundColor: 'transparent' },
    });
  });

  it('leaves the collapsed bar to the stack, so it keeps its opaque surface', () => {
    expect(largeTitleScreenOptions('flagged', 'ios', table)).not.toHaveProperty('headerStyle');
  });

  it('gives no large title and no large-title styling everywhere else', () => {
    for (const [name, os] of [
      ['flagged', 'android'],
      ['unflagged', 'ios'],
      ['overMapFlagged', 'ios'],
      ['none', 'ios'],
      ['missing', 'ios'],
    ]) {
      expect(largeTitleScreenOptions(name, os, table)).toEqual({ headerLargeTitle: false });
    }
  });

  it('covers every flagged route in the real table', () => {
    const flagged = Object.keys(SCREEN_HEADERS).filter((name) => SCREEN_HEADERS[name]?.largeTitle);
    expect(flagged.length).toBeGreaterThan(0);
    for (const name of flagged) {
      expect(largeTitleScreenOptions(name, 'ios').headerLargeStyle).toEqual({
        backgroundColor: 'transparent',
      });
    }
  });
});

/**
 * Scenario: a map-hero detail screen with no hero to show (a trainer ride, a read still waiting,
 * a missing record) kept the transparent, untitled header and drew its own title row and a
 * spacer beneath it, so the page read as two stacked headers.
 *
 * Expected behaviour: with no hero the screen takes the opaque, themed platform header, titled
 * when it has a name, and the hero state puts back the transparent one, since options a screen
 * sets outlast the state that set them.
 */
describe('map-hero detail header states', () => {
  it('gives a screen with no hero an opaque header in the theme, titled with its name', () => {
    expect(noHeroHeaderOptions({ title: 'Trainer ride', isDark: false })).toEqual({
      headerTransparent: false,
      headerShadowVisible: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.textPrimary,
      headerTitleStyle: { color: colors.textPrimary },
      title: 'Trainer ride',
    });
    expect(
      getHeaderTitle(noHeroHeaderOptions({ title: 'Trainer ride', isDark: false }), 'activity/[id]')
    ).toBe('Trainer ride');
    expect(noHeroHeaderOptions({ title: 'Trainer ride', isDark: true })).toMatchObject({
      headerStyle: { backgroundColor: darkColors.surface },
      headerTintColor: darkColors.textPrimary,
      headerTitleStyle: { color: darkColors.textPrimary },
    });
  });

  it("leaves the route's own title alone when the screen has no name to show", () => {
    const options = noHeroHeaderOptions({ isDark: false });
    expect(options.headerTransparent).toBe(false);
    expect(options).not.toHaveProperty('title');
    expect(options).not.toHaveProperty('headerTitle');
  });

  it('puts back the transparent, visually untitled header over the hero', () => {
    expect(overMapHeaderOptions({ isDark: false })).toEqual({
      headerTransparent: true,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: 'transparent' },
      headerTitleStyle: { color: OVER_MAP_TITLE_COLOR },
      headerTintColor: colors.textOnDark,
    });
    expect(overMapHeaderOptions({ isDark: true }).headerTintColor).toBe(colors.textOnDark);
  });

  it('undoes every option the hero header sets, so neither state leaks into the other', () => {
    const hero = Object.keys(overMapHeaderOptions({ isDark: false })).sort();
    const noHero = Object.keys(noHeroHeaderOptions({ title: 'x', isDark: false }));
    expect(hero.filter((key) => !noHero.includes(key))).toEqual([]);
  });
});
