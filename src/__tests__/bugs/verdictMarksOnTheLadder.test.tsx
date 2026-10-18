/**
 * Scenario: the insight sheet's comparison, the milestone sheet and the data
 * rows each judged a verdict of their own, outside the ladder. A strength
 * progression up 25% drew a flat dash beside '+25%' because its change row
 * carried no 'good' context, the milestone sheet drew any change not marked
 * 'good' as a red fall, and a data row's verdict was an 8 px dot in colour
 * alone, with nothing for a reader who cannot tell the hues apart.
 *
 * Expected behaviour: every mark takes its rung and glyph from the move the
 * generator carried, through `verdictRung` and `verdictIcon`, and a data
 * row's verdict is a glyph of its own with the verdict named in its label.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { DataPointRow } from '@/features/insights/components/DataPointRow';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { StrengthProgressionRecord, StrengthSummary } from '@/features/strength/types';
import type { DataPoint, Insight, InsightSupportingData } from '@/types';
import { verdictIcon, verdictRung } from '@/shared/format/trend';
import { verdictColor, verdictFill } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const mockTheme = { isDark: false };
jest.mock('@/shared/app', () => ({ useTheme: () => mockTheme }));

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

type Node = { type: { displayName?: string }; props: Record<string, unknown> };

const COMPARISON_GLYPHS = new Set([
  'arrow-up',
  'arrow-down',
  'trending-up',
  'trending-down',
  'minus',
]);

/** Every icon a render drew, as the component handed it over. */
function icons(root: ReturnType<typeof render>['UNSAFE_root']) {
  return (root.findAll(() => true) as unknown as Node[])
    .filter((n) => n.type.displayName === 'MaterialCommunityIcons')
    .map((n) => ({ name: n.props.name as string, color: n.props.color as string }));
}

/** Every background a render drew. */
function fills(root: ReturnType<typeof render>['UNSAFE_root']): string[] {
  return (root.findAll(() => true) as unknown as Node[])
    .flatMap((n) => [n.props.style].flat(Infinity))
    .map((style) => (style as { backgroundColor?: unknown } | null)?.backgroundColor)
    .filter((colour): colour is string => typeof colour === 'string');
}

function muscle(slug: string, weightedSets: number) {
  return {
    slug,
    primarySets: Math.floor(weightedSets),
    secondarySets: 0,
    weightedSets,
    totalReps: 0,
    volumeKg: 0,
    exerciseNames: [],
    shade: 1,
  };
}

function summary(weightedSets: number, startTs?: number): StrengthSummary {
  return {
    ...(startTs != null ? { startTs } : {}),
    muscleVolumes: [muscle('chest', weightedSets)],
    activityCount: 4,
    totalSets: Math.round(weightedSets),
    maxWeightedSets: weightedSets,
    balance: [],
  };
}

/** A chest progression from four sets a week to five: up 25%, a move with no polarity. */
function strengthProgression(): Insight {
  const progression: StrengthProgressionRecord = {
    muscleSlug: 'chest',
    weeklyWeightedSets: [4, 4, 5, 5],
    recentAverage: 5,
    baselineAverage: 4,
    peakWeightedSets: 5,
    changePct: 25,
    trend: 'up',
    signalDelta: null,
  };
  const weekly = [0, 1, 2, 3].map((week) => summary(5, 1_699_000_000 + week * 604_800));
  const insight = generateStrengthInsights(summary(18), weekly, [progression], NOW, t).find(
    (candidate) => candidate.id === 'strength_progression-chest'
  );
  if (!insight) throw new Error('the fixture produced no progression insight');
  return insight;
}

/** The comparison's change glyph, which is drawn after the sparkline's own arrow. */
async function comparisonOf(data: InsightSupportingData) {
  const { UNSAFE_root } = await render(
    <SupportingDataSection data={data} category="efficiency_trend" />
  );
  const glyph = icons(UNSAFE_root)
    .filter((icon) => COMPARISON_GLYPHS.has(icon.name))
    .at(-1);
  return { glyph, fills: fills(UNSAFE_root) };
}

const COMPARISON = {
  current: { label: 'Now', value: 5 },
  previous: { label: 'Then', value: 4 },
  change: { label: 'Change', value: '+25%' },
};

describe.each([false, true])('the sheet comparison, dark %s', (isDark) => {
  beforeEach(() => {
    mockTheme.isDark = isDark;
  });

  it('draws a strength rise of 25% as a bare up arrow on the neutral rung', async () => {
    const insight = strengthProgression();
    expect(insight.supportingData?.trend).toEqual({ direction: 'up', verdict: 'moved' });

    const { glyph } = await comparisonOf(insight.supportingData!);

    expect(glyph).toEqual({ name: 'trending-up', color: verdictColor('neutral', isDark) });
  });

  it.each([
    [{ direction: 'down', verdict: 'improved' }, 'trending-up', 'positive'],
    [{ direction: 'up', verdict: 'declined' }, 'trending-down', 'negative'],
    [{ direction: 'down', verdict: 'moved' }, 'trending-down', 'neutral'],
    [{ direction: 'flat', verdict: 'flat' }, 'minus', 'neutral'],
  ] as const)('draws the move %j as %s on the %s rung', async (trend, name, rung) => {
    const { glyph, fills: drawn } = await comparisonOf({ comparisonData: COMPARISON, trend });

    expect(glyph).toEqual({ name, color: verdictColor(rung, isDark) });
    if (rung !== 'neutral') expect(drawn).toContain(verdictFill(rung, isDark));
  });

  it('draws a comparison with no judged move on the neutral rung whatever its context says', async () => {
    const { glyph, fills: drawn } = await comparisonOf({
      comparisonData: { ...COMPARISON, change: { ...COMPARISON.change, context: 'concern' } },
    });

    expect(glyph).toEqual({ name: 'minus', color: verdictColor('neutral', isDark) });
    expect(drawn).not.toContain(verdictFill('negative', isDark));
  });
});

/** The change badge's glyph on the milestone sheet. */
async function milestoneGlyph(insight: Insight) {
  const { UNSAFE_root } = await render(<FitnessMilestoneContent insight={insight} />);
  return icons(UNSAFE_root).find((icon) => COMPARISON_GLYPHS.has(icon.name));
}

function ftp(deltaWatts: number) {
  return { latestFtp: 240, previousFtp: 240 - deltaWatts, deltaWatts, sampleCount: 20 };
}

describe.each([false, true])('the milestone sheet, dark %s', (isDark) => {
  beforeEach(() => {
    mockTheme.isDark = isDark;
  });

  it.each([
    ['a rising', 10],
    ['a falling', -10],
  ])('draws %s eFTP with the glyph and rung of the move the card carries', async (_, delta) => {
    const [insight] = generateFitnessMilestoneInsights(ftp(delta), null, null, NOW, t);
    const trend = insight.supportingData!.trend!;

    expect(await milestoneGlyph(insight)).toEqual({
      name: verdictIcon(trend.verdict, trend.direction),
      color: verdictColor(verdictRung(trend.verdict), isDark),
    });
  });

  it('reads the judged move rather than the change row, so an improvement with no context is not a fall', async () => {
    const [rising] = generateFitnessMilestoneInsights(ftp(10), null, null, NOW, t);
    const dataPoints = rising.supportingData!.dataPoints!.map(({ context: _, ...point }) => point);
    const insight = { ...rising, supportingData: { ...rising.supportingData, dataPoints } };

    expect(await milestoneGlyph(insight)).toEqual({
      name: 'trending-up',
      color: verdictColor('positive', isDark),
    });
  });

  it('draws a milestone with no judged move as a dash on the neutral rung', async () => {
    const [rising] = generateFitnessMilestoneInsights(ftp(10), null, null, NOW, t);
    const insight = { ...rising, supportingData: { ...rising.supportingData, trend: undefined } };

    expect(await milestoneGlyph(insight)).toEqual({
      name: 'minus',
      color: verdictColor('neutral', isDark),
    });
  });
});

const ROW_GLYPHS = new Set(['check-circle', 'alert', 'alert-octagon', 'minus']);

async function row(context: DataPoint['context']) {
  const { UNSAFE_root } = await render(
    <DataPointRow dataPoint={{ label: 'Ramp', value: 7, unit: 'pts', context }} />
  );
  return icons(UNSAFE_root).filter((icon) => ROW_GLYPHS.has(icon.name));
}

describe.each([false, true])('a data row verdict, dark %s', (isDark) => {
  beforeEach(() => {
    mockTheme.isDark = isDark;
  });

  it.each([
    ['good', 'check-circle', 'positive'],
    ['warning', 'alert', 'caution'],
    ['concern', 'alert-octagon', 'negative'],
    ['neutral', 'minus', 'neutral'],
  ] as const)('draws %s as %s on the %s rung', async (context, name, rung) => {
    expect(await row(context)).toEqual([{ name, color: verdictColor(rung, isDark) }]);
  });

  it('gives good, warning and concern three different glyphs', async () => {
    const names: (string | undefined)[] = [];
    for (const context of ['good', 'warning', 'concern'] as const) {
      names.push((await row(context))[0]?.name);
    }

    expect(new Set(names).size).toBe(3);
  });

  it.each(['good', 'warning', 'concern', 'neutral'] as const)(
    'names the %s verdict in the row label',
    async (context) => {
      await render(<DataPointRow dataPoint={{ label: 'Ramp', value: 7, unit: 'pts', context }} />);

      expect(screen.getByLabelText(`Ramp, 7 pts, insights.verdict.${context}`)).toBeTruthy();
    }
  );

  it('draws no verdict glyph and names none for a value with no verdict', async () => {
    expect(await row(undefined)).toEqual([]);
    await render(<DataPointRow dataPoint={{ label: 'Ramp', value: 7 }} />);

    expect(screen.getByLabelText('Ramp, 7')).toBeTruthy();
  });
});
