/**
 * Scenario: the card for the selected attempt under the performance chart.
 *
 * Expected behaviour: it reads the attempt's figure in the basis the chart
 * plots on and in the athlete's units, its standing against the record as the
 * engine gave it, the record only once every time stream is read, and offers
 * Exclude or Include by the attempt's state as labelled buttons.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SelectedAttemptCard } from '@/features/routes/components/section/SelectedAttemptCard';
import { formatShortDateWithYear } from '@/shared/format/format';
import type { PerformanceDataPoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
let mockIsMetric = true;
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => mockIsMetric,
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const ATTEMPT: PerformanceDataPoint = {
  id: 'p1',
  activityId: 'a1',
  speed: 4,
  date: new Date('2026-01-01T00:00:00Z'),
  activityName: 'Harbour loop',
  direction: 'same',
  sectionTime: 200,
  isBest: false,
};

type CardProps = React.ComponentProps<typeof SelectedAttemptCard>;

function card(props: Partial<CardProps> = {}) {
  return render(
    <SelectedAttemptCard
      attempt={ATTEMPT}
      isDark={false}
      activityType="Ride"
      basis="speed"
      progression={[]}
      recordsSettled
      {...props}
    />
  );
}

const summary = () =>
  screen
    .getByTestId('selected-attempt-card')
    .findAll(
      (node) => node.props.accessible === true && typeof node.props.accessibilityLabel === 'string'
    )[0]!.props.accessibilityLabel as string;

afterEach(() => {
  mockIsMetric = true;
  jest.clearAllMocks();
});

describe('the selected-attempt card facts', () => {
  it('names the attempt by its date, direction and section time', async () => {
    await card();

    const label = summary();
    expect(label).toContain('Harbour loop');
    expect(label).toContain(formatShortDateWithYear(ATTEMPT.date));
    expect(label).toContain('sections.forward');
    expect(label).toContain('3:20');
  });

  it('reads the engine gap as the standing, in the units the athlete chose', async () => {
    await card({
      attempt: { ...ATTEMPT, recordGapSpeed: 1 },
      activityType: 'Run',
      basis: 'pace',
    });
    expect(screen.getByTestId('selected-attempt-value')).toHaveTextContent('4:10 /km');
    expect(screen.getByTestId('selected-attempt-standing')).toHaveTextContent(
      'sections.scatterOffRecord:{"gap":"50 s /km"}'
    );
    await screen.unmount();

    mockIsMetric = false;
    await card({
      attempt: { ...ATTEMPT, recordGapSpeed: 1 },
      activityType: 'Run',
      basis: 'pace',
    });
    expect(screen.getByTestId('selected-attempt-value')).toHaveTextContent('6:42 /mi');
    expect(screen.queryByText(/\/km/)).toBeNull();
  });

  it('heads a route attempt with its moving time and its gap in seconds', async () => {
    await card({ attempt: { ...ATTEMPT, sectionTime: 1600, recordGapSecs: 100 }, basis: 'time' });

    expect(screen.getByTestId('selected-attempt-value')).toHaveTextContent('26:40');
    expect(screen.getByTestId('selected-attempt-standing')).toHaveTextContent(
      'sections.scatterOffRecord:{"gap":"1:40"}'
    );
    expect(screen.queryByText(/\/(mi|km)/)).toBeNull();
  });

  it('shows no standing where the read carries no gap', async () => {
    await card();

    expect(screen.queryByTestId('selected-attempt-standing')).toBeNull();
  });

  it('names the record only once every time stream is read', async () => {
    const record = { ...ATTEMPT, isBest: true, recordGapSpeed: 0 };
    await card({ attempt: record });
    expect(summary()).toContain('sections.legendRecord');
    expect(screen.getByTestId('selected-attempt-standing')).toHaveTextContent(
      'sections.scatterNewRecordFirst'
    );
    await screen.unmount();

    await card({ attempt: record, recordsSettled: false });
    expect(summary()).not.toContain('sections.legendRecord');
    expect(screen.queryByTestId('selected-attempt-standing')).toBeNull();
  });

  it('shows the rounded mean watts, and none for a lap without power', async () => {
    await card({ attempt: { ...ATTEMPT, avgPower: 245.4 } });
    expect(screen.getByText(/245 W/)).toBeTruthy();
    await screen.unmount();

    await card({ attempt: { ...ATTEMPT, avgPower: 0 } });
    expect(screen.queryByText(/\d W/)).toBeNull();
  });
});

describe('the selected-attempt card actions', () => {
  it('offers Open, Use as reference and Exclude on another counted attempt', async () => {
    const onSetAsReference = jest.fn();
    const onExcludeActivity = jest.fn();
    const { navigateTo } = jest.requireMock('@/shared/app/navigation') as {
      navigateTo: jest.Mock;
    };
    await card({ onSetAsReference, onExcludeActivity, onIncludeActivity: jest.fn() });

    await fireEvent.press(screen.getByText('sections.attemptOpen'));
    expect(navigateTo).toHaveBeenCalledWith('/activity/a1');
    await fireEvent.press(screen.getByText('sections.setAsReference'));
    expect(onSetAsReference).toHaveBeenCalledWith('a1');
    await fireEvent.press(screen.getByText('sections.attemptExclude'));
    expect(onExcludeActivity).toHaveBeenCalledWith('a1');
    expect(screen.queryByText('sections.attemptInclude')).toBeNull();
  });

  it('offers Include and no reference on an excluded attempt', async () => {
    const onIncludeActivity = jest.fn();
    await card({
      attempt: { ...ATTEMPT, isExcluded: true },
      onSetAsReference: jest.fn(),
      onExcludeActivity: jest.fn(),
      onIncludeActivity,
    });

    expect(screen.queryByText('sections.setAsReference')).toBeNull();
    expect(screen.queryByText('sections.attemptExclude')).toBeNull();
    await fireEvent.press(screen.getByText('sections.attemptInclude'));
    expect(onIncludeActivity).toHaveBeenCalledWith('a1');
  });

  it('marks the reference rather than offering it again', async () => {
    const onSetAsReference = jest.fn();
    await card({ onSetAsReference, referenceActivityId: 'a1' });

    expect(screen.queryByText('sections.setAsReference')).toBeNull();
    await fireEvent.press(screen.getByText('sections.legendReference'));
    expect(onSetAsReference).not.toHaveBeenCalled();
  });

  it('offers only Open without handlers, and nothing on this activity', async () => {
    await card();
    expect(screen.getByText('sections.attemptOpen')).toBeTruthy();
    expect(screen.queryByText('sections.attemptExclude')).toBeNull();
    await screen.unmount();

    await card({ thisActivityId: 'a1' });
    expect(screen.queryByText('sections.attemptOpen')).toBeNull();
    expect(screen.getByTestId('selected-attempt-this-activity')).toBeTruthy();
  });
});
