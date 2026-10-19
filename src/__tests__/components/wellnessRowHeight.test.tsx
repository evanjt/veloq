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
import { StyleSheet } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { initialiseI18n } from '@/i18n';
import { spacing, stroke } from '@/theme';
import type { WellnessData } from '@/types';

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

  it('comes back down when the content shrinks, and never under the floor', async () => {
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
