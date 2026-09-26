/**
 * Scenario: the HRV trend chart, the section PR timeline and the section
 * minimap each size themselves from an onLayout that sat inside the subtree
 * they withheld until the width was known, so the width never arrived.
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
import { SectionInsightMap } from '@/features/insights/components/content/SectionInsightMap';
import type { Insight } from '@/features/insights/types';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

function layout(tree: ReturnType<typeof render>) {
  const measured = tree.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout);
  expect(measured.length).toBeGreaterThan(0);
  act(() => {
    for (const node of measured) {
      fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 150 } } });
    }
  });
}

const canvases = (tree: ReturnType<typeof render>) => tree.UNSAFE_queryAllByType(Canvas);

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
    supportingData: { sparklineData },
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
  } as unknown as SectionPerformanceRecord;
}

const POLYLINE = [
  { lat: -37.8, lng: 144.9 },
  { lat: -37.81, lng: 144.91 },
  { lat: -37.82, lng: 144.93 },
];

describe('insight charts measure outside the chart branch', () => {
  it('draws the HRV trend once laid out', () => {
    const tree = render(<HrvTrendContent insight={hrvInsight([50, 55, 52, 58])} />);
    layout(tree);
    expect(canvases(tree)).toHaveLength(1);
  });

  it('draws no HRV trend from a single reading', () => {
    const tree = render(<HrvTrendContent insight={hrvInsight([50])} />);
    expect(canvases(tree)).toHaveLength(0);
  });

  it('draws the section PR timeline once laid out', () => {
    const records = [record('a', 1, 300), record('b', 5, 290), record('c', 9, 310)];
    const tree = render(<SectionPerformanceTimeline records={records} bestRecord={records[1]} />);
    layout(tree);
    expect(canvases(tree)).toHaveLength(1);
  });

  it('draws no timeline from one effort', () => {
    const tree = render(
      <SectionPerformanceTimeline records={[record('a', 1, 300)]} bestRecord={null} />
    );
    expect(tree.toJSON()).toBeNull();
  });

  it('draws the section map once laid out', () => {
    const tree = render(<SectionInsightMap polyline={POLYLINE} />);
    layout(tree);
    expect(canvases(tree)).toHaveLength(1);
  });

  it('draws no map from fewer than two usable points', () => {
    const tree = render(
      <SectionInsightMap polyline={[POLYLINE[0], { lat: Number.NaN, lng: Number.NaN }]} />
    );
    expect(tree.toJSON()).toBeNull();
  });
});
