/**
 * Scenario: the activity hero map draws up to six round buttons down its right edge, some only
 * when the activity has the data for them.
 *
 * Expected behaviour: the column never runs past the hero, wrapping into a second column when the
 * buttons do not fit, and the footprint it reports is the width the hero's text must leave clear,
 * sized to the buttons actually drawn.
 */

import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { layout, spacing } from '@/theme';
import {
  MAX_MAP_CONTROLS,
  activityMapControlCount,
  mapControlColumnLayout,
  useMapControlColumn,
} from '@/features/maps/lib/mapControlColumnLayout';

const SMALLEST_HERO = Math.round(560 * 0.42);
const TOP = 48;
const BUTTON = layout.minTapTarget;

describe('mapControlColumnLayout', () => {
  it('keeps every button inside the hero at the smallest hero height with six buttons', () => {
    const result = mapControlColumnLayout(MAX_MAP_CONTROLS, SMALLEST_HERO, TOP);
    expect(TOP + result.maxHeight).toBeLessThanOrEqual(SMALLEST_HERO);
    const perColumn = Math.floor((result.maxHeight + spacing.sm) / (BUTTON + spacing.sm));
    expect(perColumn * result.columns).toBeGreaterThanOrEqual(MAX_MAP_CONTROLS);
  });

  it('uses one column when the buttons fit', () => {
    const result = mapControlColumnLayout(3, 600, TOP);
    expect(result.columns).toBe(1);
    expect(result.footprint).toBe(layout.cardMargin + BUTTON + spacing.sm);
  });

  it('widens the footprint by one button and gap per extra column', () => {
    const one = mapControlColumnLayout(1, 600, TOP);
    const two = mapControlColumnLayout(MAX_MAP_CONTROLS, SMALLEST_HERO, TOP);
    expect(two.footprint).toBe(one.footprint + (two.columns - 1) * (BUTTON + spacing.sm));
  });

  it('reserves nothing for no buttons', () => {
    expect(mapControlColumnLayout(0, 300, TOP).footprint).toBe(0);
  });
});

describe('activityMapControlCount', () => {
  it('counts the style, compass and location buttons that are always drawn', () => {
    expect(
      activityMapControlCount({
        shown: true,
        hasGradientData: false,
        hasRoute: false,
        enableFullscreen: false,
      })
    ).toBe(3);
  });

  it('counts every optional button when all are drawn', () => {
    expect(
      activityMapControlCount({
        shown: true,
        hasGradientData: true,
        hasRoute: true,
        enableFullscreen: true,
      })
    ).toBe(MAX_MAP_CONTROLS);
  });

  it('counts each optional button on its own', () => {
    const base = { shown: true, hasGradientData: false, hasRoute: false, enableFullscreen: false };
    expect(activityMapControlCount({ ...base, hasGradientData: true })).toBe(4);
    expect(activityMapControlCount({ ...base, hasRoute: true })).toBe(4);
    expect(activityMapControlCount({ ...base, enableFullscreen: true })).toBe(4);
  });

  it('counts nothing when the column is hidden', () => {
    expect(
      activityMapControlCount({
        shown: false,
        hasGradientData: true,
        hasRoute: true,
        enableFullscreen: true,
      })
    ).toBe(0);
  });
});

describe('useMapControlColumn', () => {
  const METRICS = {
    frame: { x: 0, y: 0, width: 360, height: 800 },
    insets: { top: 24, left: 0, right: 0, bottom: 0 },
  };
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SafeAreaProvider, { initialMetrics: METRICS }, children);

  it('reserves one column for three buttons on a hero where six would wrap', async () => {
    const height = 320;
    const { result: three } = await renderHook(() => useMapControlColumn(height, 3), { wrapper });
    const { result: six } = await renderHook(() => useMapControlColumn(height, MAX_MAP_CONTROLS), {
      wrapper,
    });
    expect(six.current.columns).toBeGreaterThan(1);
    expect(three.current.columns).toBe(1);
    expect(three.current.footprint).toBeLessThan(six.current.footprint);
  });

  it('reserves nothing when no button is drawn', async () => {
    const { result } = await renderHook(() => useMapControlColumn(320, 0), { wrapper });
    expect(result.current.footprint).toBe(0);
  });
});
