/**
 * Scenario: a day with several activities opens a picker from the strip label.
 *
 * Expected behaviour: the label opens the activity sheet with that day's activities, the chosen
 * id opens that activity, a dismissed sheet opens nothing, and a one-activity day skips the sheet.
 */
import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { answerSheet } from '../../__shared__/answerSheet';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import type { Activity, WellnessData } from '@/types';
import { dayActivityRow } from '@/features/activity/light';

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

const activity = (id: string, day: string): Activity =>
  ({ id, name: `Ride ${id}`, type: 'Ride', start_date_local: `${day}T07:00:00` }) as Activity;

const ACTIVITIES = [
  activity('a1', '2026-03-10'),
  activity('a2', '2026-03-10'),
  activity('a3', '2026-03-10'),
  activity('b1', '2026-03-11'),
];

const strip = (day: string) => (
  <ActivityDotsChart
    data={WELLNESS}
    activities={ACTIVITIES.map(dayActivityRow)}
    selectedDate={day}
  />
);

const pushedRoutes = () => mockPush.mock.calls.map(([target]) => target);

beforeEach(() => {
  mockPush.mockClear();
});

describe('the strip activity picker', () => {
  it('opens the sheet with the day activities and opens the chosen one', async () => {
    const tree = await render(strip('2026-03-10'));
    void fireEvent.press(tree.getByText(/fitness\.activitiesCount/));
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
    const tree = await render(strip('2026-03-10'));
    void fireEvent.press(tree.getByText(/fitness\.activitiesCount/));
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(pushedRoutes()).toHaveLength(1);
  });

  it('goes straight to the activity on a one-activity day', async () => {
    const tree = await render(strip('2026-03-11'));
    await fireEvent.press(tree.getByText(/Ride b1/));
    expect(pushedRoutes()).toEqual(['/activity/b1']);
  });
});
