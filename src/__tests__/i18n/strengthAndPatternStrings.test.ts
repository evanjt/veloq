import { resolvedLocale } from './resolvedLocale';
import fs from 'fs';
import path from 'path';

const en = resolvedLocale('en-AU');

/**
 * Scenario: the strength panels and the pattern card were written in English
 * straight into the components, so a non-English athlete reads English there
 * and nowhere else. The body-type note also said the diagram was chosen "at
 * random" when the code always falls back to male.
 * Expected behaviour: every string these three components draw comes from a
 * key, the reference locale carries it (and so every locale, through
 * translations.test.ts), and the fallback note says default rather than random.
 */

const LOCALES = path.join(__dirname, '../../i18n/locales');
const KEYS = [
  'strength.setColumn',
  'strength.repsColumn',
  'strength.weightColumn',
  'strength.timeColumn',
  'strength.totalLabel',
  'strength.setsLabel',
  'strength.durationLabel',
  'strength.muscleSource',
  'strength.bodyTypeFromProfile',
  'strength.bodyTypeDefault',
  'strength.male',
  'strength.female',
  'routes.targetPower',
  'routes.targetHr',
  'routes.targetPace',
];

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, bundle);
}

describe('the strength and pattern strings', () => {
  it.each(KEYS)('%s exists in en-AU', (key) => {
    expect(typeof lookup(en as Record<string, unknown>, key)).toBe('string');
  });

  // Every other locale is held to the reference one in translations.test.ts,
  // so no one reads English here alone.
  it('exists in the reference locale', () => {
    const bundle = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en-GB.json'), 'utf8'));
    expect(KEYS.filter((key) => typeof lookup(bundle, key) !== 'string')).toEqual([]);
  });

  it('calls the fallback body type a default, not a random choice', () => {
    const note = lookup(en as Record<string, unknown>, 'strength.bodyTypeDefault') as string;

    expect(note.toLowerCase()).not.toContain('random');
  });

  it('draws the exercise table totals label from a key', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../features/strength/components/ExerciseTable.tsx'),
      'utf8'
    );
    expect(source).not.toMatch(/>\s*Total\s*</);
    expect(source).toContain("t('strength.totalLabel')");
  });
});
