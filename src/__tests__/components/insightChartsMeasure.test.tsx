/**
 * Scenario: the HRV trend chart and the section PR timeline each size
 * themselves from an onLayout that sat inside the subtree they withheld until the width was known, so the width never arrived.
 *
 * Expected behaviour: the measuring wrapper mounts with the data, a layout
 * event draws the chart, and too little data still draws nothing.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Canvas } from '@shopify/react-native-skia';

import { HrvTrendContent } from '@/features/insights/components/content/HrvTrendContent';
import { SectionPerformanceTimeline } from '@/features/insights/components/content/SectionPerformanceTimeline';
import type { Insight } from '@/features/insights/types';
import { NO_BESTS } from '@/features/insights/lib/directionBests';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

async function layout(tree: Awaited<ReturnType<typeof render>>) {
  const measured = tree.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout);
  expect(measured.length).toBeGreaterThan(0);
  await act(async () => {
    for (const node of measured) {
      await fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 150 } } });
    }
  });
}

const canvases = (tree: Awaited<ReturnType<typeof render>>) => tree.UNSAFE_queryAllByType(Canvas);

function hrvInsight(sparklineData: number[]): Insight {
  return {
    id: 'hrv',
    category: 'hrv_trend',
    priority: 2,
    title: 'HRV',
    icon: 'heart-pulse',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: false,
    supportingData: {
      history: {
        kind: 'sparkline',
        target: '/fitness',
        series: [{ label: 'HRV', points: sparklineData.map((value, date) => ({ value, date })) }],
      },
    },
  } as unknown as Insight;
}

function record(id: string, day: number, bestTime: number): SectionPerformanceRecord {
  return {
    activityId: id,
    activityName: id,
    activityDate: new Date(Date.UTC(2026, 5, day)),
    laps: [],
    lapCount: 1,
    bestTime,
    bestPace: 5,
    bestForwardTime: bestTime,
    bestReverseTime: null,
  } as unknown as SectionPerformanceRecord;
}

describe('insight charts measure outside the chart branch', () => {
  it('draws the HRV trend once laid out', async () => {
    const tree = await render(<HrvTrendContent insight={hrvInsight([50, 55, 52, 58])} />);
    await layout(tree);
    expect(canvases(tree)).toHaveLength(1);
  });

  it('draws no HRV trend from a single reading', async () => {
    const tree = await render(<HrvTrendContent insight={hrvInsight([50])} />);
    expect(canvases(tree)).toHaveLength(0);
  });

  it('draws the section PR timeline once laid out', async () => {
    const records = [record('a', 1, 300), record('b', 5, 290), record('c', 9, 310)];
    const tree = await render(
      <SectionPerformanceTimeline
        records={records}
        bests={{ forward: records[1], reverse: null, forwardIsPr: true, reverseIsPr: false }}
      />
    );
    await layout(tree);
    expect(canvases(tree)).toHaveLength(1);
  });

  it('draws no timeline from one effort', async () => {
    const tree = await render(
      <SectionPerformanceTimeline records={[record('a', 1, 300)]} bests={NO_BESTS} />
    );
    expect(tree.toJSON()).toBeNull();
  });
});
