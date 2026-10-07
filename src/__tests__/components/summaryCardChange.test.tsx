/**
 * Scenario: the summary card states the fitness change over its plotted
 * window beside the hero value and marks the days fitness rose.
 *
 * Expected behaviour: a positive, a negative and a missing delta print a
 * signed figure, a signed figure and nothing; the rise days become one point
 * each on the plot.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';
import { formatSignedChange, riseDayPoints } from '@/features/home/lib/fitnessChange';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

async function renderCard(props: Partial<SummaryCardProps>) {
  const tree = render(
    <SummaryCard
      onProfilePress={() => {}}
      heroValue={0}
      heroLabel="metrics.fitness"
      heroColor="#000"
      showSparkline
      supportingMetrics={[]}
      fitnessData={[52, 55, 61]}
      fatigueData={[50, 56, 60]}
      formData={[2, -1, 1]}
      {...props}
    />
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

describe('formatSignedChange', () => {
  it('signs a rise and a fall and leaves zero bare', () => {
    expect(formatSignedChange(9)).toBe('+9');
    expect(formatSignedChange(-11)).toBe('−11');
    expect(formatSignedChange(0)).toBe('0');
  });

  it('prints nothing for a missing change', () => {
    expect(formatSignedChange(null)).toBeNull();
    expect(formatSignedChange(undefined)).toBeNull();
  });
});

describe('riseDayPoints', () => {
  it('places each marked day on the line at its index', () => {
    const points = riseDayPoints([40, 50, 60], [1], {
      width: 100,
      top: 0,
      height: 10,
      min: 40,
      max: 60,
    });
    expect(points).toEqual([{ x: 50, y: 5 }]);
  });

  it('drops an index outside the series', () => {
    expect(
      riseDayPoints([40, 50], [5], { width: 100, top: 0, height: 10, min: 40, max: 50 })
    ).toEqual([]);
  });
});

describe('the hero change', () => {
  it('prints a rise beside the hero value', async () => {
    const tree = await renderCard({ fitnessDelta: 9 });
    expect(tree.getByTestId('summary-card-fitness-change').props.children).toContain('+9');
  });

  it('prints a fall', async () => {
    const tree = await renderCard({ fitnessDelta: -4 });
    expect(tree.getByTestId('summary-card-fitness-change').props.children).toContain('−4');
  });

  it('prints nothing without a delta', async () => {
    const tree = await renderCard({ fitnessDelta: undefined });
    expect(tree.queryByTestId('summary-card-fitness-change')).toBeNull();
  });
});
