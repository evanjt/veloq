/**
 * Scenario: the Fitness & Fatigue chart marks each day the athlete's eFTP
 * moved with a dot at the top of the plot. The fitness line is the app's
 * primary blue, so a mark drawn in the primary sits on that line and cannot be
 * told from it.
 *
 * Expected behaviour: the marks draw in the chart's power colour, the one the
 * FTP trend uses, in light and in dark, and never in the fitness line's colour.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import type { EftpChange } from '@/features/fitness/lib/eftpChanges';
import { brand, colors, darkColors } from '@/theme';
import type { WellnessData } from '@/types';

const mockScheme = { current: 'light' as 'light' | 'dark' };

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme.current,
}));

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-03', ctl: 42, atl: 47 },
] as WellnessData[];

const MARKS: EftpChange[] = [
  { date: '2026-04-02', eftp: 251, delta: 6, activityId: 'a1', activityName: 'Hill repeats' },
];

afterEach(() => {
  mockScheme.current = 'light';
});

describe('the eFTP marks on the fitness chart', () => {
  it.each([
    ['light', colors.chartFtp, brand.blue],
    ['dark', colors.chartFtp, darkColors.chartFitness],
  ] as const)('draw in the power colour in %s', async (scheme, power, fitnessLine) => {
    mockScheme.current = scheme;
    const tree = await render(<FitnessChart data={DAYS} markers={MARKS} />);
    const plot = tree.getByTestId('fitness-chart-surface');
    const canvas = plot.findAll((node) => node.type === View && Boolean(node.props.onLayout))[0];
    await act(() =>
      fireEvent(canvas, 'layout', { nativeEvent: { layout: { width: 360, height: 200 } } })
    );

    const marks = tree.UNSAFE_root.findAll(
      (node) => (node.type as { displayName?: string }).displayName === 'Circle'
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].props.color).toBe(power);
    expect(marks[0].props.color).not.toBe(fitnessLine);
  });
});
