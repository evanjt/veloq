/**
 * Scenario: two routes leave from the same start, one 4.2 km and one 12.6 km,
 * each ridden twice. The overlay picker offered while recording read "2
 * activities" on both rows, because the summaries it lists carried no distance.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import { RouteOverlayPicker } from '@/features/recording/components/RouteOverlayPicker';
import { useGroupSummaries } from '@/features/routes/hooks/useEngine';
import { getEngine } from '@/shared/native/engine';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
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

function renderPicker() {
  return render(
    <RouteOverlayPicker
      visible
      activityType="Ride"
      selectedRouteId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />
  );
}

beforeEach(() => {
  (useGroupSummaries as jest.Mock).mockReturnValue({
    totalCount: 3,
    summaries: [summary('short', 4200), summary('long', 12600), summary('unknown', 0)],
  });
});

it("shows each route's distance beside its attempt count", () => {
  const screen = renderPicker();

  expect(screen.getByText(/^4\.2 km · /)).toBeTruthy();
  expect(screen.getByText(/^12\.6 km · /)).toBeTruthy();
});

it('shows the count alone for a route whose distance is unknown', () => {
  const screen = renderPicker();

  const rows = screen.getAllByText(/recording\.routeOverlay\.activities/);
  expect(rows).toHaveLength(3);
  expect(rows.filter((row) => /km|mi|m ·/.test(String(row.props.children)))).toHaveLength(2);
});

it('shows the distance in miles for an imperial athlete', () => {
  const { useMetricSystem } = jest.requireMock('@/shared/app');
  useMetricSystem.mockReturnValue(false);

  const screen = renderPicker();

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

  const screen = renderPicker();
  await waitFor(() => expect(screen.getByText(/75%/)).toBeTruthy());
  expect(
    screen.getByTestId('route-overlay-list').props.data.map((group: { id: string }) => group.id)
  ).toEqual(['long', 'short', 'unknown']);
  act(() => useRecordingStore.setState({ streams }));
});
