/**
 * Scenario: these surfaces switch their ground to the dark palette in the dark
 * theme, and several of their words, chevrons and badges kept the light
 * palette's value, so grey text landed on near-black at about 2:1.
 *
 * Expected behaviour: with the dark theme active, every text colour each
 * surface resolves clears 4.5:1 on the ground it is drawn on, and every icon
 * 3:1.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { ActivityLedgerChange } from 'veloqrs';

import { StatCard } from '@/features/activity/components/stats/StatCard';
import { StatDetailSheet } from '@/features/activity/components/stats/StatDetailSheet';
import { ActivityLedgerChanges } from '@/features/activity/components/ActivityLedgerChanges';
import { PerformanceTooltip } from '@/features/routes/components/section/PerformanceTooltip';
import { MuscleGroupView } from '@/features/strength/components/MuscleGroupView';
import { darkColors, loupeChrome } from '@/theme';
import type { ActivityDetail } from '@/types';

import { textCount, themed, underBar } from '../__shared__/drawnContrast';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: true }),
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('@/features/strength/components/BodyPairWithLoupe', () => {
  const { View } = require('react-native');
  return {
    BodyPairWithLoupe: ({ centerContent }: { centerContent: React.ReactNode }) => (
      <View>{centerContent}</View>
    ),
  };
});

const mockMuscleGroups: { data: { slug: string; intensity: number }[]; error: unknown } = {
  data: [{ slug: 'chest', intensity: 2 }],
  error: null,
};
let mockMuscleDetail: unknown = null;
jest.mock('@/features/strength/hooks/useExerciseSets', () => ({
  useMuscleGroups: () => mockMuscleGroups,
}));
jest.mock('@/features/strength/hooks/useMuscleDetail', () => ({
  useMuscleDetail: () => mockMuscleDetail,
}));

const STAT = {
  title: 'Average heart rate',
  value: '142 bpm',
  icon: 'heart-pulse' as const,
  stream: 'heartrate' as const,
  context: 'Above your usual',
  details: [{ label: 'Peak', value: '171 bpm' }],
  explanation: 'The mean of the heart rate stream over moving time.',
};

const LEDGER_CHANGE: ActivityLedgerChange = {
  eventId: 1,
  sectionId: 's1',
  sectionName: 'Harbour climb',
  sectionType: 'auto',
  at: '2026-08-20 10:00:00',
  kind: 'recut',
  relation: 'fork_around',
};

const TOOLTIP_POINT = {
  id: 'p1',
  activityId: 'a1',
  speed: 4,
  date: new Date('2026-01-01T00:00:00Z'),
  activityName: 'Harbour loop',
  direction: 'same' as const,
  sectionTime: 200,
  isBest: true,
  lapCount: 3,
  avgPower: 240,
  x: 0,
};

const MUSCLE_ACTIVITY = {
  id: 'demo-test-6',
  name: 'Upper body',
  start_date_local: '2026-09-05T08:00:00',
  moving_time: 3000,
} as unknown as ActivityDetail;

async function renderMuscles() {
  await render(
    themed(
      <MuscleGroupView
        activityId="demo-test-6"
        activity={MUSCLE_ACTIVITY}
        hasExercises
        isDark
        exerciseSets={[{} as never]}
      />,
      true
    )
  );
}

beforeEach(() => {
  mockMuscleGroups.data = [{ slug: 'chest', intensity: 2 }];
  mockMuscleGroups.error = null;
  mockMuscleDetail = null;
});

describe('in the dark theme every word and mark clears its bar on its ground', () => {
  it('the stat card, on the elevated surface', async () => {
    await render(themed(<StatCard stat={STAT} isDark onPress={() => {}} />, true));

    expect(textCount()).toBeGreaterThan(2);
    expect(underBar(darkColors.surfaceRaised)).toEqual([]);
  });

  it('the stat detail sheet, on the sheet surface', async () => {
    await render(themed(<StatDetailSheet stat={STAT} isDark onClose={() => {}} />, true));

    expect(textCount()).toBeGreaterThan(4);
    expect(underBar(darkColors.surface)).toEqual([]);
  });

  it('the section changes around an activity, on the card surface', async () => {
    await render(themed(<ActivityLedgerChanges changes={[LEDGER_CHANGE]} isDark />, true));

    expect(textCount()).toBeGreaterThan(3);
    expect(underBar(darkColors.surface)).toEqual([]);
  });

  it('the selected attempt tooltip and its lap badge, on the elevated surface', async () => {
    await render(
      themed(
        <PerformanceTooltip
          selectedPoint={TOOLTIP_POINT}
          isDark
          basis="pace"
          onClearSelection={() => {}}
        />,
        true
      )
    );

    expect(textCount()).toBeGreaterThan(3);
    expect(underBar(darkColors.surfaceRaised)).toEqual([]);
  });

  it('the muscle legend, on the dark loupe ground', async () => {
    await renderMuscles();

    expect(textCount()).toBeGreaterThan(2);
    expect(underBar(loupeChrome.bgDark)).toEqual([]);
  });

  it('the muscle detail, on the dark loupe ground', async () => {
    mockMuscleDetail = {
      name: 'Chest',
      slug: 'chest',
      exercises: [{ name: 'Bench Press', role: 'primary', sets: 3, reps: 15, volumeKg: 900 }],
      totalSets: 3,
      totalReps: 15,
      volumeKg: 900,
      primaryExercises: 1,
      secondaryExercises: 0,
    };
    await renderMuscles();

    expect(textCount()).toBeGreaterThan(4);
    expect(underBar(loupeChrome.bgDark)).toEqual([]);
  });

  it('the muscle read failure, on the dark loupe ground', async () => {
    mockMuscleGroups.data = [];
    mockMuscleGroups.error = new Error('database is locked');
    await renderMuscles();

    expect(textCount()).toBeGreaterThan(2);
    expect(underBar(loupeChrome.bgDark)).toEqual([]);
  });
});
