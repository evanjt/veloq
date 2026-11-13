/**
 * Scenario: the fitness plot and the form plot each sit right of a value-axis
 * gutter sized to their own widest label, while the days trained strip has no
 * gutter, so the three plots start at different x and one hovered day lands on
 * different positions.
 *
 * Expected behaviour: the widest gutter on the card sets the left inset of all
 * three plots, so the strip and both plots span the same x-range.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { FitnessChartCard } from '@/features/fitness/components/sections/FitnessChartCard';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-03', ctl: 42, atl: 47 },
] as WellnessData[];

function card() {
  return (
    <FitnessChartCard
      wellness={DAYS}
      wellnessCoverage={'Fetched' as never}
      loadDots={[]}
      dailyLoads={[]}
      eftpChanges={[]}
      selectedDate={null}
      sharedSelectedIdx={{ value: -1 } as never}
      onDateSelect={() => {}}
      onInteractionChange={() => {}}
    />
  );
}

function widthOf(node: { props: { style?: unknown } }, key: 'minWidth' | 'width') {
  return (StyleSheet.flatten(node.props.style as never) as Record<string, number>)?.[key];
}

it('gives the strip and both plots the widest gutter as their left inset', async () => {
  const tree = await render(card());
  await act(async () => {
    fireEvent(tree.getByTestId('fitness-chart-y-axis'), 'layout', {
      nativeEvent: { layout: { width: 34, height: 200 } },
    });
    fireEvent(tree.getByTestId('form-chart-y-axis'), 'layout', {
      nativeEvent: { layout: { width: 22, height: 140 } },
    });
  });

  expect(widthOf(tree.getByTestId('activity-dots-gutter'), 'width')).toBe(34);
  expect(widthOf(tree.getByTestId('fitness-chart-y-axis'), 'minWidth')).toBe(34);
  expect(widthOf(tree.getByTestId('form-chart-y-axis'), 'minWidth')).toBe(34);
});
