/**
 * Scenario: a screen reader user on the fitness chart has no hold and drag, so
 * no day's fitness, fatigue or form was reachable.
 *
 * Expected behaviour: the plot is one adjustable element. Stepping it pins the
 * day the way a scrub does, and its value names that day and its values.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { formatShortDate } from '@/shared/format/format';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-03', ctl: 43, atl: 55 },
] as WellnessData[];

const step = (el: Parameters<typeof fireEvent>[0], actionName: string) =>
  fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName } });

describe('stepping the fitness chart', () => {
  it('is one adjustable element whose value names the stepped day and its values', async () => {
    const onDateSelect = jest.fn();
    const tree = await render(<FitnessChart data={DAYS} onDateSelect={onDateSelect} />);
    const surface = tree.getByTestId('fitness-chart-surface');

    expect(surface.props.accessibilityRole).toBe('adjustable');
    expect(surface.props.accessible).toBe(true);

    await step(surface, 'increment');
    await step(surface, 'increment');

    const value = tree.getByTestId('fitness-chart-surface').props.accessibilityValue.text;
    expect(value).toContain(formatShortDate('2026-04-02'));
    expect(value).toContain('metrics.fitness 41');
    expect(value).toContain('metrics.fatigue 49');
    expect(value).toContain('metrics.form -8');
    expect(onDateSelect).toHaveBeenLastCalledWith('2026-04-02', {
      fitness: 41,
      fatigue: 49,
      form: -8,
    });
    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('41');
  });

  it('names the newest day when stepped back from rest', async () => {
    const tree = await render(<FitnessChart data={DAYS} />);

    await step(tree.getByTestId('fitness-chart-surface'), 'decrement');

    const value = tree.getByTestId('fitness-chart-surface').props.accessibilityValue.text;
    expect(value).toContain(formatShortDate('2026-04-03'));
    expect(value).toContain('metrics.fitness 43');
  });
});
