/**
 * Scenario: five weekly efforts at a constant 150 bpm, run at 340, 330, 320,
 * 310 and 300 s/km. The engine's ratio (heart rate times pace) falls and its
 * trend is improving, but the athlete's heart rate never moved.
 *
 * Expected behaviour: neither the insight card nor the section page says heart
 * rate fell. The figure is named as modelled.
 */

import { resolvedLocale } from '../i18n/resolvedLocale';
import React from 'react';
import { render } from '@testing-library/react-native';
import { createInstance } from 'i18next';
import type { EfficiencyTrend } from 'veloqrs';

import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { SectionEfficiencyCard } from '@/features/routes/components/section/SectionEfficiencyCard';
import enGB from '@/i18n/locales/en-GB.json';

const enAU = resolvedLocale('en-AU');
const enUS = resolvedLocale('en-US');

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

jest.mock('@/features/routes/hooks/useSectionEfficiencyTrend', () => ({
  useSectionEfficiencyTrend: () => ({ trend: mockConstantHeartRateTrend() }),
}));

const MOCK_PACES = [340, 330, 320, 310, 300];

function mockConstantHeartRateTrend(): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    sportType: 'Run',
    points: MOCK_PACES.map((pace, i) => ({
      date: 1_700_000_000 + i * 7 * 86_400,
      paceSecsPerKm: pace,
      avgHr: 150,
      hrPaceRatio: 150 * pace,
    })),
    trendSlope: -214,
    direction: 0,
    hrChangeBpm: -18.75,
    effortCount: 5,
  } as EfficiencyTrend;
}

const CLAIMS_HEART_RATE_FELL =
  /(hr|heart rate)[^.]*(trending down|dropped|lower|fell|falling|down)|(lower|dropped)[^.]*(hr|heart rate)/i;

describe.each([
  ['en-AU', enAU],
  ['en-GB', enGB],
  ['en-US', enUS],
])('%s copy', (lng, resource) => {
  beforeAll(async () => {
    const instance = createInstance();
    await instance.init({
      lng,
      resources: { [lng]: { translation: resource } },
      interpolation: { escapeValue: false },
    });
    const translate = instance.t as unknown as (key: string, params?: object) => string;
    mockT = (key, params) => translate(key, params);
  });

  it('does not say on the insight card that heart rate fell', () => {
    const [insight] = generateEfficiencyTrendInsights(
      [mockConstantHeartRateTrend()],
      1_700_000_000_000,
      (key, params) => mockT(key, params)
    );

    expect(insight.title).not.toMatch(CLAIMS_HEART_RATE_FELL);
    expect(insight.subtitle).not.toMatch(CLAIMS_HEART_RATE_FELL);
    expect(insight.body).not.toMatch(CLAIMS_HEART_RATE_FELL);
    expect(insight.body).toMatch(/modelled|modeled/i);
    const row = insight.supportingData?.dataPoints?.find((p) => p.key === 'hrChange');
    expect(row?.label).toMatch(/modelled|modeled/i);
  });

  it('does not say on the section page that heart rate fell', () => {
    const { getByTestId } = render(
      <SectionEfficiencyCard sectionId="sec-1" sportType="Run" isDark={false} />
    );
    const detail = String(getByTestId('section-efficiency-detail').props.children);

    expect(detail).not.toMatch(/heart rate -?\d+ bpm at the same pace/i);
    expect(detail).toMatch(/modelled|modeled/i);
  });
});
