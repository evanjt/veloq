/**
 * Scenario: the feed card drew HRV and resting heart rate on one hidden 0 to
 * 100 scale, with resting heart rate turned upside down so a rising resting
 * rate drew as a fall, and neither line said what range it covered.
 *
 * Expected behaviour: each is its own labelled row on its own scale, prints
 * its own low and high, and a higher reading draws higher in both rows.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';

import {
  HRV_ROW_HEIGHT,
  SummaryCardHRVSparkline,
} from '@/features/home/components/SummaryCardHRVSparkline';
import { summarySeriesColor } from '@/features/home/lib/summaryMetricColour';
import { DOT_RADIUS } from '@/shared/charts/chartMarks';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

beforeEach(() => {
  jest
    .spyOn(Skia.Path, 'MakeFromSVGString')
    .mockReturnValue({} as ReturnType<typeof Skia.Path.MakeFromSVGString>);
});

afterEach(() => jest.restoreAllMocks());

/** The range is hidden from a screen reader, which hears it in the row's summary. */
const HIDDEN = { includeHiddenElements: true };
const HRV = [52, 58, 61, 55, 60];
const RISING_RHR = [46, 47, 48, 49, 50];

/** The y of the dot on a row's last day: the filled disc in that row's colour. */
function lastDotY(view: Awaited<ReturnType<typeof render>>, color: string): number {
  const dots = view
    .UNSAFE_queryAllByProps({ color, r: DOT_RADIUS })
    .filter((node) => typeof node.props.cy === 'number');
  expect(dots).toHaveLength(1);
  return dots[0]!.props.cy as number;
}

describe('the feed card HRV rows', () => {
  it('prints each row its own low and high', async () => {
    const view = await render(
      <SummaryCardHRVSparkline hrvData={HRV} rhrData={RISING_RHR} width={320} />
    );

    expect(view.getByTestId('summary-card-hrv-row-range', HIDDEN)).toHaveTextContent(
      '61 units.ms52 units.ms'
    );
    expect(view.getByTestId('summary-card-rhr-row-range', HIDDEN)).toHaveTextContent(
      '50 units.bpm46 units.bpm'
    );
    expect(view.getByText('metrics.hrv')).toBeTruthy();
    expect(view.getByText('metrics.rhr')).toBeTruthy();
  });

  it('draws a rising resting heart rate rising, not inverted', async () => {
    const view = await render(
      <SummaryCardHRVSparkline hrvData={HRV} rhrData={RISING_RHR} width={320} />
    );

    expect(lastDotY(view, summarySeriesColor('rhr', false))).toBeLessThan(HRV_ROW_HEIGHT / 2);
  });

  it('draws a falling resting heart rate falling', async () => {
    const view = await render(
      <SummaryCardHRVSparkline hrvData={HRV} rhrData={[...RISING_RHR].reverse()} width={320} />
    );

    expect(lastDotY(view, summarySeriesColor('rhr', false))).toBeGreaterThan(HRV_ROW_HEIGHT / 2);
  });

  it('speaks each row with its range', async () => {
    const view = await render(
      <SummaryCardHRVSparkline hrvData={HRV} rhrData={RISING_RHR} width={320} />
    );

    expect(view.getByTestId('summary-card-hrv-row').props.accessibilityLabel).toContain(
      '52 units.ms'
    );
    expect(view.getByTestId('summary-card-rhr-row').props.accessibilityLabel).toContain(
      '46 units.bpm'
    );
  });

  it('draws one row when there is no resting heart rate', async () => {
    const view = await render(<SummaryCardHRVSparkline hrvData={HRV} width={320} />);

    expect(view.getByTestId('summary-card-hrv-row-range', HIDDEN)).toBeTruthy();
    expect(view.queryByTestId('summary-card-rhr-row-range', HIDDEN)).toBeNull();
  });
});
