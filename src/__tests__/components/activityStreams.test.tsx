/**
 * Scenario: an activity's power, heart rate and elevation are drawn on the
 * activity screen.
 *
 * Expected behaviour: each stream is a lane of its own, titled with its full
 * name and unit and its value on the same line, with its own lowest and
 * highest value in a gutter beside it. At rest a lane reads its average and
 * elevation the climb's gain, each marked so; a scrub reads the sample with no
 * mark. The chips above are one line of toggles, each keyed by a short line in
 * its colour and named in the text colour, with no value.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { CHIP_HEIGHT, ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { chartStreamColour, colors } from '@/theme';
import { capturePans, release, scrub, scrubPan } from '../__shared__/chartScrub';
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

/** Every string a host element draws, nested text included. */
function drawnText(node: ReactTestInstance): string {
  return node.children
    .map((child: ReactTestInstance | string) =>
      typeof child === 'string' ? child : drawnText(child)
    )
    .join('');
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

describe('each lane title readout', () => {
  async function drawLanes() {
    const pans = capturePans();
    await render(
      <ActivityStreams
        streams={GLAZE_RIDE}
        elevationGain={36}
        selectedCharts={['power', 'heartrate', 'elevation']}
        chartConfigs={CHART_CONFIGS}
      />
    );
    await layOut();
    return pans;
  }

  const value = (id: string) => drawnText(screen.getByTestId(`activity-lane-${id}-value`));

  afterEach(() => jest.restoreAllMocks());

  it('reads each line lane at rest as its average, marked so', async () => {
    await drawLanes();
    expect(value('power')).toBe('avg 245');
    expect(screen.getByTestId('activity-lane-power-average')).toBeTruthy();
    expect(value('heartrate')).toBe('avg 135');
    expect(screen.getByTestId('activity-lane-heartrate-average')).toBeTruthy();
  });

  it('reads elevation at rest as the gain, marked so', async () => {
    await drawLanes();
    expect(value('elevation')).toBe('gain +36');
    expect(screen.getByTestId('activity-lane-elevation-gain')).toBeTruthy();
    expect(screen.queryByTestId('activity-lane-elevation-average')).toBeNull();
  });

  it('speaks the mark, the value and the unit', async () => {
    await drawLanes();
    expect(screen.getByTestId('activity-lane-power-value').props.accessibilityLabel).toBe(
      'Average 245 W'
    );
    expect(screen.getByTestId('activity-lane-elevation-value').props.accessibilityLabel).toBe(
      'gain +36 m'
    );
  });

  it('keeps the name and the value on the one title line', async () => {
    await drawLanes();
    const lane = screen.getByTestId('activity-lane-power');
    const value = screen.getByTestId('activity-lane-power-value');
    const titleRow = lane
      .findAll((node) => node.type === View)
      .find((node) => node.findAll((n) => n === value).length > 0 && node !== lane);
    expect(StyleSheet.flatten(titleRow?.props.style).flexDirection).toBe('row');
    expect(screen.getByText('Power (W)')).toBeTruthy();
  });

  it('reads the scrubbed sample with no mark, and the rest value again on release', async () => {
    const pans = await drawLanes();
    const pan = scrubPan(pans);
    await scrub(pan, 200, [210]);

    const samples = (from: number, step: number) =>
      Array.from({ length: 10 }, (_, i) => String(from + i * step));
    expect(samples(200, 10)).toContain(value('power'));
    expect(samples(130, 1)).toContain(value('heartrate'));
    expect(samples(500, 4)).toContain(value('elevation'));
    expect(screen.queryByTestId('activity-lane-power-average')).toBeNull();
    expect(screen.queryByTestId('activity-lane-heartrate-average')).toBeNull();
    expect(screen.queryByTestId('activity-lane-elevation-gain')).toBeNull();

    await release(pan);
    expect(value('power')).toBe('avg 245');
    expect(screen.getByTestId('activity-lane-elevation-gain')).toBeTruthy();
  });
});

describe('the stream toggles', () => {
  const eight = [
    CHART_CONFIGS.power,
    CHART_CONFIGS.heartrate,
    CHART_CONFIGS.elevation,
    CHART_CONFIGS.cadence,
    CHART_CONFIGS.speed,
    CHART_CONFIGS.grade,
    CHART_CONFIGS.temp,
    CHART_CONFIGS.pace,
  ];
  const available = eight.slice(0, 3);

  async function drawToggles(selected: string[], configs = available) {
    await render(
      <ChartTypeSelector available={configs} selected={selected} onToggle={jest.fn()} />
    );
  }

  it('lays the chips on one horizontally scrolling row', async () => {
    await drawToggles(['power'], eight);
    const row = screen.getByTestId('chart-type-selector');
    expect(row.props.horizontal).toBe(true);
    const content = StyleSheet.flatten(
      screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle
    );
    expect(content.flexDirection).toBe('row');
    expect(content.flexWrap).toBeUndefined();
  });

  it('draws each chip as one line at the chip height, with no value or mark', async () => {
    await drawToggles(['power', 'heartrate', 'elevation'], eight);
    for (const config of eight) {
      const chip = screen.getByTestId(`chart-type-${config.id}`);
      const style = StyleSheet.flatten(chip.props.style);
      expect(style.flexDirection).toBe('row');
      expect(style.minHeight).toBe(CHIP_HEIGHT);
      expect(drawnText(chip)).not.toMatch(/\d/);
      expect(screen.queryByTestId(`chart-type-${config.id}-average`)).toBeNull();
      expect(screen.queryByTestId(`chart-type-${config.id}-gain`)).toBeNull();
    }
  });

  it('names each chip by its stream and gives its selected state', async () => {
    await drawToggles(['power']);
    const power = screen.getByTestId('chart-type-power');
    expect(power.props.accessibilityLabel).toBe('Power');
    expect(power.props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('chart-type-elevation').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('keys each stream with a short line in its colour', async () => {
    await drawToggles([]);
    for (const config of available) {
      const key = StyleSheet.flatten(screen.getByTestId(`chart-type-${config.id}-key`).props.style);
      expect(key.backgroundColor).toBe(chartStreamColour(config.stream, false));
      expect(key.width).toBeGreaterThan(key.height);
    }
  });

  it('sets an unselected chip on a neutral ground, not the stream colour', async () => {
    await drawToggles([]);
    const ground = StyleSheet.flatten(
      screen.getByTestId('chart-type-power').props.style
    ).backgroundColor;
    const label = StyleSheet.flatten(screen.getByText('Power').props.style).color;

    expect(ground).toBe(colors.fillNeutral);
    expect(label).toBe(colors.textPrimary);
  });
});
