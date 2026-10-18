/**
 * Scenario: the attempt scatter drawn on the engine's focus range, where this
 * activity holds the record and one stopped attempt lies far past the range.
 *
 * Expected behaviour: this activity carries both the reticle and the record
 * ring, the stopped attempt sits at the bottom edge as a triangle counted
 * under the plot, this activity's standing is written beside it, and no chart
 * text is set below 12 px.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import { EdgeTriangleMark, RecordRing, ReticleMark, SelectionRing } from '@/shared/charts';
import type { PerformanceDataPoint } from '@/types';
import type { FfiRecordProgressions, FfiScatterFocus } from 'veloqrs';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const day = (d: number) => new Date(2026, 5, d);

const POINTS = [
  { id: 'lap-1', activityId: 'early', date: day(1), speed: 5.0, recordGapSpeed: 0.5 },
  { id: 'lap-2', activityId: 'stopped', date: day(2), speed: 0.4, offScale: 'slow' },
  { id: 'lap-3', activityId: 'middle', date: day(3), speed: 5.2, recordGapSpeed: 0.3 },
  {
    id: 'lap-4',
    activityId: 'mine',
    date: day(4),
    speed: 5.5,
    isBest: true,
    recordGapSpeed: 0,
    recordGapSecs: 0,
  },
].map((p) => ({
  direction: 'same',
  activityName: p.activityId,
  sectionTime: 600,
  x: 0,
  ...p,
})) as unknown as (PerformanceDataPoint & { x: number })[];

const FOCUS: FfiScatterFocus = { forward: { low: 4.5, high: 6, slowCount: 1, fastCount: 0 } };

const PROGRESSION: FfiRecordProgressions = {
  forward: [
    {
      activityId: 'early',
      lapId: 'lap-1',
      activityDate: day(1).getTime() / 1000,
      sectionTime: 640,
      speed: 5.0,
    },
    {
      activityId: 'mine',
      lapId: 'lap-4',
      activityDate: day(4).getTime() / 1000,
      sectionTime: 580,
      speed: 5.5,
      improvementSecs: 60,
      improvementSpeed: 0.5,
    },
  ],
  reverse: [],
};

async function scatter(props: Partial<React.ComponentProps<typeof SectionScatterChart>> = {}) {
  const tree = await render(
    <SectionScatterChart
      chartData={POINTS}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      trendCurves={{}}
      highlightedActivityId="mine"
      scatterFocus={FOCUS}
      recordProgression={PROGRESSION}
      {...props}
    />
  );
  await layoutViews(tree, 400, 220);
  return tree;
}

describe('the attempt scatter marks', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws the reticle and the record ring on this activity when it holds the record', async () => {
    const tree = await scatter();

    expect(tree.UNSAFE_getAllByType(ReticleMark)).toHaveLength(1);
    const rings = tree.UNSAFE_getAllByType(RecordRing);
    expect(rings).toHaveLength(1);
    const reticle = tree.UNSAFE_getByType(ReticleMark);
    expect(rings[0]?.props.x).toBe(reticle.props.x);
    expect(rings[0]?.props.y).toBe(reticle.props.y);
  });

  it('draws the reticle alone on this activity when another holds the record', async () => {
    const tree = await scatter({ highlightedActivityId: 'middle' });

    const reticle = tree.UNSAFE_getByType(ReticleMark);
    const ring = tree.UNSAFE_getByType(RecordRing);
    expect(ring.props.x).not.toBe(reticle.props.x);
  });

  it('holds back the record ring and staircase until the streams are read', async () => {
    const tree = await scatter({ recordsSettled: false });

    expect(tree.UNSAFE_queryAllByType(RecordRing)).toHaveLength(0);
    expect(tree.UNSAFE_getAllByType(ReticleMark)).toHaveLength(1);
  });

  it('puts the stopped attempt at the bottom edge and counts it under the plot', async () => {
    const tree = await scatter();

    const triangles = tree.UNSAFE_getAllByType(EdgeTriangleMark);
    expect(triangles).toHaveLength(1);
    expect(triangles[0]?.props.pointing).toBe('down');
    expect(tree.getByText('1 off the scale')).toBeTruthy();
  });

  it('writes this activity standing beside it from the engine gap', async () => {
    const newRecord = await scatter();
    expect(newRecord.getByTestId('section-scatter-standing')).toHaveTextContent(
      'New record, +1.1 mph'
    );

    const behind = await scatter({ highlightedActivityId: 'middle' });
    expect(behind.getByTestId('section-scatter-standing')).toHaveTextContent(
      '0.7 mph off the record'
    );
  });

  it('draws no selection ring before a point is chosen', async () => {
    const tree = await scatter();

    expect(tree.UNSAFE_queryAllByType(SelectionRing)).toHaveLength(0);
  });

  it('sets no plot text below 12 px: the axes, the standing and the off-scale count', async () => {
    const tree = await scatter();

    const texts = [
      ...tree.getByTestId('section-scatter-chart').findAllByType(Text),
      ...tree.getByTestId('section-scatter-off-scale').findAllByType(Text),
    ];
    const sized = texts.filter(
      (node) => typeof StyleSheet.flatten(node.props.style)?.fontSize === 'number'
    );
    expect(sized.length).toBeGreaterThan(0);
    const small = sized
      .filter((node) => (StyleSheet.flatten(node.props.style)?.fontSize ?? 12) < 12)
      .map((node) => node.props.children);
    expect(small).toEqual([]);
  });
});
