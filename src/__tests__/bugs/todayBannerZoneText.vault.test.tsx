/**
 * Scenario: the Today banner names the day's form zone beside a dot in the
 * zone colour, and set the words in a text tint of each zone: five more
 * colours for one line of copy, a second colour per zone beside the dot's.
 *
 * Expected behaviour: the dot carries the zone colour and the words are body
 * text, in light and in dark.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { TodayBanner } from '@/features/routes/components/TodayBanner';
import { formZoneLabel } from '@/features/fitness/lib/fitness';
import { colors, darkColors } from '@/theme';

let mockDark = false;
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { language: 'en-AU' }, t: (key: string) => key }),
}));
jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({ todayWorkout: null, tomorrowWorkout: null, isLoading: false }),
}));
jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

afterEach(() => {
  mockDark = false;
});

describe('the Today banner form zone', () => {
  it.each([
    [false, colors.textPrimary],
    [true, darkColors.textPrimary],
  ])('sets the zone words in body text (dark %s)', async (dark, body) => {
    mockDark = dark;
    // Fitness 50 and fatigue 70 is form -20, the optimal zone.
    const tree = await render(<TodayBanner form={{ ctl: 50, atl: 70 }} />);

    const words = tree.getByText(new RegExp(`^${formZoneLabel('optimal')}`));
    expect(StyleSheet.flatten(words.props.style).color).toBe(body);
  });
});
