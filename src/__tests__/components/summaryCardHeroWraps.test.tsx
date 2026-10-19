/**
 * Scenario: at large text on a narrow window the hero's value, label and
 * change line no longer fit on one row beside the profile button.
 *
 * Expected behaviour: the hero takes the row's remaining width and its value
 * row wraps, so the change line drops below the value instead of running past
 * the card's edge.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

async function renderCard(props: Partial<SummaryCardProps>) {
  const tree = await render(
    <SummaryCard
      heroValue={0}
      heroLabel="metrics.fitness"
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

function flat(style: unknown) {
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) as
    Record<string, unknown> | undefined;
}

type Node = { props: { style?: unknown }; parent: Node | null } | null | undefined;

function rowAround(node: Node) {
  for (let at = node?.parent; at; at = at.parent) {
    const style = flat(at.props.style);
    if (style?.flexDirection === 'row') return style;
  }
  throw new Error('no row around the node');
}

describe('the summary card hero at large text', () => {
  it('lets the fitness value row wrap the change line below the value', async () => {
    const tree = await renderCard({ fitnessDelta: 3 });
    expect(rowAround(tree.getByTestId('summary-card-fitness-change')).flexWrap).toBe('wrap');
  });

  it('lets the fatigue and form line wrap', async () => {
    const tree = await renderCard({ fitnessDelta: 3 });
    expect(rowAround(tree.getByText(/metrics\.fatigue/)).flexWrap).toBe('wrap');
  });

  it('gives the hero the width beside the profile button', async () => {
    const tree = await renderCard({ fitnessDelta: 3 });
    expect(flat(tree.getByTestId('summary-card-hero').props.style)?.flex).toBe(1);
  });

  it('lets the HRV value row wrap the resting heart rate below', async () => {
    const tree = await renderCard({
      heroMetric: 'hrv',
      heroLabel: 'metrics.hrv',
      hrvData: [50, 50, 62],
      rhrData: [48, 49, 47],
    });
    expect(rowAround(tree.getByTestId('summary-card-hrv-value')).flexWrap).toBe('wrap');
  });

  it('lets the plain hero row wrap its label', async () => {
    const tree = await renderCard({ showSparkline: false, heroValue: 54 });
    expect(flat(tree.getByTestId('summary-card-hero').props.style)?.flex).toBe(1);
    expect(rowAround(tree.getByText('metrics.fitness')).flexWrap).toBe('wrap');
  });
});
