/**
 * Scenario: one zone holds an hour, another ten minutes, a third one minute,
 * and a fourth twenty seconds, which the engine rounds to a share of 0.
 *
 * Expected behaviour: the longest zone fills the track and every other bar is
 * its time over the longest, so short zones stay readable. A zone with any
 * time keeps a visible bar and prints its time, and only a zone with no time
 * reads as absent.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { ZoneHistogram, type ZoneBand } from '@/shared/charts/ZoneHistogram';
import { ABSENT } from '@/shared/format/absent';

const band = (zone: number, seconds: number, share: number): ZoneBand => ({
  key: zone,
  label: `Z${zone}`,
  zone,
  seconds,
  share,
  primary: `${seconds}s`,
});

const BANDS = [band(1, 3600, 84), band(2, 600, 15), band(3, 60, 1), band(4, 20, 0), band(5, 0, 0)];

async function drawn(bands: readonly ZoneBand[]) {
  const view = await render(<ZoneHistogram title="Zones" bands={bands} />);
  const bar = (zone: number) =>
    StyleSheet.flatten(view.getByTestId(`zone-bar-${zone}`).props.style);
  const texts = view
    .UNSAFE_queryAllByType(Text)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');
  return { bar, texts };
}

const percent = (width: unknown) => Number(String(width).replace('%', ''));

describe('zone bar scale', () => {
  it('fills the track with the longest zone and scales the rest to it', async () => {
    const { bar } = await drawn(BANDS);

    expect(percent(bar(1).width)).toBeCloseTo(100);
    expect(percent(bar(2).width)).toBeCloseTo(100 / 6);
    expect(percent(bar(3).width)).toBeCloseTo(100 / 60);
  });

  it('keeps a zone with time but no whole share visible, with its time', async () => {
    const { bar, texts } = await drawn(BANDS);

    expect(percent(bar(4).width)).toBeGreaterThan(0);
    expect(bar(4).minWidth).toBeGreaterThanOrEqual(2);
    expect(texts).toContain('60s');
    expect(texts).toContain('20s');
  });

  it('reads a zone with no time as absent and draws no bar for it', async () => {
    const { bar, texts } = await drawn(BANDS);

    expect(percent(bar(5).width)).toBe(0);
    expect(bar(5).minWidth ?? 0).toBe(0);
    expect(texts.filter((text) => text === ABSENT)).toHaveLength(2);
  });

  it('draws nothing past the track when every zone is empty', async () => {
    const { bar } = await drawn([band(1, 0, 0), band(2, 0, 0)]);

    expect(percent(bar(1).width)).toBe(0);
    expect(percent(bar(2).width)).toBe(0);
  });

  it('ends each bar in the shared 4px rounded end rather than a pill', async () => {
    const { bar } = await drawn(BANDS);

    expect(bar(1).borderRadius).toBe(4);
  });
});
