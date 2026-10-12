import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SPORT_COLORS, SPORT_TEXT_COLORS } from '@/features/fitness/stores';
import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';

const mockUseActivityLabels = jest.fn((_ids: string[]) => ({
  labels: new Map([['a1', { name: 'Hill ride', date: '' }]]),
  error: null as unknown,
}));
const mockUseActivities = jest.fn(() => ({ data: [] }));
jest.mock('@/features/activity', () => ({
  useActivityLabels: (ids: string[]) => mockUseActivityLabels(ids),
  useActivities: () => mockUseActivities(),
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

it('reads only the ids named by the best efforts', async () => {
  await render(
    <SeasonBestsSection
      efforts={[{ label: '5 km', activityId: 'a1', value: 1200, time: 1200 }] as never}
      sport="Cycling"
      period="6m"
      isLoading={false}
    />
  );

  expect(mockUseActivityLabels).toHaveBeenCalledWith(['a1']);
  expect(mockUseActivities).not.toHaveBeenCalled();
  expect(screen.getByText(/Hill ride/)).toBeTruthy();
});

it('leaves an uncached effort without an activity link', async () => {
  await render(
    <SeasonBestsSection
      efforts={[{ label: '10 km', activityId: 'a2', value: 2400, time: 2400 }] as never}
      sport="Cycling"
      period="6m"
      isLoading={false}
    />
  );

  expect(mockUseActivityLabels).toHaveBeenCalledWith(['a2']);
  expect(screen.queryByText(/Hill ride/)).toBeNull();
});

describe('the Best Efforts link', () => {
  const mockPush = jest.fn();
  const { router } = require('expo-router');

  beforeEach(() => {
    mockPush.mockClear();
    jest.spyOn(router, 'push').mockImplementation(mockPush);
  });

  it.each([
    ['loading', [], true],
    ['empty', [], false],
    ['all values null', [{ label: '5 km', activityId: null, value: null, time: null }], false],
  ])('stays reachable while %s, on the range Fitness shows', async (_name, efforts, isLoading) => {
    await render(
      <SeasonBestsSection
        efforts={efforts as never}
        sport="Swimming"
        period="1y"
        isLoading={isLoading}
      />
    );

    await fireEvent.press(screen.getByTestId('season-bests-view-all'));

    expect(mockPush).toHaveBeenCalledWith('/best-efforts?period=1y');
  });
});

it('sets the link and effort text in the sport text tone, not the fill', async () => {
  await render(
    <SeasonBestsSection
      efforts={[{ label: '5 km', activityId: 'a1', value: 1200, time: 1200 }] as never}
      sport="Running"
      period="6m"
      isLoading={false}
    />
  );

  const colorsUsed = screen
    .UNSAFE_getAllByType(require('react-native').Text)
    .map((node) => StyleSheet.flatten(node.props.style)?.color)
    .filter(Boolean);
  expect(colorsUsed).toContain(SPORT_TEXT_COLORS.Running);
  expect(colorsUsed).not.toContain(SPORT_COLORS.Running);
});

describe('the activity link for a screen reader', () => {
  beforeAll(() => require('@/i18n').initialiseI18n('en-GB'));

  it('speaks the row in reading order through its link: best, value, activity', () => {
    render(
      <SeasonBestsSection
        efforts={[{ label: '5 km', activityId: 'a1', value: 250, time: 1200 }] as never}
        sport="Cycling"
        period="6m"
        isLoading={false}
      />
    );

    expect(screen.getByRole('button', { name: '5 km, 250 W, Hill ride' })).toBeTruthy();
  });

  it('carries the time a running best draws under its pace', () => {
    render(
      <SeasonBestsSection
        efforts={[{ label: '5 km', activityId: 'a1', value: 4, time: 1200 }] as never}
        sport="Running"
        period="6m"
        isLoading={false}
      />
    );

    const label = screen.getByRole('button', { name: /^5 km, / }).props
      .accessibilityLabel as string;
    expect(label.endsWith(', 20:00, Hill ride')).toBe(true);
  });

  it('does not read the best and its value again beside the link', () => {
    render(
      <SeasonBestsSection
        efforts={[{ label: '5 km', activityId: 'a1', value: 250, time: 1200 }] as never}
        sport="Cycling"
        period="6m"
        isLoading={false}
      />
    );

    expect(screen.queryByText('5 km')).toBeNull();
    expect(screen.queryByText('250 W')).toBeNull();
    expect(screen.getByText('5 km', { includeHiddenElements: true })).toBeTruthy();
  });

  it('leaves the best readable on a row with no link', () => {
    render(
      <SeasonBestsSection
        efforts={[{ label: '10 km', activityId: 'a2', value: 2400, time: 2400 }] as never}
        sport="Cycling"
        period="6m"
        isLoading={false}
      />
    );

    expect(screen.getByText('10 km')).toBeTruthy();
  });
});
