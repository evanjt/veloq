import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { colors, sportFamilyColours } from '@/theme';
import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';

const HILL_RIDE = { name: 'Hill ride', date: '' };

const mockUseActivities = jest.fn(() => ({ data: [] }));
jest.mock('@/features/activity', () => ({
  useActivities: () => mockUseActivities(),
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

it('names the activity the read carries on the best, reading no activity of its own', async () => {
  await render(
    <SeasonBestsSection
      efforts={
        [{ label: '5 km', activityId: 'a1', activity: HILL_RIDE, value: 1200, time: 1200 }] as never
      }
      sport="Cycling"
      period="6m"
      isLoading={false}
    />
  );

  expect(mockUseActivities).not.toHaveBeenCalled();
  expect(screen.getByText(/Hill ride/)).toBeTruthy();
});

it('leaves an uncached effort without an activity', async () => {
  await render(
    <SeasonBestsSection
      efforts={[{ label: '10 km', activityId: 'a2', value: 2400, time: 2400 }] as never}
      sport="Cycling"
      period="6m"
      isLoading={false}
    />
  );

  expect(screen.queryByText(/Hill ride/)).toBeNull();
  expect(screen.queryByRole('button', { name: /10 km/ })).toBeNull();
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

it('sets the link in the link ink and the effort in the primary text, never a sport colour', async () => {
  await render(
    <SeasonBestsSection
      efforts={
        [{ label: '5 km', activityId: 'a1', activity: HILL_RIDE, value: 1200, time: 1200 }] as never
      }
      sport="Running"
      period="6m"
      isLoading={false}
    />
  );

  const colorsUsed = screen
    .UNSAFE_getAllByType(require('react-native').Text)
    .map((node) => StyleSheet.flatten(node.props.style)?.color)
    .filter(Boolean);
  expect(colorsUsed).toContain(colors.actionLink);
  expect(colorsUsed).toContain(colors.textPrimary);
  const sportColours = Object.values(sportFamilyColours.light).flat();
  expect(colorsUsed.filter((colour) => sportColours.includes(colour))).toEqual([]);
});

describe('the activity row for a screen reader', () => {
  beforeAll(() => require('@/i18n').initialiseI18n('en-GB'));

  it('speaks the row in reading order: best, value, activity', () => {
    render(
      <SeasonBestsSection
        efforts={
          [
            { label: '5 km', activityId: 'a1', activity: HILL_RIDE, value: 250, time: 1200 },
          ] as never
        }
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
        efforts={
          [{ label: '5 km', activityId: 'a1', activity: HILL_RIDE, value: 4, time: 1200 }] as never
        }
        sport="Running"
        period="6m"
        isLoading={false}
      />
    );

    const label = screen.getByRole('button', { name: /^5 km, / }).props
      .accessibilityLabel as string;
    expect(label.endsWith(', 20:00, Hill ride')).toBe(true);
  });

  it('reads the best and its value through the one row, not as elements of their own', () => {
    render(
      <SeasonBestsSection
        efforts={
          [
            { label: '5 km', activityId: 'a1', activity: HILL_RIDE, value: 250, time: 1200 },
          ] as never
        }
        sport="Cycling"
        period="6m"
        isLoading={false}
      />
    );

    const row = screen.getByRole('button', { name: '5 km, 250 W, Hill ride' });
    expect(screen.getAllByRole('button', { name: /Hill ride/ })).toHaveLength(1);
    expect(row).toContainElement(screen.getByText('5 km'));
    expect(row).toContainElement(screen.getByText('250 W'));
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
