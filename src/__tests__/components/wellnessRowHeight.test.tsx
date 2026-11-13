/**
 * Scenario: the wellness rows share one canvas, as tall as every row, and each
 * row is held to the tallest row's height. A row whose height lands a fraction
 * of a dp over that height on the pixel grid reported a taller row on every
 * layout pass, and the canvas grew until Android refused its texture and
 * aborted the app.
 *
 * Expected behaviour: the row height follows the rows' content, so a row laid
 * out over its height any number of times leaves the canvas where it was, and
 * content that grows or shrinks moves it once to the content's height.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { initialiseI18n } from '@/i18n';
import { spacing, stroke } from '@/theme';
import type { WellnessData } from '@/types';
import { capturePans, release, scrub, scrubPan } from '../__shared__/chartScrub';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const DAYS: WellnessData[] = [44, 45, 43, 62, 44, 46].map((hrv, i) => ({
  id: `2026-05-${String(i + 1).padStart(2, '0')}`,
  hrv,
  restingHR: 50 + (i % 3),
}));
const ROWS = ['hrv', 'rhr'];
const MIN_ROW = 50;
const ROW_CHROME = 2 * spacing.xs + stroke.hairline;

function layout(testID: string, height: number) {
  return fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 100, height } },
  });
}

function canvasHeight() {
  return StyleSheet.flatten(screen.UNSAFE_getByType(Canvas).props.style).height;
}

async function renderRows() {
  await render(<WellnessTrendsChart data={DAYS} timeRange="1m" smoothingWindow={7} />);
  await act(async () => {
    await fireEvent(screen.getByTestId('wellness-sparkline-column-hrv'), 'layout', {
      nativeEvent: { layout: { x: 80, y: 0, width: 200, height: MIN_ROW } },
    });
  });
}

/** Lays each row out a third of a dp over the height it was given, as the pixel grid can. */
async function snapRowsOver(passes: number) {
  for (let pass = 0; pass < passes; pass++) {
    const rowHeight = canvasHeight() / ROWS.length;
    await act(async () => {
      for (const key of ROWS) await layout(`wellness-row-${key}`, rowHeight + 1 / 3);
    });
  }
}

beforeAll(async () => {
  await initialiseI18n();
});

describe('wellness row height', () => {
  it('holds still when a row snaps a fraction over its height on every pass', async () => {
    await renderRows();
    expect(canvasHeight()).toBe(ROWS.length * MIN_ROW);

    await snapRowsOver(8);

    expect(canvasHeight()).toBe(ROWS.length * MIN_ROW);
  });

  it('takes the tallest content once and holds it through repeated passes', async () => {
    await renderRows();
    await act(async () => {
      await layout('wellness-labels-hrv', 30);
      await layout('wellness-readings-hrv', 80.4);
      await layout('wellness-labels-rhr', 30);
      await layout('wellness-readings-rhr', 60);
    });
    const tallest = Math.ceil(80.4 + ROW_CHROME);
    expect(canvasHeight()).toBe(ROWS.length * tallest);

    await snapRowsOver(8);

    expect(canvasHeight()).toBe(ROWS.length * tallest);
  });

  vaultIt('comes back down when the content shrinks, and never under the floor', async () => {
    await renderRows();
    await act(async () => {
      await layout('wellness-readings-hrv', 90);
    });
    expect(canvasHeight()).toBe(ROWS.length * Math.ceil(90 + ROW_CHROME));

    await act(async () => {
      await layout('wellness-readings-hrv', 20);
    });
    expect(canvasHeight()).toBe(ROWS.length * MIN_ROW);
  });
});

/**
 * Scenario: weight was last logged days before the other rows, so at rest its
 * row carries a date while the others carry an average, and while scrubbing
 * each row carries its smoothed value or nothing.
 *
 * Expected behaviour: each row's values column holds the same lines at rest and
 * while scrubbing, the value, the unit and one caption, so no row changes height
 * between the two states.
 */
const SPARSE_DAYS: WellnessData[] = Array.from({ length: 10 }, (_, i) => ({
  id: `2026-05-${String(i + 1).padStart(2, '0')}`,
  hrv: 44 + (i % 4),
  restingHR: 50 + (i % 3),
  ...(i < 4 ? { weight: 70 + i } : {}),
}));
const ROW_KEYS = ['hrv', 'rhr', 'weight'];
const SPARKLINE_LEFT = 80;
const SPARKLINE_WIDTH = 200;
const PLOT_PAD = 4;

function linesInValues(key: string) {
  return screen.getByTestId(`wellness-readings-${key}`).findAll((node) => node.type === Text)
    .length;
}

function linesByRow() {
  return Object.fromEntries(ROW_KEYS.map((key) => [key, linesInValues(key)]));
}

describe('wellness row values column', () => {
  afterEach(() => jest.restoreAllMocks());

  vaultIt.each([
    ['1m', 7],
    ['7d', 'none'],
  ] as const)(
    'holds the same lines at rest and while scrubbing at %s, smoothing %s',
    async (timeRange, smoothingWindow) => {
      const built = capturePans();
      await render(
        <WellnessTrendsChart
          data={SPARSE_DAYS}
          timeRange={timeRange}
          smoothingWindow={smoothingWindow}
        />
      );
      await act(async () => {
        await fireEvent(screen.getByTestId('wellness-sparkline-column-hrv'), 'layout', {
          nativeEvent: {
            layout: { x: SPARKLINE_LEFT, y: 0, width: SPARKLINE_WIDTH, height: MIN_ROW },
          },
        });
      });

      const atRest = linesByRow();
      expect(Object.values(atRest)).toEqual([3, 3, 3]);

      const lastDayX = SPARKLINE_LEFT + PLOT_PAD + SPARKLINE_WIDTH - 2 * PLOT_PAD;
      const pan = scrubPan(built);
      await scrub(pan, lastDayX);
      const whileScrubbing = linesByRow();
      await release(pan);

      expect(whileScrubbing).toEqual(atRest);
    }
  );
});
