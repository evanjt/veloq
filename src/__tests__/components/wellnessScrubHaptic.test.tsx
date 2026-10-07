/**
 * Scenario: holding the wellness trends chart showed the crosshair with no
 * haptic, where the same hold on the fitness chart gives a light tick.
 *
 * Expected behaviour: the hold fires one light impact when it completes, the
 * date under the finger is reported, and lifting the finger clears it.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import type { WellnessData } from '@/types';
import {
  capturePans,
  holdAndScrub,
  longPressPan,
  pressAndLift,
  release,
} from '../__shared__/chartScrub';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  hrv: 40 + (i % 7),
  restingHR: 50 + (i % 5),
  sleepSecs: 25_200 + i * 60,
  sleepScore: 70 + (i % 10),
  weight: 72 + (i % 3) * 0.2,
}));

function layout(tree: ReturnType<typeof render>, width = 360) {
  const container = tree.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  act(() => {
    fireEvent(container!, 'layout', { nativeEvent: { layout: { width, height: 300 } } });
  });
}

describe('wellness trends scrub', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fires one light impact when the hold completes', async () => {
    const built = capturePans();
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    layout(tree);

    await holdAndScrub(longPressPan(built), 300);

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('fires no impact for a touch released before the hold completes', async () => {
    const built = capturePans();
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    layout(tree);

    await pressAndLift(longPressPan(built), 300, 50);

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('reports the scrubbed date at the first and last day and clears it on release', async () => {
    const built = capturePans();
    const onDateSelect = jest.fn();
    const tree = render(
      <WellnessTrendsChart data={DAYS} timeRange="1m" onDateSelect={onDateSelect} />
    );
    layout(tree);

    const pan = longPressPan(built);
    await holdAndScrub(pan, 300);
    expect(onDateSelect).toHaveBeenLastCalledWith('2026-06-30');

    await holdAndScrub(pan, 80);
    expect(onDateSelect).toHaveBeenLastCalledWith('2026-06-01');

    await release(pan);
    expect(onDateSelect).toHaveBeenLastCalledWith(null);
  });

  it('snaps to the day under the finger after the chart is resized', async () => {
    const built = capturePans();
    const onDateSelect = jest.fn();
    const tree = render(
      <WellnessTrendsChart data={DAYS} timeRange="1m" onDateSelect={onDateSelect} />
    );
    layout(tree, 360);
    layout(tree, 560);

    // 360 wide puts day 30 near x=300; at 560 that x is only about two-thirds across.
    await holdAndScrub(longPressPan(built), 300);

    expect(onDateSelect).toHaveBeenLastCalledWith('2026-06-16');
  });
});
