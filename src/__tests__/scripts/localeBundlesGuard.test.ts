/**
 * Scenario: a translation drops or invents a `{{placeholder}}`, or a locale lacks a plural form
 * its counts select, so the screen renders without the value, renders the braces, or reads the
 * English form. Key parity passes in every case.
 *
 * Expected behaviour: the locale bundle guard refuses each, naming the locale and the key, and
 * passes a bundle whose forms and placeholders match what each language needs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/lint-locale-bundles.mjs');

const TYPES = `export const LOCALE_FALLBACKS: Record<string, string[]> = {
  'en-GB': ['en-GB'],
  'en-US': ['en-US', 'en-GB'],
  fr: ['fr', 'en-GB'],
  pl: ['pl', 'en-GB'],
  ja: ['ja', 'en-GB'],
};
`;

const ENGLISH = {
  kiln: {
    loaded_one: '{{count}} pot loaded',
    loaded_other: '{{count}} pots loaded',
    glaze: 'Glaze {{colour}} at {{temperature}}',
  },
};

const FRENCH = {
  kiln: {
    loaded_one: '{{count}} pot chargé',
    loaded_other: '{{count}} pots chargés',
    glaze: 'Émail {{colour}} à {{temperature}}',
  },
};

const POLISH = {
  kiln: {
    loaded_one: '{{count}} garnek załadowany',
    loaded_few: '{{count}} garnki załadowane',
    loaded_many: '{{count}} garnków załadowanych',
    glaze: 'Szkliwo {{colour}} w {{temperature}}',
  },
};

const JAPANESE = {
  kiln: { loaded_other: '{{count}}個の鉢', glaze: '{{colour}}の釉薬、{{temperature}}' },
};

function check(overrides: Record<string, object> = {}): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'locale-bundles-'));
  try {
    const dir = join(root, 'src/i18n/locales');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'src/i18n/types.ts'), TYPES);
    const bundles: Record<string, object> = {
      'en-GB': ENGLISH,
      'en-US': {},
      fr: FRENCH,
      pl: POLISH,
      ja: JAPANESE,
      ...overrides,
    };
    for (const [name, bundle] of Object.entries(bundles)) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(bundle));
    }
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the locale bundle guard', () => {
  it('passes bundles whose placeholders and plural forms match each language', () => {
    expect(check().status).toBe(0);
  });

  it('refuses a translation that drops {{count}}', () => {
    const result = check({
      fr: { kiln: { ...FRENCH.kiln, loaded_other: 'Plusieurs pots chargés' } },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('fr: kiln.loaded_other drops {{count}}');
  });

  it('refuses a Polish count key missing its few form', () => {
    const { loaded_few: _dropped, ...rest } = POLISH.kiln;
    const result = check({ pl: { kiln: rest } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('pl: kiln.loaded_few is missing');
  });

  it('does not let the English form fill a missing Polish one form', () => {
    const { loaded_one: _dropped, ...rest } = POLISH.kiln;
    const result = check({ pl: { kiln: rest } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('pl: kiln.loaded_one is missing');
  });

  it('refuses a Polish few form that drops {{count}}, compared with the base forms', () => {
    const result = check({
      pl: { kiln: { ...POLISH.kiln, loaded_few: 'kilka garnków załadowanych' } },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('pl: kiln.loaded_few drops {{count}}');
  });

  it('refuses a placeholder the reference never passes', () => {
    const result = check({
      fr: { kiln: { ...FRENCH.kiln, glaze: 'Émail {{color}} à {{temperature}}' } },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('fr: kiln.glaze drops {{colour}}');
    expect(result.output).toContain('fr: kiln.glaze adds {{color}}');
  });

  it('lets a one form that selects only 1 spell the number out', () => {
    expect(
      check({ pl: { kiln: { ...POLISH.kiln, loaded_one: 'Jeden garnek załadowany' } } }).status
    ).toBe(0);
  });

  it('refuses a one form without {{count}} where one also selects 0', () => {
    const result = check({ fr: { kiln: { ...FRENCH.kiln, loaded_one: 'Un pot chargé' } } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('fr: kiln.loaded_one drops {{count}}');
  });

  it('reads a regional bundle through its base, so an empty override passes', () => {
    expect(check({ 'en-US': {} }).status).toBe(0);
  });
});
