/**
 * Scenario: the muscle and balance-pair names were English literals handed to
 * translated sentences, so a German athlete read 'Quadriceps trägt mehr Volumen
 * in Quads vs Hamstrings'.
 * Expected behaviour: every muscle slug and pair id has a name in every
 * bundle, and a balance and a progression insight in a non-English locale carry
 * no English muscle or pair name.
 */

import fs from 'fs';
import path from 'path';

import { changeLanguage, i18n, initializeI18n } from '@/i18n';
import type { TFunc } from '@/features/insights/types';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import {
  BALANCE_PAIR_NAME_KEYS,
  MUSCLE_NAME_KEYS,
  balancePairName,
  muscleName,
} from '@/features/strength/lib/muscleNames';
import type { StrengthProgressionRecord, StrengthSummary } from '@/features/strength/types';
import { resolvedLocale } from '../i18n/resolvedLocale';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const LOCALES = fs.readdirSync(LOCALES_DIR).map((file) => file.replace('.json', ''));
const NOW = Date.UTC(2026, 8, 20);
const t = i18n.t.bind(i18n) as unknown as TFunc;

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, bundle);
}

function summary(): StrengthSummary {
  const muscle = (slug: string, weightedSets: number) => ({
    slug,
    primarySets: weightedSets,
    secondarySets: 0,
    weightedSets,
    totalReps: 0,
    volumeKg: 0,
    exerciseNames: [],
  });
  return {
    muscleVolumes: [muscle('quadriceps', 12), muscle('hamstring', 5), muscle('upper-back', 9)],
    activityCount: 4,
    totalSets: 17,
    balance: [
      {
        id: 'quads_hamstrings',
        leftSlug: 'quadriceps',
        rightSlug: 'hamstring',
        leftWeightedSets: 12,
        rightWeightedSets: 5,
        dominantSlug: 'quadriceps',
        ratio: 2.4,
        status: 'watch',
      },
    ],
  };
}

const progression: StrengthProgressionRecord = {
  muscleSlug: 'upper-back',
  weeklyWeightedSets: [2, 3, 6, 7],
  recentAverage: 6.5,
  baselineAverage: 2.5,
  peakWeightedSets: 7,
  changePct: 160,
  trend: 'up',
} as StrengthProgressionRecord;

describe('muscle and balance-pair names', () => {
  it.each(LOCALES)('%s has a name for every muscle slug and pair id', (locale) => {
    const bundle = resolvedLocale(locale);
    const keys = [...Object.values(MUSCLE_NAME_KEYS), ...Object.values(BALANCE_PAIR_NAME_KEYS)];

    expect(keys.filter((key) => typeof lookup(bundle, key) !== 'string')).toEqual([]);
  });

  it('falls back to the slug or id the engine sent when there is no key', () => {
    expect(muscleName('shins', (k) => k)).toBe('shins');
    expect(balancePairName('calves_shins', (k) => k)).toBe('calves_shins');
  });

  describe.each(['de-DE', 'fr', 'ja'] as const)('in %s', (locale) => {
    beforeAll(async () => {
      await initializeI18n('en-AU');
    });
    beforeEach(async () => {
      await changeLanguage(locale);
    });
    afterAll(async () => {
      await changeLanguage('en-AU');
    });

    it('carries no English muscle or pair name in a balance and a progression insight', () => {
      const insights = generateStrengthInsights(
        summary(),
        [summary()],
        [progression],
        NOW,
        t
      ).filter(
        (i) => i.id.startsWith('strength_balance-') || i.id.startsWith('strength_progression-')
      );
      const text = JSON.stringify(insights);

      expect(insights.map((i) => i.id).sort()).toEqual([
        'strength_balance-quads_hamstrings',
        'strength_progression-upper-back',
      ]);
      for (const english of ['Hamstrings', 'Upper Back', 'Quads vs']) {
        expect(text).not.toContain(english);
      }
      expect(text).toContain(i18n.t('strength.muscles.upperBack'));
    });
  });
});
