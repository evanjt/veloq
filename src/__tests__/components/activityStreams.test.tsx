/**
 * Scenario: an activity's power, heart rate and elevation are drawn on the
 * activity screen.
 *
 * Expected behaviour: each stream is a lane of its own, titled with its full
 * name and unit, with its own lowest and highest value in a gutter beside it.
 * The readout row above keys each stream with a short line in its colour,
 * names it in the text colour and gives its value and unit, and the elevation
 * readout says it is the gain.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { computeAllAverages } from '@/features/stats/lib/combinedPlotData';
import { chartStreamColour, colors } from '@/theme';
import { initialiseI18n } from '@/i18n';
import type { ActivityStreams as Streams } from '@/types';

jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

// Ten samples a kilometre apart.
const GLAZE_RIDE: Streams = {
  time: Float64Array.from({ length: 10 }, (_, i) => i * 120),
  distance: Float64Array.from({ length: 10 }, (_, i) => i * 1000),
  watts: Float64Array.from({ length: 10 }, (_, i) => 200 + i * 10),
  heartrate: Float64Array.from({ length: 10 }, (_, i) => 130 + i),
  altitude: Float64Array.from({ length: 10 }, (_, i) => 500 + i * 4),
};

/** Lays out every view that measures itself, as the lanes would be on screen. */
async function layOut(width = 320) {
  for (const box of screen.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout)) {
    await act(async () => {
      await fireEvent(box, 'layout', { nativeEvent: { layout: { width, height: 56 } } });
    });
  }
}

beforeAll(async () => {
  await initialiseI18n();
});

describe('the activity stream lanes', () => {
  async function drawLanes() {
    await render(
      <ActivityStreams
        streams={GLAZE_RIDE}
        elevationGain={36}
        selectedCharts={['power', 'heartrate', 'elevation']}
        chartConfigs={CHART_CONFIGS}
      />
    );
    await layOut();
  }

  it('draws one lane per selected stream, titled with its full name and unit', async () => {
    await drawLanes();

    for (const id of ['power', 'heartrate', 'elevation']) {
      expect(screen.getByTestId(`activity-lane-${id}`)).toBeTruthy();
    }
    expect(screen.getByText('Power (W)')).toBeTruthy();
    expect(screen.getByText('Heart rate (bpm)')).toBeTruthy();
    expect(screen.getByText('Elevation (m)')).toBeTruthy();
  });

  it('labels each lane with its own lowest and highest value', async () => {
    await drawLanes();
    const tick = (id: string) =>
      screen.getByTestId(id, { includeHiddenElements: true }).props.children;

    expect(tick('activity-lane-power-max')).toBe('290');
    expect(tick('activity-lane-power-min')).toBe('0');
    expect(tick('activity-lane-heartrate-max')).toBe('139');
    expect(tick('activity-lane-heartrate-min')).toBe('130');
    expect(tick('activity-lane-elevation-max')).toBe('536');
    expect(tick('activity-lane-elevation-min')).toBe('500');
  });

  it('keeps the lane values from a screen reader, which hears the summary', async () => {
    await drawLanes();
    expect(screen.queryByTestId('activity-lane-power-max')).toBeNull();
  });
});

describe('the stream readout row', () => {
  const available = [CHART_CONFIGS.power, CHART_CONFIGS.heartrate, CHART_CONFIGS.elevation];

  async function drawReadout(selected: string[]) {
    await render(
      <ChartTypeSelector
        available={available}
        selected={selected}
        onToggle={jest.fn()}
        metricValues={computeAllAverages(CHART_CONFIGS, GLAZE_RIDE, true, 36)}
      />
    );
  }

  it('gives one entry per stream with its value and unit', async () => {
    await drawReadout(['power', 'heartrate', 'elevation']);

    expect(screen.getByRole('button', { name: /Power, average 245 W/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /HR, average 135 bpm/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Elev, gain \+36 m/i })).toBeTruthy();
  });

  it('labels the elevation readout as the gain', async () => {
    await drawReadout(['elevation']);
    expect(screen.getByTestId('chart-type-elevation-gain')).toBeTruthy();
  });

  it('keys each stream with a short line in its colour', async () => {
    await drawReadout([]);
    for (const config of available) {
      const key = StyleSheet.flatten(screen.getByTestId(`chart-type-${config.id}-key`).props.style);
      expect(key.backgroundColor).toBe(chartStreamColour(config.stream, false));
      expect(key.width).toBeGreaterThan(key.height);
    }
  });

  it('sets an unselected chip on a neutral ground, not the stream colour', async () => {
    await drawReadout([]);
    const ground = StyleSheet.flatten(
      screen.getByTestId('chart-type-power').props.style
    ).backgroundColor;
    const label = StyleSheet.flatten(screen.getByText('Power').props.style).color;

    expect(ground).toBe(colors.fillNeutral);
    expect(label).toBe(colors.textPrimary);
  });
});
