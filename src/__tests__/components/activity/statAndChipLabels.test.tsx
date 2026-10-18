/**
 * Scenario: a stats grid card and a chart chip are each one pressable, so a
 * screen reader speaks their label in place of what they draw, and a stream
 * lane's title carries the value the chip used to.
 *
 * Expected behaviour: the label carries what the element draws, not the bare
 * title, and a chip draws no value so it speaks its stream alone. A lane at
 * rest draws the activity's average, and says so where it is drawn and where
 * it is spoken, so it never reads as a live reading.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { StatCard } from '@/features/activity/components/stats/StatCard';
import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { streamsFromArrays } from '@/features/activity/lib/streams';
import { laneReadout } from '@/features/stats/lib/combinedPlotData';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the stats grid card label', () => {
  it('speaks the title, the value and the context', () => {
    const tree = render(
      <StatCard
        stat={{
          title: 'Power',
          value: '245',
          context: 'Above your average',
          icon: 'lightning-bolt',
        }}
        isDark={false}
        onPress={() => {}}
      />
    );
    expect(tree.getByRole('button').props.accessibilityLabel).toBe(
      'Power, 245, Above your average'
    );
  });

  it('speaks no empty context', () => {
    const tree = render(
      <StatCard
        stat={{ title: 'Power', value: '245', icon: 'lightning-bolt' }}
        isDark={false}
        onPress={() => {}}
      />
    );
    expect(tree.getByRole('button', { name: 'Power, 245' })).toBeTruthy();
  });
});

describe('the chart chip label', () => {
  const power = CHART_CONFIGS.power;

  it('speaks the stream name alone, since the chip carries no value', () => {
    const tree = render(
      <ChartTypeSelector available={[power]} selected={['power']} onToggle={() => {}} />
    );
    expect(tree.getByTestId('chart-type-power').props.accessibilityLabel).toBe('Power');
  });
});

describe('the lane readout at rest', () => {
  const streams = streamsFromArrays({
    time: [0, 60],
    distance: [0, 500],
    watts: [200, 224],
    altitude: [100, 130],
  });

  it('is marked as an average, and the climb as its gain', () => {
    expect(laneReadout(CHART_CONFIGS.power, streams.watts!, null, true, 30).mark).toBe('average');
    expect(laneReadout(CHART_CONFIGS.elevation, streams.altitude!, null, true, 30).mark).toBe(
      'gain'
    );
  });

  it('drops the mark while scrubbing', () => {
    expect(laneReadout(CHART_CONFIGS.power, streams.watts!, 1, true, 30).mark).toBeNull();
  });

  it('draws and speaks the average mark beside the value', async () => {
    const tree = await render(
      <ActivityStreams
        streams={streams}
        elevationGain={0}
        selectedCharts={['power']}
        chartConfigs={CHART_CONFIGS}
      />
    );
    for (const box of tree.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout)) {
      await act(async () => {
        await fireEvent(box, 'layout', { nativeEvent: { layout: { width: 320, height: 56 } } });
      });
    }
    expect(tree.getByTestId('activity-lane-power-average')).toBeTruthy();
    expect(tree.getByTestId('activity-lane-power-value').props.accessibilityLabel).toBe(
      'Average 212 W'
    );
  });
});
