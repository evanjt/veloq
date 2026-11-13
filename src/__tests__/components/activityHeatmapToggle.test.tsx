/**
 * Scenario: the athlete opens a flight whose long straight line crosses the
 * heatmap and hides it, then shows it again.
 *
 * Expected behaviour: the activity's charts tab offers the choice under the
 * GPX export, names the action the next press takes, hands the press to the
 * screen, and offers nothing for an activity with no track.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  return {
    Card: jest.requireActual('@/shared/ui/Card').Card,
    Button: jest.requireActual('@/shared/ui/Button').Button,
    IconButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    pressable: (style: unknown) => style,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DeviceAttribution: () => <View testID="device-attribution" />,
    ScreenSafeAreaView: View,
  };
});

jest.mock('@/features/activity/components/ChartTypeSelector', () => ({
  ChartTypeSelector: () => null,
}));
jest.mock('@/features/activity/components/ActivityStreams', () => ({
  ActivityStreams: () => null,
}));
jest.mock('@/features/activity/components/HRZonesChart', () => ({ HRZonesChart: () => null }));
jest.mock('@/features/activity/components/PowerZonesChart', () => ({
  PowerZonesChart: () => null,
}));
jest.mock('@/features/activity/components/IntervalsTable', () => ({
  IntervalsTable: () => null,
}));
jest.mock('@/features/activity/components/stats', () => ({ InsightfulStats: () => null }));
jest.mock('@/features/routes', () => ({
  DebugInfoPanel: () => null,
  DebugWarningBanner: () => null,
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));

const activity = activityRecord({ id: 'flight-1', sportType: 'Ride', name: 'Night flight' });
const frames: FrameRequestCallback[] = [];

function section(options: { hidden: boolean; withTrack?: boolean; onToggle?: () => void }) {
  return (
    <ActivityChartsSection
      activity={activity}
      activityId="flight-1"
      streams={undefined}
      streamsDownloaded
      intervalsData={undefined}
      activityWellness={null}
      coordinates={options.withTrack === false ? [] : [{ latitude: 1, longitude: 2 }]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      transitionSettled
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
      heatmapHidden={options.hidden}
      onToggleHeatmapHidden={options.onToggle ?? (() => {})}
    />
  );
}

async function mountBelowFold(element: React.ReactElement) {
  await render(element);
  const pending = frames.splice(0);
  await act(() => pending.forEach((callback) => callback(0)));
}

beforeEach(() => {
  frames.length = 0;
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('offers to hide an activity that is on the heatmap, and passes the press on', async () => {
  const onToggle = jest.fn();
  await mountBelowFold(section({ hidden: false, onToggle }));

  expect(screen.getByText('activityDetail.hideFromHeatmap')).toBeTruthy();
  expect(screen.queryByText('activityDetail.showOnHeatmap')).toBeNull();

  await fireEvent.press(screen.getByTestId('activity-heatmap-toggle'));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

vaultIt('offers to show an activity that is hidden', async () => {
  await mountBelowFold(section({ hidden: true }));

  expect(screen.getByText('activityDetail.showOnHeatmap')).toBeTruthy();
  expect(screen.queryByText('activityDetail.hideFromHeatmap')).toBeNull();
});

it('offers nothing for an activity with no track, which the heatmap never held', async () => {
  await mountBelowFold(section({ hidden: false, withTrack: false }));

  expect(screen.queryByTestId('activity-heatmap-toggle')).toBeNull();
});
