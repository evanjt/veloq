/**
 * Scenario: the route overlay picker is a formSheet route that answers its caller through the
 * sheet request channel. Two routes leave from the same start, one 4.2 km and one 12.6 km, each
 * ridden twice.
 *
 * Expected behaviour: each row shows its distance beside its attempt count, a tapped route
 * resolves the caller with its id, "No route" resolves null, and closing without a tap cancels.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import RouteOverlaySheet, { type RouteOverlaySheetInput } from '@/app/sheets/route-overlay';
import { openSheet } from '@/shared/app/sheetRequest';
import { useGroupSummaries } from '@/features/routes/hooks/useEngine';
import { getEngine } from '@/shared/native/engine';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: jest.fn(() => true),
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({ useGroupSummaries: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => ({})) }));

function summary(groupId: string, distanceMeters: number) {
  return {
    groupId,
    representativeId: `${groupId}-rep`,
    activityCount: 2,
    customName: undefined,
    bounds: undefined,
    sportTypes: ['Ride'],
    distanceMeters,
  };
}

function renderPicker(selectedRouteId: string | null = null) {
  const result = openSheet<RouteOverlaySheetInput, string | null>('sheets/route-overlay', {
    activityType: 'Ride',
    selectedRouteId,
  });
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  return { screen: render(<RouteOverlaySheet />), result };
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  (useGroupSummaries as jest.Mock).mockReturnValue({
    totalCount: 3,
    summaries: [summary('short', 4200), summary('long', 12600), summary('unknown', 0)],
  });
});

it("shows each route's distance beside its attempt count", () => {
  const { screen } = renderPicker();

  expect(screen.getByText(/^4\.2 km · /)).toBeTruthy();
  expect(screen.getByText(/^12\.6 km · /)).toBeTruthy();
});

it('shows the count alone for a route whose distance is unknown', () => {
  const { screen } = renderPicker();

  const rows = screen.getAllByText(/recording\.routeOverlay\.activities/);
  expect(rows).toHaveLength(3);
  expect(rows.filter((row) => /km|mi|m ·/.test(String(row.props.children)))).toHaveLength(2);
});

it('shows the distance in miles for an imperial athlete', () => {
  const { useMetricSystem } = jest.requireMock('@/shared/app');
  useMetricSystem.mockReturnValue(false);

  const { screen } = renderPicker();

  expect(screen.getByText(/^2\.6 mi · /)).toBeTruthy();
});

it('shows live percentages and orders routes by overlap after the recorded track grows', async () => {
  const streams = useRecordingStore.getState().streams;
  act(() => {
    useRecordingStore.setState({
      streams: {
        ...streams,
        latlng: [
          [47, 7],
          [47.001, 7],
        ],
        distance: [0, 350],
      },
    });
  });
  (getEngine as jest.Mock).mockReturnValue({
    liveRouteOverlaps: jest.fn().mockResolvedValue([
      { groupId: 'short', percentage: 10 },
      { groupId: 'long', percentage: 75 },
      { groupId: 'unknown', percentage: 0 },
    ]),
  });

  const { screen } = renderPicker();
  await waitFor(() => expect(screen.getByText(/75%/)).toBeTruthy());
  expect(
    screen.getByTestId('route-overlay-list').props.data.map((group: { id: string }) => group.id)
  ).toEqual(['long', 'short', 'unknown']);
  act(() => useRecordingStore.setState({ streams }));
});

it('resolves the caller with the tapped route and dismisses', async () => {
  const { screen, result } = renderPicker();

  fireEvent.press(screen.getByTestId('route-overlay-option-long'));

  await expect(result).resolves.toEqual({ kind: 'selected', value: 'long' });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('resolves null for "No route", which clears the overlay', async () => {
  const { screen, result } = renderPicker('short');

  fireEvent.press(screen.getByTestId('route-overlay-none'));

  await expect(result).resolves.toEqual({ kind: 'selected', value: null });
});

it('marks the current route as selected', () => {
  const { screen } = renderPicker('short');

  expect(screen.getByTestId('route-overlay-option-short').props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(screen.getByTestId('route-overlay-option-long').props.accessibilityState).toMatchObject({
    selected: false,
  });
  expect(screen.getByTestId('route-overlay-none').props.accessibilityState).toMatchObject({
    selected: false,
  });
});

it('resolves cancelled when it unmounts without a tap', async () => {
  const { screen, result } = renderPicker();
  screen.unmount();
  await expect(result).resolves.toEqual({ kind: 'cancelled' });
});
