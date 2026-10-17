/**
 * Scenario: the wellness trends chart recorded one Skia picture holding both
 * the five sparklines and the selection marks, keyed on the scrub index, so a
 * drag re-parsed five SVG path strings per tick. It also rebuilt its pan
 * gesture on every render.
 *
 * Expected behaviour: the sparklines are recorded once per data and layout
 * change, the selection is its own picture, and the gesture outlives the scrub.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import type { WellnessData } from '@/types';
import { capturePans, scrub, scrubPan } from '../__shared__/chartScrub';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  hrv: 40 + (i % 7),
  restingHR: 50 + (i % 5),
  sleepSecs: 25_200 + i * 60,
  sleepScore: 70 + (i % 10),
  weight: 72 + (i % 3) * 0.2,
}));

/** The chart sizes itself from its container's onLayout, so give it a width. */
async function layout(tree: Awaited<ReturnType<typeof render>>) {
  const container = tree.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  await act(async () => {
    await fireEvent(container!, 'layout', { nativeEvent: { layout: { width: 360, height: 300 } } });
  });
}

describe('wellness trends scrub', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('records the sparklines once and re-records none of them on a scrub tick', async () => {
    const built = capturePans();
    const svg = jest.spyOn(Skia.Path, 'MakeFromSVGString');
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    await layout(tree);

    const atRest = svg.mock.calls.length;
    expect(atRest).toBe(5);

    await scrub(scrubPan(built), 120, [160, 200]);

    expect(svg.mock.calls.length).toBe(atRest);
  });

  it('keeps one gesture across the scrub', async () => {
    const built = capturePans();
    const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    await layout(tree);

    const beforeScrub = built.length;
    await scrub(scrubPan(built), 120, [160, 200]);

    expect(built.length).toBe(beforeScrub);
  });
});
