/**
 * Scenario: a ride with training load, heart rate, energy, power and a fitness
 * impact. Each tile painted its icon by hand: load in gold, fitness impact in
 * success green, energy in warning amber, heart rate in a pink no chart uses.
 *
 * Expected behaviour: every stat icon takes the theme's secondary ink on a
 * neutral disc, so no tile reads as an achievement or a verdict. A tile that
 * names a recorded stream keys it with a dot in that stream's chart colour,
 * and only those tiles. The tile opens its sheet on a tap and nothing else.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, renderHook } from '@testing-library/react-native';

import { StatCard } from '@/features/activity/components/stats/StatCard';
import { StatDetailSheet } from '@/features/activity/components/stats/StatDetailSheet';
import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import type { StatDetail } from '@/features/activity/components/stats/types';
import { initialiseI18n } from '@/i18n';
import { chartStreamColour, colors, darkColors } from '@/theme';
import type { Activity, WellnessData } from '@/types';
import type { ActivityFitnessImpact } from 'veloqrs';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const ride = {
  id: 'ride-marks',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  moving_time: 5400,
  average_heartrate: 152,
  max_heartrate: 181,
  icu_average_watts: 245,
  icu_training_load: 96,
  icu_intensity: 88,
  calories: 820,
} as Activity;

const wellness = { id: '2026-09-05', ctl: 60, atl: 70 } as WellnessData;
const fitnessImpact = { fitness: 2.1, fatigue: 9.4, form: -7.3 } as ActivityFitnessImpact;

const handPainted = (['achievementText', 'successText', 'warningText', 'chartPinkText'] as const)
  .flatMap((key) => [colors[key], darkColors[key]])
  .map((c) => c.toLowerCase());

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

function stats(): StatDetail[] {
  const { result } = renderHook(() =>
    useActivityStats({ activity: ride, wellness, isMetric: true, maxHR: 190, fitnessImpact })
  );
  return result.current.stats;
}

function colourValues(stat: StatDetail): string[] {
  return Object.values(stat).filter((v): v is string => typeof v === 'string' && /^#/.test(v));
}

describe('the activity stat tiles', () => {
  it('carry no hand-painted gold, success, warning or pink', () => {
    const all = stats();
    expect(all.map((s) => s.title)).toEqual(
      expect.arrayContaining(['Training load', 'Heart rate', 'Energy', 'Power', 'Fitness impact'])
    );
    const painted = all.flatMap(colourValues).map((c) => c.toLowerCase());
    expect(painted.filter((c) => handPainted.includes(c))).toEqual([]);
  });

  it('key only the stream measures, each to its stream', () => {
    const keyed = Object.fromEntries(stats().map((s) => [s.title, s.stream]));
    expect(keyed['Heart rate']).toBe('heartrate');
    expect(keyed['Power']).toBe('power');
    expect(keyed['Training load']).toBeUndefined();
    expect(keyed['Energy']).toBeUndefined();
    expect(keyed['Fitness impact']).toBeUndefined();
    expect(keyed['Your form']).toBeUndefined();
  });
});

const heartRate: StatDetail = {
  title: 'Heart rate',
  value: '152',
  unit: 'bpm',
  icon: 'heart-pulse',
  stream: 'heartrate',
  context: '80% of max',
};
const load: StatDetail = { title: 'Training load', value: '96', icon: 'lightning-bolt' };

function iconColour(tree: ReturnType<typeof render>, name: string): string {
  const icon = tree.UNSAFE_root.findAll(
    (node) => node.props.name === name && typeof node.props.color === 'string'
  )[0];
  if (!icon) throw new Error(`no ${name} icon`);
  return icon.props.color;
}

describe.each([
  ['light', false, colors],
  ['dark', true, darkColors],
] as const)('a stat tile in the %s theme', (_scheme, isDark, palette) => {
  it('draws its icon in the secondary ink on the neutral disc', () => {
    const tree = render(<StatCard stat={load} isDark={isDark} onPress={() => {}} />);
    expect(iconColour(tree, 'lightning-bolt')).toBe(palette.textSecondary);
    expect(StyleSheet.flatten(tree.getByTestId('stat-icon-disc').props.style)).toMatchObject({
      backgroundColor: palette.fillNeutral,
    });
  });

  it('keys a stream measure with a dot in the stream colour, and nothing else', () => {
    const keyed = render(<StatCard stat={heartRate} isDark={isDark} onPress={() => {}} />);
    expect(iconColour(keyed, 'heart-pulse')).toBe(palette.textSecondary);
    expect(StyleSheet.flatten(keyed.getByTestId('stat-key-dot').props.style)).toMatchObject({
      backgroundColor: chartStreamColour('heartrate', isDark),
    });
    const plain = render(<StatCard stat={load} isDark={isDark} onPress={() => {}} />);
    expect(plain.queryByTestId('stat-key-dot')).toBeNull();
  });

  it('opens on a tap and has no long press', () => {
    const onPress = jest.fn();
    const tree = render(<StatCard stat={load} isDark={isDark} onPress={onPress} />);
    fireEvent(tree.getByRole('button'), 'longPress');
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.press(tree.getByRole('button'));
    expect(onPress).toHaveBeenCalledWith(load);
  });

  it('draws the sheet icon in the secondary ink and its context on the sheet ground', () => {
    const tree = render(<StatDetailSheet stat={heartRate} isDark={isDark} onClose={() => {}} />);
    expect(iconColour(tree, 'heart-pulse')).toBe(palette.textSecondary);
    expect(StyleSheet.flatten(tree.getByTestId('stat-icon-disc').props.style)).toMatchObject({
      backgroundColor: palette.fillNeutral,
    });
    const context = tree.getByTestId('stat-context');
    expect(context).toHaveTextContent('80% of max');
    for (const node of [context, context.parent]) {
      expect(StyleSheet.flatten(node?.props.style)?.backgroundColor).toBeUndefined();
    }
  });
});
