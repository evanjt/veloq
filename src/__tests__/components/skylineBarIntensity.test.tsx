/**
 * Scenario: the feed card's zone skyline showed an activity's intensity by
 * hue alone, so two zones a colour-blind reader cannot tell apart read as one,
 * and a screen reader heard nothing.
 *
 * Expected behaviour: each segment stands taller the harder its zone, and the
 * bar carries a label naming the time spent in each zone.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { initialiseI18n } from '@/i18n';
import { SkylineBar } from '@/features/activity/components/SkylineBar';

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function encodePacked(fieldNumber: number, values: number[]): number[] {
  const payload: number[] = [];
  for (const v of values) payload.push(...encodeVarint(v));
  return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(payload.length), ...payload];
}

function skyline(durations: number[], zones: number[], zoneBasis = 1): string {
  const bytes = [
    ...encodeVarint(1 << 3),
    ...encodeVarint(7),
    ...encodePacked(2, durations),
    ...encodePacked(
      3,
      zones.map(() => 100)
    ),
    ...encodePacked(4, zones),
    ...encodeVarint(5 << 3),
    ...encodeVarint(zoneBasis),
  ];
  return btoa(String.fromCharCode(...bytes));
}

function heightOf(node: ReactTestInstance): number {
  return Number(StyleSheet.flatten(node.props.style).height);
}

describe('the zone skyline', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('stands a threshold segment taller than an endurance one', async () => {
    const { getByTestId } = await render(
      <SkylineBar skylineBytes={skyline([600, 300, 600, 300], [2, 4, 2, 4])} isDark={false} />
    );

    const endurance = [0, 2].map((i) => heightOf(getByTestId(`skyline-segment-${i}`)));
    const threshold = [1, 3].map((i) => heightOf(getByTestId(`skyline-segment-${i}`)));

    const [enduranceFirst, enduranceSecond] = endurance;
    const [thresholdFirst, thresholdSecond] = threshold;
    expect(enduranceFirst).toBeGreaterThan(0);
    expect(enduranceSecond).toBe(enduranceFirst);
    expect(thresholdSecond).toBe(thresholdFirst);
    expect(thresholdFirst).toBeGreaterThan(enduranceFirst ?? Infinity);
  });

  it('orders every zone by height, the lowest still drawn', async () => {
    const zones = [7, 6, 5, 4, 3, 2, 1];
    const { getByTestId } = await render(
      <SkylineBar
        skylineBytes={skyline(
          zones.map(() => 60),
          zones
        )}
        isDark={false}
      />
    );

    const heights = zones.map((_, i) => heightOf(getByTestId(`skyline-segment-${i}`)));

    const descending = [...heights].sort((a, b) => b - a);
    expect(heights).toEqual(descending);
    expect(new Set(heights).size).toBe(heights.length);
    expect(Math.min(...heights)).toBeGreaterThan(0);
  });

  it('labels the bar with the time in each zone, summed across its segments', async () => {
    const { getByLabelText } = await render(
      <SkylineBar skylineBytes={skyline([600, 300, 600, 300], [2, 4, 2, 4])} isDark={false} />
    );

    expect(
      getByLabelText('Time in Power Zones: Z2 Endurance 20 min, Z4 Threshold 10 min')
    ).toBeTruthy();
  });

  it('names heart rate zones from the heart rate list', async () => {
    const { getByLabelText } = await render(
      <SkylineBar skylineBytes={skyline([90, 1800], [5, 1], 2)} isDark={false} />
    );

    expect(
      getByLabelText('Time in HR Zones: Z1 Recovery 30 min, Z5 Super-threshold 1 min 30 s')
    ).toBeTruthy();
  });

  it('draws nothing for an empty skyline', async () => {
    const { toJSON } = await render(<SkylineBar skylineBytes="" isDark={false} />);

    expect(toJSON()).toBeNull();
  });
});
