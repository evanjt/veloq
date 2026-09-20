import en from '@/i18n/locales/en-AU.json';
import fs from 'fs';
import path from 'path';

/**
 * Scenario: the strength panels and the pattern card were written in English
 * straight into the components, so a non-English athlete reads English there
 * and nowhere else. The body-type note also said the diagram was chosen "at
 * random" when the code always falls back to male.
 * Expected behaviour: every string these three components draw comes from a
 * key, every locale carries it, and the fallback note says default rather than
 * random.
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
  'routes.patternSentence',
  'routes.targetPower',
  'routes.targetHr',
  'routes.targetPace',
  'routes.sectionDefaultName',
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

  it('exists in every locale', () => {
    const files = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const file of files) {
      const bundle = JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'));
      for (const key of KEYS) {
        if (typeof lookup(bundle, key) !== 'string') missing.push(`${file}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('calls the fallback body type a default, not a random choice', () => {
    const note = lookup(en as Record<string, unknown>, 'strength.bodyTypeDefault') as string;

    expect(note.toLowerCase()).not.toContain('random');
  });

  it('takes the day name from the pattern sentence, not a hardcoded list', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../features/routes/components/TodayBanner.tsx'),
      'utf8'
    );

    expect(source).not.toContain("'Mondays'");
  });

  it('draws no hardcoded body gender on the strength activity card', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../features/strength/components/StrengthActivityCard.tsx'),
      'utf8'
    );

    expect(source).not.toContain('gender="male"');
  });
});
