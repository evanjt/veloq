/**
 * Scenario: a confirmation whose button deletes something is translated, and
 * the translation drops the placeholder that named what goes. The call site
 * still passes the athlete, the count or the date, and the dialog renders
 * without it.
 *
 * Expected behaviour: every locale's form of every destructive message, every
 * plural form included, carries each parameter its call site passes. A locale
 * that cannot yet is named below with the reason, and stops being excused the
 * moment it carries them.
 */
import { resolvedLocale } from './resolvedLocale';
import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

interface DestructiveMessage {
  key: string;
  /** What the call site passes, and so what the message must show. */
  params: string[];
  /** Locales whose wording waits on a decision, with the reason. */
  pending?: Record<string, string>;
}

/**
 * Listed rather than matched on a pattern, because a key's name does not say
 * that its button deletes. Only messages whose call site names what goes are
 * here: one that passes nothing has no placeholder to lose.
 */
const DESTRUCTIVE_MESSAGES: DestructiveMessage[] = [
  {
    key: 'backup.differentAccountMessage',
    params: ['cachedAthleteId', 'count'],
  },
  {
    key: 'recording.resumePreviousMessage',
    params: ['startTime', 'duration'],
  },
  { key: 'alerts.accountChangeMessage', params: ['cachedAthleteId'] },
  { key: 'alerts.accountChangeDemoMessage', params: ['cachedAthleteId'] },
  { key: 'namedCorridors.deleteConfirm', params: ['name'] },
  { key: 'sections.deleteSectionConfirm', params: ['name'] },
  { key: 'recording.library.deleteConfirmMessage', params: ['sport', 'startTime'] },
];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

function loadLocale(locale: string): Record<string, unknown> {
  return resolvedLocale(locale);
}

/** The message and each of its plural forms, as `[suffixed key, text]`. */
function forms(bundle: Record<string, unknown>, key: string): [string, string][] {
  const parts = key.split('.');
  const leaf = parts.pop() as string;
  let node: unknown = bundle;
  for (const part of parts) node = (node as Record<string, unknown> | undefined)?.[part];
  const parent = (node ?? {}) as Record<string, unknown>;
  return Object.entries(parent)
    .filter(([name]) => name === leaf || name.startsWith(`${leaf}_`))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, text]) => [[...parts, name].join('.'), text]);
}

function missingParams(text: string, params: string[]): string[] {
  return params.filter((param) => !text.includes(`{{${param}}}`));
}

const cases = DESTRUCTIVE_MESSAGES.flatMap((message) =>
  locales.map((locale) => [locale, message.key, message] as const)
);

describe('destructive confirmations name what they delete', () => {
  it('lists only locales that exist as pending', () => {
    const pending = DESTRUCTIVE_MESSAGES.flatMap((m) => Object.keys(m.pending ?? {}));
    expect(pending.filter((locale) => !locales.includes(locale))).toEqual([]);
  });

  it.each(cases)('%s %s carries what its call site passes', (locale, key, message) => {
    const found = forms(loadLocale(locale), key);
    expect(found.length).toBeGreaterThan(0);
    const missing = found
      .map(([name, text]) => [name, missingParams(text, message.params)] as const)
      .filter(([, params]) => params.length > 0);

    if (message.pending?.[locale]) {
      // An excused locale that now carries every parameter has outlived its excuse.
      expect(missing.length).toBeGreaterThan(0);
    } else {
      expect(missing).toEqual([]);
    }
  });
});
