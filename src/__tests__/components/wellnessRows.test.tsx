/**
 * Scenario: the wellness rows are small multiples of daily metrics. Each row's
 * label names its line, so every row draws in the one series colour, and each
 * row states its own range and period average, the average as a dashed rule.
 *
 * Expected behaviour: a row prints its low and high with a unit, its lines and
 * dots are the series colour and its average rule the reference colour, the
 * scrub hint shows until a scrub starts, and a scrubbed day a metric was not
 * logged on draws no dot in that row.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Line, Skia } from '@shopify/react-native-skia';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { ABSENT } from '@/shared/format/absent';
import { initialiseI18n } from '@/i18n';
import { colourTokens } from '@/theme';
import type { WellnessData } from '@/types';
import { capturePans, release, scrub, scrubPan } from '../__shared__/chartScrub';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const HRV = [44, 45, 43, 62, 44, 46, 45, 43, 44, 45];
const RESTING = [52, 50, 49, 55, 48, 51, 50, 52, 49, 50];
const UNWEIGHED_DAY = 5;

const DAYS: WellnessData[] = HRV.map((hrv, i) => ({
  id: `2026-05-${String(i + 1).padStart(2, '0')}`,
  hrv,
  restingHR: RESTING[i],
  ...(i === UNWEIGHED_DAY ? {} : { weight: 70 + (i % 3) }),
}));

// The sparkline column as the first row lays it out.
const COLUMN = { x: 80, width: 200 };
const PAD_LEFT = 4;
const PAD_RIGHT = 4;

/** The finger's x over day `idx`, in the surface's own coordinates. */
function dayX(idx: number) {
  const plot = COLUMN.width - PAD_LEFT - PAD_RIGHT;
  return COLUMN.x + PAD_LEFT + (idx / (DAYS.length - 1)) * plot;
}

const LIGHT = colourTokens.light;

interface Recorded {
  paths: unknown[];
  circles: unknown[];
}

/** Records what the chart's pictures draw, with every paint's last colour. */
function recordPictures(): Recorded {
  const recorded: Recorded = { paths: [], circles: [] };
  jest
    .spyOn(Skia.Path, 'MakeFromSVGString')
    .mockImplementation(() => ({}) as ReturnType<typeof Skia.Path.MakeFromSVGString>);
  jest.spyOn(Skia, 'Paint').mockImplementation(() => {
    const paint = {
      colour: undefined as unknown,
      setColor: (c: unknown) => {
        paint.colour = c;
      },
      setAntiAlias: jest.fn(),
      setStrokeWidth: jest.fn(),
      setAlphaf: jest.fn(),
      setStyle: jest.fn(),
      setStrokeJoin: jest.fn(),
      setStrokeCap: jest.fn(),
    };
    return paint as never;
  });
  jest.spyOn(Skia, 'PictureRecorder').mockImplementation(
    () =>
      ({
        beginRecording: () => ({
          drawPath: (_p: unknown, paint: { colour: unknown }) => {
            recorded.paths.push(paint.colour);
          },
          drawCircle: (_x: number, _y: number, _r: number, paint: { colour: unknown }) => {
            recorded.circles.push(paint.colour);
          },
          drawLine: jest.fn(),
        }),
        finishRecordingAsPicture: () => ({}),
      }) as never
  );
  return recorded;
}

async function renderRows() {
  const tree = await render(<WellnessTrendsChart data={DAYS} timeRange="1m" smoothingWindow={7} />);
  await act(async () => {
    await fireEvent(screen.getByTestId('wellness-sparkline-column-hrv'), 'layout', {
      nativeEvent: { layout: { x: COLUMN.x, y: 0, width: COLUMN.width, height: 50 } },
    });
  });
  return tree;
}

beforeAll(async () => {
  await initialiseI18n();
});

describe('wellness rows', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('prints each row its own low and high with a unit', async () => {
    await renderRows();
    expect(screen.getByTestId('wellness-range-hrv')).toHaveTextContent('43-62 ms');
    expect(screen.getByTestId('wellness-range-rhr')).toHaveTextContent('48-55 bpm');
    expect(screen.getByTestId('wellness-range-weight')).toHaveTextContent(/^\S+-\S+ (kg|lbs?)$/);
  });

  it('draws every row in the one series colour and its average as a reference rule', async () => {
    const recorded = recordPictures();
    const tree = await renderRows();

    expect(recorded.paths).toEqual([
      LIGHT['chart-series'],
      LIGHT['chart-series'],
      LIGHT['chart-series'],
    ]);

    const rules = tree.UNSAFE_getAllByType(Line);
    expect(rules).toHaveLength(3);
    for (const rule of rules) expect(rule.props.color).toBe(LIGHT['chart-reference']);
  });

  it('names the smoothing once under the rows', async () => {
    await renderRows();
    expect(screen.getByTestId('wellness-period-label')).toHaveTextContent(
      'Last 10 days · 7-day average'
    );
  });

  it('shows the scrub hint before a scrub and not once one has started', async () => {
    const built = capturePans();
    await renderRows();
    expect(screen.getByTestId('wellness-explore-hint')).toBeTruthy();

    const pan = scrubPan(built);
    await scrub(pan, dayX(2));
    expect(screen.queryByTestId('wellness-explore-hint')).toBeNull();

    await release(pan);
    expect(screen.queryByTestId('wellness-explore-hint')).toBeNull();
  });

  it('prints the day reading and names the smoothed value the dot sits on while scrubbing', async () => {
    const built = capturePans();
    await renderRows();
    await scrub(scrubPan(built), dayX(3));

    expect(screen.getByTestId('wellness-value-hrv')).toHaveTextContent('62');
    expect(screen.getByTestId('wellness-smoothed-hrv')).toHaveTextContent(/^7-day average \d+$/);
    expect(screen.getByTestId('wellness-smoothed-hrv')).not.toHaveTextContent('62');
  });

  it('keeps the dot off a row on a day its metric was not logged', async () => {
    const recorded = recordPictures();
    const built = capturePans();
    await renderRows();

    await scrub(scrubPan(built), dayX(UNWEIGHED_DAY));

    // A dot is two discs, the surface ring and the fill: HRV and resting HR only.
    expect(recorded.circles).toEqual([
      LIGHT.surface,
      LIGHT['chart-series'],
      LIGHT.surface,
      LIGHT['chart-series'],
    ]);
    expect(screen.getByTestId('wellness-value-weight')).toHaveTextContent(ABSENT);
  });
});
