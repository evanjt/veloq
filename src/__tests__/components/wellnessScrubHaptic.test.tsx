/**
 * Scenario: scrubbing the wellness trends chart showed the crosshair with no
 * haptic, where the same scrub on the fitness chart gives a light tick.
 *
 * Expected behaviour: the scrub fires one light impact when it starts, the
 * date under the finger is shown in the chart header, and lifting the finger
 * returns the header to the newest reading.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { formatShortDateWithWeekday } from '@/shared/format/format';
import type { WellnessData } from '@/types';
import { capturePans, scrub, scrubPan, pressAndLift, release } from '../__shared__/chartScrub';

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

// The label and value columns the first row lays out either side of the sparkline column.
const LABEL_SIDE = 93;
const VALUE_SIDE = 63;

/** The canvas is placed over the sparkline column the first row measures, so lay one out. */
async function layout(tree: Awaited<ReturnType<typeof render>>, width = 360) {
  await act(async () => {
    await fireEvent(tree.getByTestId('wellness-sparkline-column-hrv'), 'layout', {
      nativeEvent: {
        layout: { x: LABEL_SIDE, y: 0, width: width - LABEL_SIDE - VALUE_SIDE, height: 50 },
      },
    });
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

  vaultIt('fires one light impact when the scrub starts', async () => {
    const built = capturePans();
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    await layout(tree);

    await scrub(scrubPan(built), 300);

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  vaultIt('fires no impact for a touch lifted without moving', async () => {
    const built = capturePans();
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    await layout(tree);

    await pressAndLift(scrubPan(built), 300, 50);

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('shows the first and last scrubbed day in the header and the newest reading on release', async () => {
    const built = capturePans();
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    await layout(tree);

    const pan = scrubPan(built);
    await scrub(pan, 300);
    expect(tree.getByText(formatShortDateWithWeekday('2026-06-30'))).toBeTruthy();

    await scrub(pan, 80);
    expect(tree.getByText(formatShortDateWithWeekday('2026-06-01'))).toBeTruthy();

    await release(pan);
    expect(tree.queryByText(formatShortDateWithWeekday('2026-06-01'))).toBeNull();
    expect(tree.getByText(formatShortDateWithWeekday('2026-06-30'))).toBeTruthy();
  });

  it('snaps to the day under the finger after the chart is resized', async () => {
    const built = capturePans();
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    await layout(tree, 360);
    await layout(tree, 560);

    // 360 wide puts day 30 near x=300; at 560 that x is only about two-thirds across.
    await scrub(scrubPan(built), 300);

    expect(tree.getByText(formatShortDateWithWeekday('2026-06-16'))).toBeTruthy();
  });
});
