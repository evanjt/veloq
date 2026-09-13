/**
 * Scenario: form follows `icu_form_as_percent`, so the zone an athlete sees can
 * be banded on a percentage of their own fitness rather than on absolute TSB.
 *
 * Expected behaviour: the guidance copy names no threshold at all. An athlete
 * on the percentage denominator would otherwise read "TSB below -30" beside a
 * zone that turned red at -30 per cent of a fitness of 30, which is a TSB of
 * -9. Naming nothing also survives any later change to the bands.
 */
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const ZONES = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'] as const;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, name), 'utf8'));
    return [name, parsed.fitnessScreen.guidance as Record<string, string>] as const;
  });

describe('the form zone guidance', () => {
  it('is present in every locale', () => {
    expect(locales.length).toBeGreaterThanOrEqual(17);
  });

  it.each(locales)('names no boundary number in %s', (_name, guidance) => {
    for (const zone of ZONES) {
      expect(guidance[zone]).toBeTruthy();
      // Any run of digits is a threshold: none of the five sentences has a
      // legitimate number in it once the boundaries are gone.
      expect(guidance[zone]).not.toMatch(/\d/);
    }
  });

  it.each(locales)('does not name TSB as a bounded quantity in %s', (_name, guidance) => {
    for (const zone of ZONES) {
      expect(guidance[zone]).not.toMatch(/TSB/);
    }
  });
});
