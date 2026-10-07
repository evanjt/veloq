/**
 * Scenario: a card pins the fitness tab to a day with no wellness row, or the
 * athlete has form as a percentage of fitness. The fitness and form charts
 * resolved the pinned date themselves and, finding no row, kept the newest
 * day's numbers, or the last scrub's, under the pinned date. The form chart
 * also zoned on absolute TSB whatever the setting.
 *
 * Expected behaviour: a pinned day with no row reads '-' for every value
 * under its date, with or without a selection before it, and the form chart
 * zones its number the way the header card does.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import type { Activity, WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({
  ...jest.requireActual('@/i18n'),
  i18n: { t: (key: string) => key },
}));

const DAYS: WellnessData[] = [
  { id: '2026-03-01', ctl: 40, atl: 50 },
  { id: '2026-03-02', ctl: 41, atl: 49 },
  { id: '2026-03-04', ctl: 60, atl: 40 },
] as WellnessData[];

/** 3 March sits between two rows and has none of its own. */
const MISSING = '2026-03-03';

afterEach(() => useFormPreference.setState({ formAsPercent: null }));

describe('the fitness chart header on a pinned day with no row', () => {
  it("reads '-' rather than the newest day", () => {
    const tree = render(<FitnessChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('-', { exact: true });
    expect(tree.getByTestId('fitness-atl-value')).toHaveTextContent('-', { exact: true });
  });

  it("reads '-' rather than the day selected before it", () => {
    const tree = render(<FitnessChart data={DAYS} selectedDate="2026-03-02" />);
    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('41');

    tree.rerender(<FitnessChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('-', { exact: true });
    expect(tree.getByTestId('fitness-atl-value')).toHaveTextContent('-', { exact: true });
  });

  it('still reads the pinned day when it has a row', () => {
    const tree = render(<FitnessChart data={DAYS} selectedDate="2026-03-01" />);

    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('40');
  });
});

describe('the form chart header on a pinned day with no row', () => {
  it("reads '-' and names no zone rather than the newest day's", () => {
    const tree = render(<FormZoneChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('form-chart-value')).toHaveTextContent('-', { exact: true });
    expect(tree.queryByTestId('form-chart-zone')).toBeNull();
  });

  it("reads '-' rather than the day selected before it", () => {
    const tree = render(<FormZoneChart data={DAYS} selectedDate="2026-03-02" />);
    expect(tree.getByTestId('form-chart-value')).toHaveTextContent('-8');

    tree.rerender(<FormZoneChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('form-chart-value')).toHaveTextContent('-', { exact: true });
  });
});

describe('the form chart zone', () => {
  // -8 on fitness 41 is about -20 per cent: optimal as a percentage, grey in
  // absolute TSB.
  it('follows form as a percentage, as the header card does', () => {
    useFormPreference.setState({ formAsPercent: true });
    const tree = render(<FormZoneChart data={DAYS} selectedDate="2026-03-02" />);

    expect(tree.getByTestId('form-chart-zone')).toHaveTextContent('formZones.optimal');
  });

  it('stays on absolute TSB with the setting off', () => {
    useFormPreference.setState({ formAsPercent: false });
    const tree = render(<FormZoneChart data={DAYS} selectedDate="2026-03-02" />);

    expect(tree.getByTestId('form-chart-zone')).toHaveTextContent('formZones.greyZone');
  });
});

describe('the form chart readout under form as a percentage', () => {
  it('prints the percentage the zone was judged on', () => {
    useFormPreference.setState({ formAsPercent: true });
    const tree = render(<FormZoneChart data={DAYS} selectedDate="2026-03-02" />);

    expect(tree.getByTestId('form-chart-value')).toHaveTextContent('-20%');
  });

  it('shows no number and no zone for a day with no fitness', () => {
    useFormPreference.setState({ formAsPercent: true });
    const days = [...DAYS, { id: '2026-03-05', ctl: 0, atl: 12 }] as WellnessData[];
    const tree = render(<FormZoneChart data={days} selectedDate="2026-03-05" />);

    expect(tree.getByTestId('form-chart-value')).toHaveTextContent('-', { exact: true });
    expect(tree.queryByTestId('form-chart-zone')).toBeNull();
  });

  it('keeps the absolute number and zone for that day with the setting off', () => {
    useFormPreference.setState({ formAsPercent: false });
    const days = [...DAYS, { id: '2026-03-05', ctl: 0, atl: 12 }] as WellnessData[];
    const tree = render(<FormZoneChart data={days} selectedDate="2026-03-05" />);

    expect(tree.getByTestId('form-chart-value')).toHaveTextContent('-12');
    expect(tree.getByTestId('form-chart-zone')).toHaveTextContent('formZones.optimal');
  });
});

describe('the activity strip on a pinned day with no row', () => {
  const RIDE = {
    id: 'r1',
    name: 'Morning Ride',
    type: 'Ride',
    start_date_local: '2026-03-02T07:00:00',
  } as Activity;

  it('drops the day selected before it rather than keeping its activity label', () => {
    const tree = render(
      <ActivityDotsChart data={DAYS} activities={[RIDE]} selectedDate="2026-03-02" />
    );
    expect(tree.queryByText(/Morning Ride/)).not.toBeNull();

    tree.rerender(<ActivityDotsChart data={DAYS} activities={[RIDE]} selectedDate={MISSING} />);

    expect(tree.queryByText(/Morning Ride/)).toBeNull();
  });
});
