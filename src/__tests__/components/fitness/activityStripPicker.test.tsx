/**
 * Scenario: a tap on the strip opens the activities of the day under the finger.
 *
 * Expected behaviour: a tap on a day with several activities opens the activity sheet with that
 * day's activities, the chosen id opens that activity, a dismissed sheet opens nothing, a
 * one-activity day skips the sheet, and a rest day opens nothing.
 */
import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { answerSheet } from '../../__shared__/answerSheet';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import type { FeedCard, WellnessData } from '@/types';
import { dayActivityRow } from '@/features/activity/light';
import { Gesture } from 'react-native-gesture-handler';

const mockPush = jest.fn();
const mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const WELLNESS = [
  { id: '2026-03-10', ctl: 40, atl: 50 },
  { id: '2026-03-11', ctl: 41, atl: 49 },
] as WellnessData[];

const activity = (id: string, day: string): FeedCard =>
  ({ id, name: `Ride ${id}`, sportType: 'Ride', startDateLocal: `${day}T07:00:00` }) as FeedCard;

const ACTIVITIES = [
  activity('a1', '2026-03-10'),
  activity('a2', '2026-03-10'),
  activity('a3', '2026-03-10'),
  activity('b1', '2026-03-11'),
];

const WIDTH = 300;

const strip = () => (
  <ActivityDotsChart data={WELLNESS} activities={ACTIVITIES.map(dayActivityRow)} />
);

type TapHandlers = { onEnd: (event: { x: number; y: number }) => void };

/** Every tap the strip builds, newest last. */
const taps: ReturnType<typeof Gesture.Tap>[] = [];

/** Lays the strip out at a known width and taps it at x, as the finger would. */
async function tapAt(x: number) {
  const tree = await render(strip());
  fireEvent(tree.getByTestId('activity-dots-surface'), 'layout', {
    nativeEvent: { layout: { width: WIDTH, height: 32, x: 0, y: 0 } },
  });
  const tap = taps.at(-1) as unknown as { handlers: TapHandlers };
  await act(async () => {
    tap.handlers.onEnd({ x, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

const pushedRoutes = () => mockPush.mock.calls.map(([target]) => target);

beforeEach(() => {
  mockPush.mockClear();
  taps.length = 0;
  const tap = Gesture.Tap.bind(Gesture);
  jest.spyOn(Gesture, 'Tap').mockImplementation(() => {
    const gesture = tap();
    taps.push(gesture);
    return gesture;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the strip activity picker', () => {
  it('opens the sheet with the day activities and opens the chosen one', async () => {
    await tapAt(0);
    const sheet = pushedRoutes()[0];
    expect(sheet.pathname).toBe('sheets/day-activities');

    mockParams.request = sheet.params.request;
    const reader = await renderHook(() =>
      useSheetRequest<{ activities: { id: string }[] }, string>()
    );
    expect(reader.result.current.input?.activities.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    await act(() => reader.result.current.resolve('a2'));
    await reader.unmount();
    await act(async () => {});
    expect(pushedRoutes().at(-1)).toBe('/activity/a2');
  });

  it('opens nothing when the sheet is dismissed', async () => {
    await tapAt(0);
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(pushedRoutes()).toHaveLength(1);
  });

  it('goes straight to the activity on a one-activity day', async () => {
    await tapAt(WIDTH);
    expect(pushedRoutes()).toEqual(['/activity/b1']);
  });
});
