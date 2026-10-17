/**
 * Scenario: the Fitness & Fatigue chart is the one readout of the day's loads
 * on the fitness tab, so its top-right corner carries form and the ramp rate
 * beside fitness and fatigue, for the newest day or the pinned one.
 *
 * Expected behaviour: form reads rounded fitness minus rounded fatigue, or its
 * percentage of fitness under that preference, in text colour with its zone's
 * swatch beside it; the ramp is
 * the displayed day's own, signed per week, and absent when that day logs none.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FORM_ZONE_MARK_COLORS } from '@/features/fitness/lib';
import { colors } from '@/theme';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import type { WellnessData } from '@/types';
import { ABSENT } from '@/shared/format/absent';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48, rampRate: -1.25 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-04', ctl: 50.5, atl: 40.4, rampRate: 6.2 },
] as WellnessData[];

afterEach(() => useFormPreference.setState({ formAsPercent: null }));

function colourOf(node: ReactTestInstance) {
  return StyleSheet.flatten(node.props.style).color;
}

function fillOf(node: ReactTestInstance) {
  return StyleSheet.flatten(node.props.style).backgroundColor;
}

describe('the fitness chart corner', () => {
  it("reads the newest day's form and ramp with nothing pinned", async () => {
    const tree = await render(<FitnessChart data={DAYS} />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('+11', { exact: true });
    expect(tree.getByTestId('fitness-ramp-value')).toHaveTextContent('+6.2', { exact: true });
  });

  it("follows the pinned day's own form and ramp", async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-04-01" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('-8', { exact: true });
    expect(tree.getByTestId('fitness-ramp-value')).toHaveTextContent('-1.3', { exact: true });
  });

  it('keys form to its zone by a swatch, with the number in text colour', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-04-01" />);

    expect(colourOf(tree.getByTestId('fitness-form-value'))).toBe(colors.textPrimary);
    expect(fillOf(tree.getByTestId('fitness-form-key'))).toBe(FORM_ZONE_MARK_COLORS.greyZone);
  });

  it('prints form as a percentage of fitness under that preference', async () => {
    useFormPreference.setState({ formAsPercent: true });
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-04-01" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('-20%', { exact: true });
    expect(fillOf(tree.getByTestId('fitness-form-key'))).toBe(FORM_ZONE_MARK_COLORS.optimal);
  });

  it('shows no ramp on a day that logs none', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-04-02" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('-8', { exact: true });
    expect(tree.queryByTestId('fitness-ramp-value')).toBeNull();
  });

  it('reads the absent mark for form and shows no ramp on a pinned day with no row', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-04-03" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent(ABSENT, { exact: true });
    expect(tree.queryByTestId('fitness-form-key')).toBeNull();
    expect(tree.queryByTestId('fitness-ramp-value')).toBeNull();
  });

  it('moves with the pin and back to the newest day', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-04-01" />);
    expect(tree.getByTestId('fitness-ramp-value')).toHaveTextContent('-1.3', { exact: true });

    await tree.rerender(<FitnessChart data={DAYS} selectedDate={null} />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('+11', { exact: true });
    expect(tree.getByTestId('fitness-ramp-value')).toHaveTextContent('+6.2', { exact: true });
  });
});
