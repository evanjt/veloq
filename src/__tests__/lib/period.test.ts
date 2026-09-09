/**
 * Scenario: five pickers answered "what is a period" with five key sets, five
 * label sets, four day tables and their own arithmetic, so seven days had five
 * names and a month was thirty days on one tab and a calendar month on another.
 *
 * Expected behaviour: one `Period` type, one label set in every locale and one
 * day table, and every picker in the app draws its options from it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PERIOD_DAYS,
  PERIOD_LABEL_KEYS,
  SPAN_PERIODS,
  periodOptions,
  periodRangeDays,
  periodStart,
  type Period,
} from '@/shared/app/period';
import { DEFAULT_PERIOD } from '@/shared/app/period';
import { TIME_RANGES } from '@/shared/app/constants';
import { SECTION_TIME_RANGES, RANGE_DAYS } from '@/features/routes/constants';
import { PERIOD_OPTIONS as MAP_PERIODS, DEFAULT_MAP_PERIOD } from '@/features/maps/lib/mapPeriod';
import { STRENGTH_PERIODS } from '@/features/strength/periods';
import { timeRangeToDays } from '@/features/wellness/hooks/useWellness';

// A picker's hook module reaches the binding, which registers a TurboModule at
// import time, so the stub stands in for it here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const LOCALES = resolve('src/i18n/locales');
const DAY_MS = 86_400_000;

function valueAt(locale: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), locale);
}

const PICKERS: { name: string; options: readonly { id: string; labelKey: string }[] }[] = [
  { name: 'fitness', options: TIME_RANGES },
  { name: 'sections', options: SECTION_TIME_RANGES },
  { name: 'strength', options: STRENGTH_PERIODS },
  { name: 'map', options: MAP_PERIODS.filter((o) => o.id !== 'year') },
];

describe('what a period is', () => {
  it('counts a week, a month and a year the same way everywhere', () => {
    expect(PERIOD_DAYS).toEqual({ '7d': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 });
    for (const period of SPAN_PERIODS) {
      expect(timeRangeToDays(period)).toBe(PERIOD_DAYS[period]);
    }
    for (const period of ['1m', '3m', '6m', '1y'] as const) {
      expect(RANGE_DAYS[period]).toBe(PERIOD_DAYS[period]);
    }
  });

  it('gives the engine zero for all, which is how it says no limit', () => {
    expect(periodRangeDays('all')).toBe(0);
    expect(RANGE_DAYS.all).toBe(0);
    expect(periodRangeDays('7d')).toBe(7);
  });

  it.each(PICKERS)('$name draws every option from the one vocabulary', ({ options }) => {
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(Object.keys(PERIOD_LABEL_KEYS.short)).toContain(option.id);
      expect(option.labelKey).toBe(PERIOD_LABEL_KEYS.short[option.id as Period]);
    }
  });

  it('labels every period in every locale, short and long', () => {
    const files = readdirSync(LOCALES).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(17);
    for (const file of files) {
      const locale = JSON.parse(readFileSync(resolve(LOCALES, file), 'utf-8'));
      for (const form of ['short', 'long'] as const) {
        for (const key of Object.values(PERIOD_LABEL_KEYS[form])) {
          const label = valueAt(locale, key);
          expect(typeof label).toBe('string');
          expect((label as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('builds options in the order asked and refuses nothing it knows', () => {
    expect(periodOptions(['1y', '7d']).map((o) => o.id)).toEqual(['1y', '7d']);
    expect(periodOptions(['all'])[0].labelKey).toBe('period.short.all');
    expect(periodOptions([])).toEqual([]);
  });

  it.each([
    ['2026-01-31T12:00:00Z', '1m'],
    ['2026-03-31T12:00:00Z', '1m'],
    ['2024-02-29T12:00:00Z', '1y'],
    ['2026-05-15T12:00:00Z', '7d'],
  ])('starts %s minus %s exactly that many days back, no calendar overflow', (now, period) => {
    const at = new Date(now);
    const start = periodStart(period as Period, at);
    expect(Math.round((at.getTime() - start.getTime()) / DAY_MS)).toBe(
      PERIOD_DAYS[period as keyof typeof PERIOD_DAYS]
    );
  });

  it('starts all before any library', () => {
    expect(periodStart('all', new Date('2026-05-15T12:00:00Z')).getFullYear()).toBeLessThanOrEqual(
      2000
    );
  });
});

/**
 * Scenario: the five pickers shared one vocabulary but still opened on four
 * different windows, so an athlete who set six months on one tab met one month
 * on the next.
 *
 * Expected behaviour: every picker opens on `DEFAULT_PERIOD`, the map opens on
 * All, and no screen names its opening window with a literal, which is how the
 * four drifted apart in the first place.
 */
describe('what a picker opens on', () => {
  const READ = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

  it('is six months, and every picker that shares the default offers it', () => {
    expect(DEFAULT_PERIOD).toBe('6m');
    for (const options of [TIME_RANGES, SECTION_TIME_RANGES, STRENGTH_PERIODS]) {
      expect(options.map((o) => o.id)).toContain(DEFAULT_PERIOD);
    }
  });

  it('is All on the map, which is the one exception', () => {
    expect(DEFAULT_MAP_PERIOD).toBe('all');
    expect(MAP_PERIODS.map((o) => o.id)).toContain(DEFAULT_MAP_PERIOD);
  });

  it.each([
    ['src/app/(tabs)/fitness.tsx', 'DEFAULT_PERIOD'],
    ['src/app/(tabs)/training.tsx', 'DEFAULT_PERIOD'],
    ['src/features/routes/hooks/useSectionUIState.ts', 'DEFAULT_PERIOD'],
    ['src/features/insights/components/StrengthTab.tsx', 'DEFAULT_PERIOD'],
    ['src/app/(tabs)/map.tsx', 'DEFAULT_MAP_PERIOD'],
  ])('%s opens on %s and not on a literal of its own', (path, constant) => {
    const source = READ(path);
    const initialiser = source.match(
      /useState<(?:TimeRange|SectionTimeRange|StrengthPeriod|MapPeriod)>\(([^)]*)\)/
    );
    expect(initialiser).not.toBeNull();
    expect(initialiser?.[1].trim()).toBe(constant);
  });
});
