/**
 * Scenario: a planned workout that is not a run was drawn with a cyclist.
 *
 * Expected behaviour: the workout's glyph is the one `getActivityIcon` gives
 * its sport, and no cyclist emoji is printed.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { TodayBanner } from '@/features/routes/components/TodayBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { language: 'en-AU' }, t: (key: string) => key }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text>,
  };
});

let mockType = 'Swim';
jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({
    todayWorkout: {
      id: 1,
      name: 'Lane session',
      type: mockType,
      moving_time: 2700,
      icu_training_load: 0,
    },
    tomorrowWorkout: null,
    isLoading: false,
  }),
}));
jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));
jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [] }),
}));

describe('TodayBanner workout glyph', () => {
  it.each([
    ['Swim', 'swim'],
    ['Walk', 'walk'],
    ['Run', 'run'],
    ['Ride', 'bike'],
  ])('draws the %s icon', (type, icon) => {
    mockType = type;
    const { queryByText } = render(<TodayBanner form={null} />);
    expect(queryByText(/\u{1F6B4}|\u{1F3C3}/u)).toBeNull();
    expect(queryByText(`icon:${icon}`)).not.toBeNull();
  });
});
