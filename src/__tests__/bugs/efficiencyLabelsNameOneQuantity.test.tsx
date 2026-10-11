/**
 * Scenario: the engine's efficiency series is average heart rate multiplied by
 * pace in seconds per km. The chart label and the section caption called it
 * heart rate per unit of pace, the inverse, while the formula said times.
 *
 * Expected behaviour: in every locale the series label, the section caption and
 * the formula name the one quantity, and the chart prints its scale in a unit.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { createInstance } from 'i18next';
import type { EfficiencyTrend } from 'veloqrs';

import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import type { Insight } from '@/features/insights/types';
import { SectionEfficiencyCard } from '@/features/routes/components/section/SectionEfficiencyCard';
import { SUPPORTED_LOCALES } from '@/i18n/types';
import { resolvedLocale } from '../i18n/resolvedLocale';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

let mockT: (key: string, params?: Record<string, unknown>) => string = (key) => key;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => mockT(key, params),
  }),
}));

const PACES = [300, 295, 290, 285, 280];

function improvingTrend(): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'River Loop',
    sportType: 'Run',
    points: PACES.map((pace, i) => ({
      date: 1_700_000_000 + i * 7 * 86_400,
      paceSecsPerKm: pace,
      avgHr: 150,
      hrPaceRatio: 150 * pace,
    })),
    trendSlope: -107,
    direction: 0,
    hrChangeBpm: -9.4,
    effortCount: 5,
  } as EfficiencyTrend;
}

function seriesHistory(insight: Insight | undefined) {
  const history = insight?.supportingData?.history;
  if (history?.kind !== 'sparkline') throw new Error('expected a sparkline');
  return history;
}

describe.each(SUPPORTED_LOCALES)('%s', (lng) => {
  beforeAll(async () => {
    const instance = createInstance();
    await instance.init({
      lng,
      resources: { [lng]: { translation: resolvedLocale(lng) } },
      interpolation: { escapeValue: false },
    });
    const translate = instance.t as unknown as (key: string, params?: object) => string;
    mockT = (key, params) => translate(key, params);
  });

  function quantity() {
    const name = mockT('insights.efficiencyTrend.quantity');
    expect(name).not.toBe('insights.efficiencyTrend.quantity');
    return name;
  }

  it('names the same quantity in the series label and the formula', () => {
    const [insight] = generateEfficiencyTrendInsights([improvingTrend()], 0, (key, params) =>
      mockT(key, params)
    );
    const label = seriesHistory(insight).series[0]?.label;

    expect(label).toContain(quantity());
    expect(insight?.methodology?.formula).toContain(quantity());
  });

  it('prints the series scale in the quantity unit', () => {
    const [insight] = generateEfficiencyTrendInsights([improvingTrend()], 0, (key, params) =>
      mockT(key, params)
    );
    const unit = mockT('units.bpmSecondsPerKm');

    expect(seriesHistory(insight).scale).toEqual({
      top: `${150 * 300} ${unit}`,
      bottom: `${150 * 280} ${unit}`,
    });
  });

  it('names the same quantity in the section caption', () => {
    const { getByTestId } = render(
      <SectionEfficiencyCard trend={improvingTrend()} isDark={false} />
    );

    expect(String(getByTestId('section-efficiency-caption').props.children)).toContain(quantity());
  });
});

it('does not call heart rate times pace a rate per unit of pace', async () => {
  const instance = createInstance();
  await instance.init({
    lng: 'en-GB',
    resources: { 'en-GB': { translation: resolvedLocale('en-GB') } },
    interpolation: { escapeValue: false },
  });
  const t = instance.t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const [insight] = generateEfficiencyTrendInsights([improvingTrend()], 0, t);

  expect(seriesHistory(insight).series[0]?.label).not.toMatch(/per unit of pace/i);
  expect(insight?.methodology?.formula).not.toMatch(/per unit of pace/i);
});
