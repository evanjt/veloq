/**
 * Scenario: a backup copies the athlete's decisions off the device, and the stream window decides
 * how long sensor streams are kept.
 * Expected behaviour: the privacy page has a backup item for every place a backup can go, and its
 * retention item names every stream window the settings offer, in the markup and in all three
 * languages.
 */
import * as fs from 'fs';
import * as path from 'path';
import { backupCarriers } from '@/features/settings/lib/autobackup/backends/carriers';
import {
  STREAM_RETENTION_ALL,
  STREAM_RETENTION_CHOICES_DAYS,
} from '@/features/settings/lib/streamRetention';

const root = path.resolve(__dirname, '../../..');
const page = fs.readFileSync(path.join(root, 'docs/privacy/index.html'), 'utf8');

const backupDestinations = [...backupCarriers.map((c) => c.id), 'device', 'export'];

// Each language's table is the slice of the page script between its own opening and the next.
const tables = page
  .slice(page.indexOf('const translations'))
  .split(/\n {8}(?=(?:en|es|fr): \{)/)
  .slice(1);

const translatedValue = (table: string, key: string): string => {
  const m = table.match(
    new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)')`)
  );
  if (!m) throw new Error(`no translation for ${key}`);
  return m[1] ?? m[2];
};

describe('privacy page backup section', () => {
  it('finds the three languages', () => {
    expect(tables).toHaveLength(3);
  });

  it('knows the automatic carriers', () => {
    expect(backupDestinations).toEqual(expect.arrayContaining(['webdav', 'folder']));
  });

  it.each(backupDestinations)('has a markup item and three translations for %s', (id) => {
    expect(page).toContain(`<li data-i18n="backup.${id}"`);
    for (const table of tables) {
      expect(translatedValue(table, `backup.${id}`).length).toBeGreaterThan(0);
    }
  });
});

describe('privacy page retention item', () => {
  const windows = STREAM_RETENTION_CHOICES_DAYS.filter((d) => d !== STREAM_RETENTION_ALL);

  it('has at least one window to name', () => {
    expect(windows.length).toBeGreaterThan(0);
  });

  it.each(windows)('names a window of %i days in every language', (days) => {
    for (const table of tables) {
      expect(translatedValue(table, 'localStorage.item2')).toMatch(new RegExp(`\\b${days}\\b`));
    }
  });

  it('no longer claims a 7 day cache', () => {
    for (const table of tables) {
      expect(translatedValue(table, 'localStorage.item2')).not.toMatch(/\b7\b/);
    }
  });
});
