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
