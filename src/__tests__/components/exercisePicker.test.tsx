/**
 * Scenario: choosing an exercise by body part, equipment and name.
 * Expected behaviour: a first tap on the body selects a region, a second tap in it a muscle,
 * an equipment chip narrows further, clearing the filter line restores the list, and each
 * row shows the engine's last-done days. The engine is a fake that narrows a fixed catalogue.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ExercisePicker } from '@/features/strength/components/ExercisePicker';

const MUSCLES = [
  { slug: 'biceps', region: 'arms' },
  { slug: 'triceps', region: 'arms' },
  { slug: 'chest', region: 'chest' },
];

const CATALOGUE = [
  { key: 'barbell_curl', muscle: 'biceps', region: 'arms', equipment: 'barbell', days: 3 },
  { key: 'dumbbell_curl', muscle: 'biceps', region: 'arms', equipment: 'dumbbell', days: 127 },
  { key: 'dumbbell_triceps_extension', muscle: 'triceps', region: 'arms', equipment: 'dumbbell' },
  { key: 'barbell_bench_press', muscle: 'chest', region: 'chest', equipment: 'barbell' },
];

jest.mock('veloqrs', () => {
  const stub = require('../__shared__/veloqrsStub').withOverrides();
  stub.strength.getExercisePickerData.mockImplementation(
    (
      equipment: string[],
      region: string | undefined,
      muscle: string | undefined,
      query: string
    ) => ({
      equipment: ['barbell', 'dumbbell'],
      muscles: MUSCLES,
      rows: CATALOGUE.filter(
        (e) =>
          (equipment.length === 0 || equipment.includes(e.equipment)) &&
          (!region || e.region === region) &&
          (!muscle || e.muscle === muscle) &&
          e.key.includes(query)
      ).map((e, i) => ({
        category: i,
        name: 0,
        labelKey: e.key,
        displayName: e.key,
        equipment: e.equipment,
        lastDoneDays: e.days,
        usuallyNext: false,
      })),
    })
  );
  return stub;
});

jest.mock('@/shared/native/engine', () => ({ getEngine: () => ({ subscribe: () => () => {} }) }));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${params.count}` : key),
  }),
}));

jest.mock('@/features/strength/components/BodyPairWithLoupe', () => {
  const { Pressable } = require('react-native');
  return {
    BodyPairWithLoupe: ({
      tappableSlugs,
      onMuscleTap,
    }: {
      tappableSlugs: Set<string>;
      onMuscleTap: (slug: string) => void;
    }) => (
      <>
        {[...tappableSlugs].map((slug) => (
          <Pressable key={slug} testID={`body-${slug}`} onPress={() => onMuscleTap(slug)} />
        ))}
      </>
    ),
  };
});

const keys = () =>
  screen
    .queryAllByTestId(/^picker-row-/)
    .map((node) => String(node.props.testID).replace('picker-row-', ''));

describe('the exercise picker', () => {
  it('narrows by region, muscle and equipment, and clears with the filter line', async () => {
    const onPick = jest.fn();
    await render(<ExercisePicker gender="male" onPick={onPick} />);
    expect(keys()).toHaveLength(4);

    await fireEvent.press(screen.getByTestId('body-biceps'));
    expect(keys()).toEqual(['barbell_curl', 'dumbbell_curl', 'dumbbell_triceps_extension']);
    expect(screen.getByTestId('picker-filter-line')).toHaveTextContent(
      'strength.picker.regions.arms'
    );

    await fireEvent.press(screen.getByTestId('body-biceps'));
    expect(keys()).toEqual(['barbell_curl', 'dumbbell_curl']);
    expect(screen.getByTestId('picker-filter-line')).toHaveTextContent(
      'strength.picker.regions.arms › strength.muscles.biceps'
    );

    await fireEvent.press(screen.getByTestId('picker-equipment-dumbbell'));
    expect(keys()).toEqual(['dumbbell_curl']);

    await fireEvent.press(screen.getByTestId('picker-filter-line'));
    expect(keys()).toEqual(['dumbbell_curl', 'dumbbell_triceps_extension']);
    expect(screen.queryByTestId('picker-filter-line')).toBeNull();

    await fireEvent.press(screen.getByTestId('picker-equipment-dumbbell'));
    expect(keys()).toHaveLength(4);
  });

  it('shows the engine last-done days and adds an exercise with one tap', async () => {
    const onPick = jest.fn();
    await render(<ExercisePicker gender="female" onPick={onPick} />);

    expect(screen.getByTestId('picker-last-done-barbell_curl')).toHaveTextContent(
      'strength.picker.daysAgo:3'
    );
    expect(screen.getByTestId('picker-last-done-dumbbell_curl')).toHaveTextContent(
      'strength.picker.daysAgo:127'
    );
    expect(screen.queryByTestId('picker-last-done-barbell_bench_press')).toBeNull();

    await fireEvent.press(screen.getByTestId('picker-row-barbell_curl'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ labelKey: 'barbell_curl' }));
  });

  it('moves the selection when a muscle in another region is tapped', async () => {
    await render(<ExercisePicker gender="male" onPick={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('body-biceps'));
    await fireEvent.press(screen.getByTestId('body-chest'));
    expect(keys()).toEqual(['barbell_bench_press']);
  });
});
