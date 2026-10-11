/**
 * Scenario: the athlete reads the Sign out and delete data confirm before
 * accepting it. The wipe deletes their local backups, the backup set-up, the
 * names they gave sections and routes, their trims and pins and their paired
 * sensors, none of which intervals.icu holds.
 *
 * Expected behaviour: the confirm says which data comes back at the next
 * sign-in and which is deleted for good, in every locale, so consent is given
 * on the list the wipe carries out.
 */
import fs from 'fs';
import path from 'path';
import type { TFunction } from 'i18next';

import { WIPE_INVENTORY, wipeConfirmMessage, wipeLineText, wipeLines } from '@/shared/storage';
import { resolvedLocale } from '../i18n/resolvedLocale';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

/** A `t` over one locale's resolved bundle, returning the key when it holds none. */
function translator(locale: string): TFunction {
  const bundle = resolvedLocale(locale) as unknown as Record<string, unknown>;
  return ((key: string) => {
    let node: unknown = bundle;
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === 'string' ? node : key;
  }) as unknown as TFunction;
}

/** The bullet lines under the heading `heading`, up to the next blank line. */
function listUnder(message: string, heading: string): string[] {
  const block = message.split('\n\n').find((part) => part.startsWith(`${heading}\n`));
  return (block ?? '').split('\n').slice(1);
}

describe('the wipe inventory', () => {
  it('deletes for good the data intervals.icu cannot give back', () => {
    expect(wipeLines('deleted')).toEqual(
      expect.arrayContaining(['localBackups', 'backupSetup', 'names', 'sectionEdits', 'sensors'])
    );
  });

  it('brings back only what intervals.icu holds', () => {
    expect(wipeLines('returns')).toEqual(['activities', 'wellness', 'detectedSections']);
  });

  it('gives every line exactly one fate', () => {
    const listed = [...wipeLines('returns'), ...wipeLines('deleted'), ...wipeLines('kept')];
    expect(listed.sort()).toEqual(Object.keys(WIPE_INVENTORY).sort());
  });
});

describe('the confirm message', () => {
  const t = translator('en-GB');
  const message = wipeConfirmMessage(t);

  it('lists local backups, the WebDAV login, names, trims, pins and sensors as deleted for good', () => {
    const deleted = listUnder(message, t('alerts.wipeList.deleted')).join('\n');

    expect(deleted).toMatch(/[Bb]ackups stored on this phone/);
    expect(deleted).toMatch(/WebDAV login/);
    expect(deleted).toMatch(/[Nn]ames you gave sections and routes/);
    expect(deleted).toMatch(/trimmed/);
    expect(deleted).toMatch(/pinned/);
    expect(deleted).toMatch(/[Pp]aired sensors/);
  });

  it('no longer says that everything is synced again', () => {
    const returns = listUnder(message, t('alerts.wipeList.returns')).join('\n');

    expect(message).not.toMatch(/re-synced/);
    expect(returns).toMatch(/[Aa]ctivities/);
    expect(returns).toMatch(/GPS tracks/);
    expect(returns).toMatch(/[Ww]ellness/);
  });

  it.each(locales)('%s shows every line under its fate, each in its own words', (locale) => {
    const tl = translator(locale);
    const built = wipeConfirmMessage(tl);

    for (const fate of ['returns', 'deleted', 'kept'] as const) {
      const lines = wipeLines(fate).map((line) => `• ${wipeLineText(line, tl)}`);
      expect(listUnder(built, tl(`alerts.wipeList.${fate}`))).toEqual(lines);
    }
    expect(built).not.toMatch(/alerts\./);
  });
});
