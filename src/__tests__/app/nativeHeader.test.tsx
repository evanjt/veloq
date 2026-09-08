/**
 * Scenario: `headerShown: false` was set once for the whole root stack, so no
 * screen had a native header and 24 of them grew their own: an arrow-left
 * TouchableOpacity, a title Text and a spacer View, copied from
 * `styles/shared.ts` or rewritten locally.
 *
 * Expected behaviour: the navigation chrome is the platform's, declared once
 * per route in `screenHeaders`, and no screen draws a back button of its own.
 * That is the rule in `src/shared/ui/CLAUDE.md`, held here so a new screen
 * cannot arrive with a hand-rolled header.
 */

import fs from 'fs';
import path from 'path';

import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';
import type { ScreenHeader } from '@/shared/app/screenHeaders';

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

/**
 * Every route that takes the native header, as the source file it lives in.
 * The tab screens and the login screen draw their own title row and take no
 * header, so the ban on a hand-rolled one does not reach them.
 */
function headeredSources(): { file: string; source: string }[] {
  return headered().map(([route]) => {
    const base = path.join(APP_ROOT, route);
    const file = fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : path.join(base, 'index.tsx');
    return { file: path.relative(APP_ROOT, file), source: fs.readFileSync(file, 'utf-8') };
  });
}

function appSources(): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      out.push({ file: path.relative(APP_ROOT, full), source: fs.readFileSync(full, 'utf-8') });
    }
  };
  walk(APP_ROOT);
  return out;
}

describe('the native stack header', () => {
  it('declares chrome for every route the root stack owns', () => {
    const declared = Object.keys(SCREEN_HEADERS).sort();
    expect(declared).toEqual(rootStackRoutes());
  });

  it('gives every route that takes a header a title to show', () => {
    const untitled = headered()
      .filter(([, header]) => !header.titleKey && !header.title)
      .map(([route]) => route);
    expect(untitled).toEqual([]);
  });

  it('titles every header from an i18n key that exists, bar the developer screen', () => {
    const strings = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../i18n/locales/en-AU.json'), 'utf-8')
    );
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

  it('leaves no hand-rolled back button under src/app', () => {
    const offenders = appSources()
      .filter(({ source }) => /\bbackButton\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('leaves no hand-rolled header row on a screen that takes a native one', () => {
    const offenders = headeredSources()
      .filter(({ source }) => /style=\{(?:\[)?(?:styles|shared)\.header\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('does not turn the header off for the whole root stack', () => {
    const layout = fs.readFileSync(path.join(APP_ROOT, '_layout.tsx'), 'utf-8');
    const screenOptions = layout.slice(layout.indexOf('<Stack'), layout.indexOf('<Stack.Screen'));
    expect(screenOptions).not.toMatch(/headerShown:\s*false/);
  });

  it('drops the copied header block from the shared styles', () => {
    const shared = fs.readFileSync(path.resolve(__dirname, '../../styles/shared.ts'), 'utf-8');
    for (const key of ['header:', 'headerTitle:', 'backButton:']) {
      expect(shared).not.toContain(key);
    }
  });
});
