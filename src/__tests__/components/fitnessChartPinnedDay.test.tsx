/**
 * Scenario: a card pins the fitness tab to a day with no wellness row, or the
 * athlete has form as a percentage of fitness. The fitness chart resolved the
 * pinned date itself and, finding no row, kept the newest day's numbers, or the
 * last scrub's, under the pinned date. The form zone was judged on absolute TSB
 * whatever the setting.
 *
 * Expected behaviour: a pinned day with no row reads the absent mark for every value
 * under its date, with or without a selection before it, and the readout zones
 * form on the denominator the athlete chose.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import type { FeedCard, WellnessData } from '@/types';
import { ABSENT } from '@/shared/format/absent';
import { dayActivityRow } from '@/features/activity/light';

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
  it('reads the absent mark rather than the newest day', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent(ABSENT, { exact: true });
    expect(tree.getByTestId('fitness-atl-value')).toHaveTextContent(ABSENT, { exact: true });
  });

  it('reads the absent mark rather than the day selected before it', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-03-02" />);
    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('41');

    await tree.rerender(<FitnessChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent(ABSENT, { exact: true });
    expect(tree.getByTestId('fitness-atl-value')).toHaveTextContent(ABSENT, { exact: true });
  });

  it('still reads the pinned day when it has a row', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-03-01" />);

    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent('40');
  });
});

describe('the readout form on a pinned day with no row', () => {
  it("reads the absent mark and names no zone rather than the newest day's", async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent(ABSENT, { exact: true });
    expect(tree.queryByTestId('fitness-form-zone')).toBeNull();
  });

  it('reads the absent mark rather than the day selected before it', async () => {
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-03-02" />);
    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('-8');

    await tree.rerender(<FitnessChart data={DAYS} selectedDate={MISSING} />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent(ABSENT, { exact: true });
    expect(tree.queryByTestId('fitness-form-zone')).toBeNull();
  });
});

describe('the readout form zone', () => {
  // -8 on fitness 41 is about -20 per cent: optimal as a percentage, grey in
  // absolute TSB.
  it('follows form as a percentage', async () => {
    useFormPreference.setState({ formAsPercent: true });
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-03-02" />);

    expect(tree.getByTestId('fitness-form-zone')).toHaveTextContent('formZones.optimal');
  });

  it('stays on absolute TSB with the setting off', async () => {
    useFormPreference.setState({ formAsPercent: false });
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-03-02" />);

    expect(tree.getByTestId('fitness-form-zone')).toHaveTextContent('formZones.greyZone');
  });
});

describe('the readout form under form as a percentage', () => {
  it('prints the percentage the zone was judged on', async () => {
    useFormPreference.setState({ formAsPercent: true });
    const tree = await render(<FitnessChart data={DAYS} selectedDate="2026-03-02" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('-20%');
    expect(tree.getByTestId('fitness-form-zone')).toHaveTextContent('formZones.optimal');
  });

  it('shows no number and no zone for a day with no fitness', async () => {
    useFormPreference.setState({ formAsPercent: true });
    const days = [...DAYS, { id: '2026-03-05', ctl: 0, atl: 12 }] as WellnessData[];
    const tree = await render(<FitnessChart data={days} selectedDate="2026-03-05" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent(ABSENT, { exact: true });
    expect(tree.queryByTestId('fitness-form-zone')).toBeNull();
  });

  it('keeps the absolute number and zone for that day with the setting off', async () => {
    useFormPreference.setState({ formAsPercent: false });
    const days = [...DAYS, { id: '2026-03-05', ctl: 0, atl: 12 }] as WellnessData[];
    const tree = await render(<FitnessChart data={days} selectedDate="2026-03-05" />);

    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent('-12');
    expect(tree.getByTestId('fitness-form-zone')).toHaveTextContent('formZones.optimal');
  });
});

describe('the activity strip on a pinned day with no row', () => {
  const RIDE = {
    id: 'r1',
    name: 'Morning Ride',
    sportType: 'Ride',
    startDateLocal: '2026-03-02T07:00:00',
  } as FeedCard;

  it('drops the day selected before it rather than keeping its activity label', async () => {
    const tree = await render(
      <ActivityDotsChart
        data={DAYS}
        activities={[dayActivityRow(RIDE)]}
        selectedDate="2026-03-02"
      />
    );
    expect(tree.queryByText(/Morning Ride/)).not.toBeNull();

    await tree.rerender(
      <ActivityDotsChart data={DAYS} activities={[dayActivityRow(RIDE)]} selectedDate={MISSING} />
    );

    expect(tree.queryByText(/Morning Ride/)).toBeNull();
  });
});
