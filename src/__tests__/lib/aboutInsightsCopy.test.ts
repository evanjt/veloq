/**
 * Scenario: the insights header carries one information button, and it sits
 * outside the tab strip, so the same alert opens on all five sub-tabs. The
 * ranking explanation the ordering deserves is only true on the tab that is
 * ordered by ranking; on Routes and Sections it describes something else.
 *
 * Expected behaviour: the disclaimer is on every tab, the ranking paragraph
 * only where the ranking applies, and the ranking copy names the signals
 * rather than the weights, so tuning them does not make it a lie.
 */

import * as fs from 'fs';
import * as path from 'path';

import { aboutInsightsBody } from '@/features/insights/lib/aboutCopy';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

/** Stands in for i18next: returns the key so the composition is visible. */
const t = ((key: string) => key) as unknown as Parameters<typeof aboutInsightsBody>[0];

describe('the About Insights body', () => {
  it('explains the ranking on the tab that is ranked', () => {
    expect(aboutInsightsBody(t, 'insights')).toBe('insights.aboutBody\n\ninsights.aboutRanking');
  });

  it.each(['strength', 'routes', 'sections', 'debug'] as const)(
    'says nothing about ranking on the %s tab',
    (tab) => {
      expect(aboutInsightsBody(t, tab)).toBe('insights.aboutBody');
    }
  );
});

describe('the ranking copy', () => {
  function ranking(locale: string): string {
    const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
    return JSON.parse(raw).insights.aboutRanking as string;
  }

  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  it.each(locales)('%s defines it', (locale) => {
    expect(typeof ranking(locale)).toBe('string');
    expect(ranking(locale).trim().length).toBeGreaterThan(0);
  });

  it.each(locales.filter((l) => !['en-AU', 'en-GB', 'en-US'].includes(l)))(
    '%s translates it rather than copying English',
    (locale) => {
      expect(ranking(locale)).not.toBe(ranking('en-GB'));
    }
  );

  it('names no weight, so tuning the ranker cannot make it a lie', () => {
    for (const locale of locales) {
      expect(ranking(locale)).not.toMatch(/[0-9]/);
    }
  });
});
