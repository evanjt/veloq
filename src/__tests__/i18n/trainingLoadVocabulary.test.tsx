/**
 * Scenario: intervals.icu's training load comes from power, heart rate or
 * pace depending on the activity, and the app labelled it TSS, a power-only
 * method, under five different names. The Today banner printed form as a bare
 * "(-12 TSB)", so it never read as the Form the Fitness tab explains.
 *
 * Expected behaviour: a load prints with no method suffix, no locale carries a
 * TSS key or names the Training Stress Score, and the banner names Form beside
 * its abbreviation.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

import * as format from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { TodayBanner } from '@/features/routes/components/TodayBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-i18next', () => {
  const { resolvedLocale } = jest.requireActual(
    './resolvedLocale'
  ) as typeof import('./resolvedLocale');
  const bundle = resolvedLocale('en-GB');
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      i18n: { language: 'en-GB' },
      t: (key: string, values?: Record<string, string | number>) => {
        const text = key
          .split('.')
          .reduce<unknown>(
            (acc, part) =>
              acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
            bundle
          );
        if (typeof text !== 'string') return key;
        return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(values?.[name] ?? ''));
      },
    }),
  };
});

const mockWorkout = {
  todayWorkout: null as unknown,
  tomorrowWorkout: null as unknown,
  isLoading: false,
};

jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => mockWorkout,
}));

jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

const LOCALE_DIR = path.join(__dirname, '../../i18n/locales');

function locales(): [string, Record<string, unknown>][] {
  return fs
    .readdirSync(LOCALE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, name), 'utf8'))]);
}

function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object') return Object.values(node).flatMap(strings);
  return [];
}

describe('a training load figure', () => {
  it('prints the number with no method suffix', () => {
    const formatLoad = (format as Record<string, unknown>).formatLoad as (v: number) => string;
    expect(typeof formatLoad).toBe('function');
    expect(formatLoad(85)).toBe('85');
    expect(formatLoad(84.6)).toBe('85');
    expect(formatLoad(0)).toBe('0');
    expect(formatLoad(Number.NaN)).toBe(ABSENT);
    expect(formatLoad(-3)).toBe(ABSENT);
  });

  it('has no TSS formatter left to reach for', () => {
    expect((format as Record<string, unknown>).formatTSS).toBeUndefined();
  });
});

describe('the locales', () => {
  it.each(locales())('%s carries no TSS label key', (_name, bundle) => {
    const stats = (bundle.stats ?? {}) as Record<string, unknown>;
    expect(stats.tss).toBeUndefined();
    expect(stats.loadTss).toBeUndefined();
  });

  it.each(locales())('%s never names the Training Stress Score or TSS', (_name, bundle) => {
    for (const text of strings(bundle)) {
      expect(text).not.toMatch(/Training Stress Score|\bTSS\b/);
    }
  });
});

describe('the Today banner', () => {
  beforeEach(() => {
    mockWorkout.todayWorkout = null;
    mockWorkout.tomorrowWorkout = null;
  });
  afterEach(() => useFormPreference.setState({ formAsPercent: null }));

  it('names Form beside the balance', async () => {
    const { getByText, queryByText } = await render(<TodayBanner form={{ ctl: 50, atl: 62 }} />);

    expect(getByText(/Form \(TSB\) -12/)).toBeTruthy();
    expect(queryByText(/-12 TSB/)).toBeNull();
  });

  it('names Form without the TSB abbreviation when form is shown as a percentage', async () => {
    useFormPreference.setState({ formAsPercent: true });
    const { getByText, queryByText } = await render(<TodayBanner form={{ ctl: 50, atl: 62 }} />);

    expect(getByText(/Form -24%/)).toBeTruthy();
    expect(queryByText(/TSB/)).toBeNull();
  });

  it('prints a planned workout load as training load, not TSS', async () => {
    mockWorkout.todayWorkout = {
      id: 'planned-1',
      name: 'Lantern climb',
      type: 'Ride',
      moving_time: 3600,
      icu_training_load: 72,
    };
    const { getByText, queryByText } = await render(<TodayBanner form={null} />);

    expect(getByText(/Training load 72/)).toBeTruthy();
    expect(queryByText(/TSS/)).toBeNull();
  });
});
