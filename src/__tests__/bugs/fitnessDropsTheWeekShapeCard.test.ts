/**
 * Scenario: the Fitness screen drew a "This week's shape" card, which reads the
 * week for the athlete rather than showing intervals.icu's numbers.
 * Expected behaviour: the card, the hook behind it and its strings are gone
 * from the front end. The engine read stays until D73 removes it.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../..');
const LOCALES = path.join(SRC, 'i18n/locales');

function sourcesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('the Fitness screen carries no week-shape card', () => {
  it('has no component or hook left', () => {
    expect(fs.existsSync(path.join(SRC, 'features/fitness/components/WeekShapeCard.tsx'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(SRC, 'features/fitness/hooks/useWeekLoadShape.ts'))).toBe(false);
  });

  it('is named by no screen, feature barrel or hook', () => {
    const offenders = sourcesUnder(SRC)
      .filter((f) => /WeekShapeCard|useWeekLoadShape|weekShape/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it.each(fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json')))(
    '%s carries no fitness.weekShape strings',
    (file) => {
      const strings = JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'));

      expect(strings.fitness?.weekShape).toBeUndefined();
    }
  );
});
