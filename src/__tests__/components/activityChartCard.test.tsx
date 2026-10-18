/**
 * Scenario: the activity's chart sat in three cards, with its chips in none:
 * the chips above every card, the switch and the lanes in one, the "intervals
 * not downloaded" row in another and the Intervals bar in a third.
 *
 * Expected behaviour: one card holds the chips, the Distance / Time switch,
 * the lanes and the Intervals row, in that order. Streams not downloaded, the
 * card holds that message where the lanes would be; with no streams at all it
 * holds the Intervals row alone. The zone charts stay cards of their own.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import type { ActivityInterval, ActivityStreams } from '@/types';
import { IntervalKind, type ActivityRecord, type HrZoneBand } from 'veloqrs';
import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/features/activity/components/ActivityStreams', () => {
  const { View } = require('react-native');
  return { ActivityStreams: () => <View testID="activity-plot" /> };
});
jest.mock('@/features/activity/components/HRZonesChart', () => {
  const { View } = require('react-native');
  return { HRZonesChart: () => <View testID="hr-zones-chart" /> };
});
jest.mock('@/features/activity/components/IntervalsTable', () => {
  const { View } = require('react-native');
  return { IntervalsTable: () => <View testID="intervals-table" /> };
});
jest.mock('@/features/activity/components/stats', () => ({ InsightfulStats: () => null }));
jest.mock('@/features/routes', () => ({
  DebugInfoPanel: () => null,
  DebugWarningBanner: () => null,
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));

const intervals: ActivityInterval[] = [
  {
    id: 1,
    kind: IntervalKind.Work,
    zone: 3,
    movingTime: 300,
    startTime: 0,
    endTime: 300,
    startIndex: 0,
    endIndex: 2,
  },
];

const streams: ActivityStreams = {
  time: Float64Array.from([0, 60, 120]),
  distance: Float64Array.from([0, 400, 800]),
  watts: Float64Array.from([180, 200, 220]),
  heartrate: Float64Array.from([130, 140, 150]),
};

const hrZones = [{ zone: 1, name: 'Z1', min: 0, max: 120, seconds: 60 }] as unknown as HrZoneBand[];

function activity(): ActivityRecord {
  return activityRecord({
    id: 'glaze-1',
    sportType: 'Ride',
    name: 'Kiln loop',
    startDateLocal: '2026-03-02T07:00:00',
  });
}

function renderSection(props: {
  streams?: ActivityStreams;
  streamsDownloaded?: boolean;
  intervalsData?: ActivityInterval[];
  intervalsOutcome?: 'loaded' | 'empty' | 'pending';
  hrZones?: HrZoneBand[];
}) {
  return render(
    <ActivityChartsSection
      activity={activity()}
      activityId="glaze-1"
      streams={props.streams}
      streamsDownloaded={props.streamsDownloaded}
      intervalsData={props.intervalsData}
      intervalsOutcome={props.intervalsOutcome}
      hrZones={props.hrZones}
      activityWellness={null}
      coordinates={[]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      transitionSettled={false}
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
    />
  );
}

/** The test ids in the card, in the order they are drawn. */
function idsInCard(): string[] {
  const card = screen.getByTestId('activity-chart-card');
  return card
    .findAll((node: ReactTestInstance) => typeof node.props.testID === 'string', { deep: true })
    .map((node) => node.props.testID as string);
}

const inCard = (id: string) =>
  within(screen.getByTestId('activity-chart-card')).queryAllByTestId(id).length > 0;

describe('the activity chart card', () => {
  it('holds the chips, the switch, the lanes and the Intervals row, in that order', async () => {
    await renderSection({ streams, intervalsData: intervals, intervalsOutcome: 'loaded' });

    for (const id of [
      'chart-type-selector',
      'chart-x-axis-distance',
      'activity-plot',
      'activity-interval-table',
    ]) {
      expect(inCard(id)).toBe(true);
    }
    const order = idsInCard();
    const at = (id: string) => order.indexOf(id);
    expect(at('chart-type-selector')).toBeLessThan(at('chart-x-axis-distance'));
    expect(at('chart-x-axis-distance')).toBeLessThan(at('activity-plot'));
    expect(at('activity-plot')).toBeLessThan(at('row-divider'));
    expect(at('row-divider')).toBeLessThan(at('activity-interval-table'));
  });

  it('holds the intervals still owed below the lanes', async () => {
    await renderSection({ streams, intervalsOutcome: 'pending' });
    expect(inCard('intervals-not-downloaded')).toBe(true);
    expect(inCard('activity-plot')).toBe(true);
    expect(inCard('row-divider')).toBe(true);
  });

  it('holds the streams message where the lanes would be, with the Intervals row below', async () => {
    await renderSection({
      streamsDownloaded: false,
      intervalsData: intervals,
      intervalsOutcome: 'loaded',
    });
    const order = idsInCard();
    expect(order).toContain('streams-not-downloaded');
    expect(order.indexOf('streams-not-downloaded')).toBeLessThan(
      order.indexOf('activity-interval-table')
    );
  });

  it('holds the Intervals row alone when there are no streams', async () => {
    await renderSection({ intervalsData: intervals, intervalsOutcome: 'loaded' });
    expect(inCard('activity-interval-table')).toBe(true);
    expect(inCard('chart-type-selector')).toBe(false);
    expect(inCard('activity-plot')).toBe(false);
    expect(inCard('row-divider')).toBe(false);
  });

  it('keeps the zone chart a card of its own', async () => {
    await renderSection({ streams, hrZones });
    expect(screen.getByTestId('activity-zone-chart')).toBeTruthy();
    expect(inCard('activity-zone-chart')).toBe(false);
    expect(inCard('hr-zones-chart')).toBe(false);
  });
});
