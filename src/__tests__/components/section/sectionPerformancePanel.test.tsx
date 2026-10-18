/**
 * Scenario: the section performance block as one panel. Views named by the
 * question they answer, one direction row in a fixed place, a card for the
 * selected attempt drawn by the panel under the chart, and excluded attempts
 * behind a link.
 *
 * Expected behaviour: the card is there before any touch, on this activity or
 * else the most recent attempt, and its actions are buttons with visible
 * labels. The direction row sits in the same place under every view, Compare
 * with joins it only under Ahead or behind, and Ahead or behind is offered
 * whenever the engine has lap curves.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';

import { PerformanceChartPanel } from '@/features/routes/components/section/PerformanceChartPanel';
import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import { SectionPerformanceSection } from '@/features/routes/components/section/SectionPerformanceSection';
import {
  availablePlots,
  initialAttempt,
  PLOT_LABEL_KEYS,
} from '@/features/routes/lib/performancePanel';
import { DirectionSwitch, IconButton, SelectButton } from '@/shared/ui';
import type { PerformanceDataPoint } from '@/types';
import type {
  FfiAttemptHistograms,
  FfiDirectionDeltas,
  FfiLapDelta,
  FfiSectionLapCurves,
} from 'veloqrs';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const { navigateTo } = jest.requireMock('@/shared/app/navigation') as { navigateTo: jest.Mock };

type Point = PerformanceDataPoint & { x: number };

const ATTEMPTS = Array.from({ length: 6 }, (_, i) => ({
  id: `lap-${i}`,
  activityId: `ride-${i}`,
  activityName: `Harbour loop ${i}`,
  date: new Date(2026, 5, i + 1),
  speed: 5 + i * 0.1,
  sectionTime: 305 - i * 2,
  sectionDistance: 3000,
  direction: i % 2 === 0 ? 'same' : 'reverse',
  recordGapSpeed: i === 4 ? 0 : 0.5,
  recordGapSecs: i === 4 ? 0 : 4,
  isBest: i === 4,
  x: i / 5,
})) as unknown as Point[];

const FORWARD_ONLY = ATTEMPTS.filter((p) => p.direction === 'same');

const STATS = (count: number) => ({ avgTime: 300, lastActivity: null, count });

const HISTOGRAMS: FfiAttemptHistograms = {
  forward: { startSecs: 290, binWidthSecs: 10, counts: [2, 1], binned: 3, unbinnedOutsideBand: 0 },
  reverse: { startSecs: 290, binWidthSecs: 10, counts: [1, 2], binned: 3, unbinnedOutsideBand: 0 },
};

function lap(activityId: string, day: number): FfiLapDelta {
  return {
    activityId,
    startIndex: 0,
    activityDate: 1_780_000_000 + day * 86_400,
    deltaSecs: Float32Array.from([0, 1, 2]),
    splitDeltaSecs: new Float32Array(0),
    endDeltaSecs: 2,
  } as FfiLapDelta;
}

function deltas(laps: FfiLapDelta[], extra: Partial<FfiDirectionDeltas> = {}): FfiDirectionDeltas {
  return {
    referenceActivityId: 'ride-0',
    referenceSource: 0,
    laps,
    missing: [],
    peakDeltaSecs: 2,
    ...extra,
  } as FfiDirectionDeltas;
}

/** Curves for both directions with a previous record, so Compare with has two choices. */
const CURVES: FfiSectionLapCurves = {
  gridStepM: 50,
  splitStepM: 100,
  sectionLengthM: 100,
  forward: deltas([lap('ride-0', 0), lap('ride-2', 2), lap('ride-4', 4)], {
    previousRecord: Float32Array.from([0, 0.5, 1]),
  } as unknown as Partial<FfiDirectionDeltas>),
  reverse: deltas([lap('ride-1', 1), lap('ride-3', 3), lap('ride-5', 5)], {
    previousRecord: Float32Array.from([0, 0.5, 1]),
  } as unknown as Partial<FfiDirectionDeltas>),
};

function panel(props: Partial<React.ComponentProps<typeof PerformanceChartPanel>> = {}) {
  return (
    <PerformanceChartPanel
      chartData={ATTEMPTS}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={STATS(3)}
      reverseStats={STATS(3)}
      trendCurves={{}}
      {...props}
    />
  );
}

async function draw(element: React.ReactElement) {
  const tree = await render(element);
  await layoutViews(tree, 400, 220);
  return tree;
}

describe('the selected-attempt card', () => {
  it('opens on this activity and offers labelled buttons, none a bare icon', async () => {
    const tree = await draw(
      panel({
        chartData: FORWARD_ONLY,
        highlightedActivityId: 'ride-4',
        onSetAsReference: jest.fn(),
        onExcludeActivity: jest.fn(),
      })
    );

    const card = within(tree.getByTestId('selected-attempt-card'));
    expect(card.getByText('Harbour loop 4')).toBeTruthy();
    expect(card.getByTestId('selected-attempt-this-activity')).toBeTruthy();
    expect(card.getByText('sections.setAsReference')).toBeTruthy();
    expect(card.getByText('sections.attemptExclude')).toBeTruthy();
    // It is this activity, so there is nowhere to open.
    expect(card.queryByText('sections.attemptOpen')).toBeNull();
    expect(card.UNSAFE_queryAllByType(IconButton)).toHaveLength(0);
  });

  it('reads the standing the engine gave beside the value', async () => {
    const tree = await draw(panel({ chartData: FORWARD_ONLY, highlightedActivityId: 'ride-2' }));

    expect(
      within(tree.getByTestId('selected-attempt-card')).getByTestId('selected-attempt-standing')
    ).toBeTruthy();
  });

  it('opens on the most recent attempt when the screen has no this-activity', async () => {
    const tree = await draw(panel({ chartData: FORWARD_ONLY }));

    const card = within(tree.getByTestId('selected-attempt-card'));
    expect(card.getByText('Harbour loop 4')).toBeTruthy();
    expect(card.queryByTestId('selected-attempt-this-activity')).toBeNull();
    await fireEvent.press(card.getByText('sections.attemptOpen'));
    expect(navigateTo).toHaveBeenCalledWith('/activity/ride-4');
  });

  it('follows the attempt chosen on the scatter and runs its actions', async () => {
    const onExcludeActivity = jest.fn();
    const onSetAsReference = jest.fn();
    const onActivitySelect = jest.fn();
    const tree = await draw(
      panel({
        chartData: FORWARD_ONLY,
        highlightedActivityId: 'ride-4',
        onExcludeActivity,
        onSetAsReference,
        onActivitySelect,
      })
    );

    const chosen = FORWARD_ONLY[0]!;
    await act(async () => {
      tree.UNSAFE_getByType(SectionScatterChart).props.onSelectPoint(chosen);
    });
    expect(onActivitySelect).toHaveBeenCalledWith('ride-0', undefined, chosen.date);
    const card = within(tree.getByTestId('selected-attempt-card'));
    expect(card.getByText('Harbour loop 0')).toBeTruthy();

    await fireEvent.press(card.getByText('sections.setAsReference'));
    expect(onSetAsReference).toHaveBeenCalledWith('ride-0');
    await fireEvent.press(card.getByText('sections.attemptExclude'));
    expect(onExcludeActivity).toHaveBeenCalledWith('ride-0');
  });

  it('offers Include for an excluded attempt', async () => {
    const onIncludeActivity = jest.fn();
    const excluded = FORWARD_ONLY.map((p) => ({ ...p, isExcluded: p.activityId === 'ride-2' }));
    const tree = await draw(
      panel({ chartData: excluded, highlightedActivityId: 'ride-2', onIncludeActivity })
    );

    const card = within(tree.getByTestId('selected-attempt-card'));
    expect(card.queryByText('sections.attemptExclude')).toBeNull();
    await fireEvent.press(card.getByText('sections.attemptInclude'));
    expect(onIncludeActivity).toHaveBeenCalledWith('ride-2');
  });
});

describe('excluded attempts', () => {
  it('sit behind a link that names how many there are, and no eye toggle remains', async () => {
    const onToggleShowExcluded = jest.fn();
    const tree = await draw(
      panel({
        chartData: FORWARD_ONLY,
        excludedCount: 1,
        showExcluded: false,
        onToggleShowExcluded,
      })
    );

    expect(tree.queryByRole('button', { name: 'sections.showExcludedActivities' })).toBeNull();
    await fireEvent.press(tree.getByText('sections.showExcludedAttempts:{"count":1}'));
    expect(onToggleShowExcluded).toHaveBeenCalledTimes(1);
  });

  it('draws the excluded attempt once shown, and offers to hide it again', async () => {
    const shown = [
      ...FORWARD_ONLY,
      { ...FORWARD_ONLY[0]!, id: 'lap-x', activityId: 'ride-x', isExcluded: true },
    ] as Point[];
    const tree = await draw(
      panel({
        chartData: shown,
        excludedCount: 1,
        showExcluded: true,
        onToggleShowExcluded: jest.fn(),
      })
    );

    expect(tree.getByText('sections.hideExcludedAttempts')).toBeTruthy();
    expect(tree.queryByText('sections.showExcludedAttempts:{"count":1}')).toBeNull();
  });

  it('offers no link when nothing is excluded', async () => {
    const tree = await draw(panel({ chartData: FORWARD_ONLY, excludedCount: 0 }));

    expect(tree.queryByText(/sections\.showExcludedAttempts/)).toBeNull();
  });

  it('keeps the link on a section whose every attempt is excluded', async () => {
    const onToggleShowExcluded = jest.fn();
    const tree = await draw(
      <SectionPerformanceSection
        isDark={false}
        sportType="Ride"
        chartData={[]}
        trendCurves={{}}
        forwardStats={null}
        reverseStats={null}
        bestForwardRecord={null}
        bestReverseRecord={null}
        bestForwardIsRecord={false}
        bestReverseIsRecord={false}
        onActivitySelect={jest.fn()}
        excludedCount={2}
        showExcluded={false}
        onToggleShowExcluded={onToggleShowExcluded}
        sectionTimeRange="all"
        onTimeRangeChange={jest.fn()}
      />
    );

    await fireEvent.press(tree.getByText('sections.showExcludedAttempts:{"count":2}'));
    expect(onToggleShowExcluded).toHaveBeenCalledTimes(1);
  });
});

describe('the panel header', () => {
  it('chooses the range from one menu control rather than a row of chips', async () => {
    const tree = await draw(
      <SectionPerformanceSection
        isDark={false}
        sportType="Ride"
        chartData={FORWARD_ONLY}
        trendCurves={{}}
        forwardStats={STATS(3)}
        reverseStats={null}
        bestForwardRecord={null}
        bestReverseRecord={null}
        bestForwardIsRecord={false}
        bestReverseIsRecord={false}
        onActivitySelect={jest.fn()}
        sectionTimeRange="all"
        onTimeRangeChange={jest.fn()}
      />
    );

    expect(tree.UNSAFE_getAllByType(SelectButton)).toHaveLength(1);
    expect(tree.queryByTestId('section-time-range-all')).toBeNull();
  });
});

describe('the direction row and the views', () => {
  it('holds the direction switch in the same place under every view', async () => {
    const tree = await draw(
      panel({ histograms: HISTOGRAMS, curves: CURVES, highlightedActivityId: 'ride-4' })
    );
    const root = tree.getByTestId('performance-chart-panel');
    // The panel's own child that holds the row, so a row moved under the plot reads as moved.
    const position = () => {
      const row = tree.getByTestId('performance-direction-row');
      return root.children.findIndex(
        (child) =>
          typeof child !== 'string' && (child === row || child.findAll((n) => n === row).length > 0)
      );
    };

    const overTime = position();
    expect(overTime).toBeGreaterThanOrEqual(0);
    expect(
      within(tree.getByTestId('performance-direction-row')).UNSAFE_getAllByType(DirectionSwitch)
    ).toHaveLength(1);
    for (const view of ['histogram', 'delta'] as const) {
      await fireEvent.press(tree.getByTestId(`chart-plot-${view}`));
      expect(position()).toBe(overTime);
    }
  });

  it('leaves the direction row out for a section ridden one way', async () => {
    const tree = await draw(panel({ chartData: FORWARD_ONLY, histograms: HISTOGRAMS }));

    expect(tree.queryByTestId('performance-direction-row')).toBeNull();
    expect(tree.UNSAFE_queryAllByType(DirectionSwitch)).toHaveLength(0);
  });

  it('shows Compare with only under Ahead or behind, in the direction row', async () => {
    const tree = await draw(
      panel({ histograms: HISTOGRAMS, curves: CURVES, highlightedActivityId: 'ride-4' })
    );

    expect(tree.queryByTestId('delta-compare')).toBeNull();
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    expect(tree.queryByTestId('delta-compare')).toBeNull();
    await fireEvent.press(tree.getByTestId('chart-plot-delta'));
    expect(
      within(tree.getByTestId('performance-direction-row')).getByTestId('delta-compare')
    ).toBeTruthy();
  });

  it("gives the direction switch the row's width, alone and beside Compare with", async () => {
    const tree = await draw(
      panel({ histograms: HISTOGRAMS, curves: CURVES, highlightedActivityId: 'ride-4' })
    );
    const grows = () =>
      StyleSheet.flatten(tree.getByTestId('section-chart-direction').props.style).flexGrow;

    expect(grows()).toBe(1);
    await fireEvent.press(tree.getByTestId('chart-plot-delta'));
    expect(tree.getByTestId('delta-compare')).toBeTruthy();
    expect(grows()).toBe(1);
  });

  it('offers Ahead or behind with curves and nothing chosen', async () => {
    const tree = await draw(panel({ curves: CURVES }));

    expect(tree.getByTestId('chart-plot-delta')).toBeTruthy();
  });

  it('names each view by its question', async () => {
    const tree = await draw(panel({ histograms: HISTOGRAMS, curves: CURVES }));

    expect(tree.getByText('sections.viewOverTime')).toBeTruthy();
    expect(tree.getByText('sections.viewSpread')).toBeTruthy();
    expect(tree.getByText('sections.viewAheadOrBehind')).toBeTruthy();
  });
});

describe('the views offered', () => {
  it('are Over time, Spread and Ahead or behind, in that order', () => {
    expect(
      availablePlots({ histogram: true, curves: true }).map((p) => PLOT_LABEL_KEYS[p])
    ).toEqual(['sections.viewOverTime', 'sections.viewSpread', 'sections.viewAheadOrBehind']);
  });

  it('leave out a view whose data is absent', () => {
    expect(availablePlots({ histogram: false, curves: true })).toEqual(['scatter', 'delta']);
    expect(availablePlots({ histogram: true, curves: false })).toEqual(['scatter', 'histogram']);
    expect(availablePlots({ histogram: false, curves: false })).toEqual(['scatter']);
  });
});

describe('the attempt the card opens on', () => {
  it('is this activity when shown, else the most recent counted attempt', () => {
    expect(initialAttempt(FORWARD_ONLY, 'ride-2')?.activityId).toBe('ride-2');
    expect(initialAttempt(FORWARD_ONLY, 'elsewhere')?.activityId).toBe('ride-4');
    expect(initialAttempt(FORWARD_ONLY, undefined)?.activityId).toBe('ride-4');
    const latestExcluded = FORWARD_ONLY.map((p) => ({
      ...p,
      isExcluded: p.activityId === 'ride-4',
    }));
    expect(initialAttempt(latestExcluded, undefined)?.activityId).toBe('ride-2');
    expect(initialAttempt([], undefined)).toBeUndefined();
  });
});
