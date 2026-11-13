/**
 * Scenario: a label is stored in capitals in a locale bundle while the type scale also sets it
 * in capitals, so the string and the style both claim the case. A screen reader spells it out,
 * it cannot be reused in a sentence, and it stays in capitals when the style changes.
 *
 * Expected behaviour: the guard refuses a value written entirely in capitals, naming the locale
 * and the key, and passes sentence case, acronyms on its list, and scripts without case.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/lint-locale-capitals.mjs');
const LOCALES = resolve(__dirname, '../../i18n/locales');

function run(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function check(bundles: Record<string, object>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'locale-capitals-'));
  try {
    const dir = join(root, 'src/i18n/locales');
    mkdirSync(dir, { recursive: true });
    for (const [name, bundle] of Object.entries(bundles)) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(bundle));
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the locale capitals guard', () => {
  it('refuses a label stored in capitals', () => {
    const result = check({ 'en-GB': { kiln: { pause: 'PAUSE' } } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('en-GB: kiln.pause "PAUSE"');
  });

  it('passes sentence case beside an acronym on the list', () => {
    expect(check({ 'en-GB': { kiln: { pause: 'Pause', hiit: 'HIIT' } } }).status).toBe(0);
  });

  it('refuses capitals outside English, through placeholders and apostrophes', () => {
    const result = check({
      fr: { kiln: { today: "AUJOURD'HUI", fired: 'CUIT À {{temperature}}' } },
      pl: { kiln: { today: 'DZIŚ' } },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain(`fr: kiln.today "AUJOURD'HUI"`);
    expect(result.output).toContain('fr: kiln.fired "CUIT À {{temperature}}"');
    expect(result.output).toContain('pl: kiln.today "DZIŚ"');
  });

  it('refuses a capitalised word written beside an acronym', () => {
    const result = check({ 'en-GB': { kiln: { ramp: 'FTP RAMP' } } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('en-GB: kiln.ramp "FTP RAMP"');
  });

  it('passes a script without case that carries an acronym', () => {
    expect(check({ ja: { kiln: { ftp: 'FTP設定: {{value}}', gps: 'GPS信号' } } }).status).toBe(0);
  });

  it('passes a capital word of two letters, which is an abbreviation', () => {
    expect(check({ 'en-GB': { kiln: { pr: 'PR', set: 'Set a PR' } } }).status).toBe(0);
  });

  it('refuses an empty listing rather than passing it', () => {
    const result = check({});
    expect(result.status).not.toBe(0);
  });

  it('passes the bundles the app ships', () => {
    const root = mkdtempSync(join(tmpdir(), 'locale-capitals-'));
    try {
      cpSync(LOCALES, join(root, 'src/i18n/locales'), { recursive: true });
      expect(run(root)).toEqual({ status: 0, output: expect.stringContaining('Locale capitals:') });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
