/**
 * Scenario: the privacy page and the About credit name the services that receive tile requests.
 * Expected behaviour: every https host the map styles request from appears on the page, the page
 * names no provider the app never calls, and the credit repeats neither a dropped provider nor
 * omits the hosts' names.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolvedLocale } from '../i18n/resolvedLocale';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function tileHosts(): string[] {
  const hosts = new Set<string>();
  for (const rel of [
    'src/features/maps/components/mapStyles.ts',
    'src/features/maps/components/darkMatterStyle.ts',
  ]) {
    for (const m of read(rel).matchAll(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\//g)) {
      hosts.add(m[1].replace(/^wmts\d\./, ''));
    }
  }
  return [...hosts].sort();
}

const page = read('docs/privacy/index.html');
const locales = fs
  .readdirSync(path.join(root, 'src/i18n/locales'))
  .filter((f) => f.endsWith('.json'));

describe('map tile hosts are disclosed', () => {
  it('finds the hosts the styles call', () => {
    expect(tileHosts().length).toBeGreaterThanOrEqual(12);
  });

  it.each(tileHosts())('privacy page names %s', (host) => {
    expect(page).toContain(host);
  });

  it('privacy page names no provider the app never calls', () => {
    expect(page).not.toMatch(/\b(carto|stadia)\b/i);
  });

  it('every map list item is translated in all three languages', () => {
    const keys = [...page.matchAll(/<li data-i18n="(thirdParty\.maps\.[a-z]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(page.split(`"${key}":`).length - 1).toBe(3);
    }
  });

  it.each(locales)('%s credit names no provider the app never calls', (file) => {
    const credit = resolvedLocale(file.replace('.json', '')).about.mapAttribution;
    expect(credit).not.toMatch(/\b(carto|stadia)\b/i);
    expect(credit).toMatch(/OpenStreetMap/);
    expect(credit).toMatch(/swisstopo/);
  });
});
