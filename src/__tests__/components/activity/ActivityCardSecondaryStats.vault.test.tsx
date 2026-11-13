/**
 * Scenario: the feed card's secondary row draws load, heart rate, power,
 * calories and temperature beside their icons, at the largest system text size.
 * Expected behaviour: each value is a fit-to-box single line, so a narrow box
 * shrinks it and never cuts it to a different number, at every text size.
 */

import React from 'react';
import { configure, render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { initialiseI18n } from '@/i18n';
import type { FeedCard } from '@/types';

configure({ defaultIncludeHiddenElements: true });

const mockFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 320, height: 800, scale: 3, fontScale: mockFontScale.current }),
}));

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));
jest.mock('@/features/strength', () => ({
  StrengthActivityCard: () => null,
}));
// The card's menu reads the track for its 3D item, which no test here draws.
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  ...jest.requireActual('@/features/activity/hooks/useMapPreviewCoordinates'),
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined, isLoading: false }),
}));
jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return { ActivityMapPreview: () => <View testID="preview-stub" /> };
});

const activity = {
  id: 'a1',
  name: 'Lakeside loop',
  sportType: 'Ride',
  startDateLocal: '2026-08-12T07:30:00',
  distance: 21097,
  movingTime: 17209,
  elevationGain: 1047,
  avgPower: 240,
  avgHr: 148,
  trainingLoad: 85,
  calories: 1200,
  hasGps: true,
  hasWeather: true,
  averageWeatherTemp: 21,
} as FeedCard;

const VALUES = ['load', 'heart-rate', 'power', 'calories', 'temperature'];

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe.each([1, 1.3, 2])('secondary stat values at font scale %s', (scale) => {
  it.each(VALUES)('draws the %s value whole on one fitted line', (name) => {
    mockFontScale.current = scale;
    render(<ActivityCard activity={activity} />);
    const value = screen.getByTestId(`activity-card-a1-${name}`);
    expect(value.props.numberOfLines).toBe(1);
    expect(value.props.adjustsFontSizeToFit).toBe(true);
  });
});
