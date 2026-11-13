/**
 * Scenario: the legend under the Fitness & Fatigue chart shows and hides each
 * line. It was exposed as a pair of selected buttons, so a screen reader said
 * "selected" for a line that was drawn and nothing for one that was hidden.
 *
 * Expected behaviour: each legend item is a switch whose checked state is
 * whether its line is drawn, and a press flips it.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
] as WellnessData[];

describe('the fitness chart legend', () => {
  it.each(['fitness.fitnessCTL', 'fitness.fatigueATL'])('exposes %s as a switch', async (name) => {
    const tree = await render(<FitnessChart data={DAYS} />);
    const item = () => tree.getByRole('switch', { name });

    expect(item().props.accessibilityState).toMatchObject({ checked: true });
    expect(item().props.accessibilityState.selected).toBeUndefined();
    await fireEvent.press(item());
    expect(item().props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(item());
    expect(item().props.accessibilityState).toMatchObject({ checked: true });
  });
});
