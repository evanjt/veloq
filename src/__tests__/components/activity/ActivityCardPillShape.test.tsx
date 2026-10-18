/**
 * Scenario: the map feed card draws a route chip and section pills side by side.
 * The route chip read the full worded result over the map, "PR+1:05" or a
 * trophy and "-42 s", and the pills each drew their own fill.
 *
 * Expected behaviour: the route chip and every section pill are one badge, in
 * light and dark. The route chip reads the record abbreviation for a record and
 * the signed gap for a slower ride, whole at every size, while its label still
 * says the full result. The badge fill is opaque, so it holds its contrast over
 * the map whatever the transparency setting.
 */

import React from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { configure, render, screen, within } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { useOpaqueChromeStore } from '@/shared/app/ThemeProvider';
import { initialiseI18n } from '@/i18n';
import { badgePaint } from '@/shared/ui/Badge';
import type { Activity } from '@/types';

// The card's drawn text is hidden from assistive technology, which reads the
// card's own label instead, and these cases check what is drawn.
configure({ defaultIncludeHiddenElements: true });

const mockFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 360, height: 800, scale: 3, fontScale: mockFontScale.current }),
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
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
  __esModule: true,
  default: jest.fn(),
}));

const activity = {
  id: 'a1',
  name: 'Lakeside loop',
  type: 'Run',
  start_date_local: '2026-08-12T07:30:00',
  distance: 21097,
  moving_time: 17209,
  total_elevation_gain: 1047,
  stream_types: ['latlng'],
} as Activity;

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

const SHAPE = ['borderRadius', 'paddingHorizontal', 'minHeight', 'borderWidth'] as const;

const sections = [
  { sectionName: 's1', isPr: true, trend: 1, startIndex: 0, endIndex: 1 },
  { sectionName: 's2', isPr: false, trend: 1, startIndex: 0, endIndex: 1 },
  { sectionName: 's3', isPr: false, trend: -1, startIndex: 0, endIndex: 1 },
];

const drawRecord = (prImprovementSeconds: number) =>
  render(
    <ActivityCard
      activity={activity}
      routeHighlight={{ routeName: 'Loop', isPr: true, trend: 1, prImprovementSeconds }}
      sectionHighlights={sections}
    />
  );

const drawSlower = (timeDeltaSeconds: number) =>
  render(
    <ActivityCard
      activity={activity}
      routeHighlight={{ routeName: 'Loop', isPr: false, trend: -1, timeDeltaSeconds }}
      sectionHighlights={sections}
    />
  );

const chipText = () =>
  screen
    .getByTestId('activity-card-a1-route-badge')
    .findAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join('');

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  mockFontScale.current = 1;
});

describe.each(['light', 'dark'])('feed card badges in %s', (scheme) => {
  const isDark = scheme === 'dark';
  beforeEach(() => {
    (useColorScheme as jest.Mock).mockReturnValue(scheme);
  });

  it('draws the route record chip and the section record pill as one record badge', async () => {
    await drawRecord(5);
    const route = flat('activity-card-a1-route-badge');
    const pill = flat('activity-card-a1-pr-pill');
    for (const key of SHAPE) expect(route[key]).toEqual(pill[key]);
    expect(route.backgroundColor).toBe(badgePaint('record', isDark).fill);
    expect(pill.backgroundColor).toBe(badgePaint('record', isDark).fill);
    expect(route.elevation).toBeUndefined();
    expect(route.shadowRadius).toBeUndefined();
  });

  it('draws the section changes as the positive and negative badges', async () => {
    await drawSlower(12);
    const route = flat('activity-card-a1-route-badge');
    const improving = flat('activity-card-a1-improving-pill');
    const declining = flat('activity-card-a1-declining-pill');
    for (const key of SHAPE) {
      expect(route[key]).toEqual(improving[key]);
      expect(route[key]).toEqual(declining[key]);
    }
    expect(improving.backgroundColor).toBe(badgePaint('positive', isDark).fill);
    expect(declining.backgroundColor).toBe(badgePaint('negative', isDark).fill);
    expect(route.backgroundColor).toBe(badgePaint('negative', isDark).fill);
  });

  it('keeps the slower chip opaque over the map whatever the transparency setting', async () => {
    await drawSlower(12);
    const translucentSetting = flat('activity-card-a1-route-badge').backgroundColor;
    await screen.unmount();

    useOpaqueChromeStore.setState({ preferOpaqueChrome: true });
    try {
      await drawSlower(12);
      const opaqueSetting = flat('activity-card-a1-route-badge').backgroundColor;
      expect(translucentSetting).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(opaqueSetting).toBe(translucentSetting);
    } finally {
      useOpaqueChromeStore.setState({ preferOpaqueChrome: false });
    }
  });

  it('gives the route label and a pill count one label type', async () => {
    await drawSlower(12);
    const label = StyleSheet.flatten(
      within(screen.getByTestId('activity-card-a1-route-badge')).getByText(/\d/).props.style
    );
    const count = StyleSheet.flatten(
      within(screen.getByTestId('activity-card-a1-pr-pill')).getByText('1').props.style
    );
    for (const key of ['fontSize', 'fontWeight', 'lineHeight'] as const)
      expect(label[key]).toEqual(count[key]);
  });
});

describe('the route chip text', () => {
  beforeEach(() => {
    (useColorScheme as jest.Mock).mockReturnValue('light');
  });

  it('reads PR for a record and says the gain only in its label', async () => {
    await drawRecord(42);
    expect(chipText()).toBe('PR');
    expect(screen.queryByText(/42/)).toBeNull();
    expect(screen.queryByTestId('activity-card-a1-route-improvement')).toBeNull();
    expect(screen.getByTestId('activity-card-a1-route-chip').props.accessibilityLabel).toContain(
      'Personal record by'
    );
  });

  it('reads the signed gap for a slower ride, without the record words', async () => {
    await drawSlower(65);
    expect(chipText()).toBe('+1:05');
    expect(screen.queryByText('PR+1:05')).toBeNull();
    expect(screen.getByTestId('activity-card-a1-route-chip').props.accessibilityLabel).toContain(
      'off PR'
    );
  });

  it('draws a gap over an hour whole, never cut to fit the title', async () => {
    await drawSlower(3723);
    const text = within(screen.getByTestId('activity-card-a1-route-badge')).getByText('+1:02:03');
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.ellipsizeMode).toBeUndefined();
    expect(flat('activity-card-a1-route-chip').flexShrink).toBe(0);
    expect(screen.getByTestId('activity-card-a1-route-chip').props.accessibilityLabel).toContain(
      '1 hour 2 minutes 3 seconds off PR'
    );
  });

  it('sits in the title row below the dense cap and under it past the cap', async () => {
    await drawSlower(3723);
    expect(
      within(screen.getByTestId('activity-card-a1-title-row')).queryByTestId(
        'activity-card-a1-route-chip'
      )
    ).not.toBeNull();
    await screen.unmount();

    mockFontScale.current = 1.4;
    await drawSlower(3723);
    expect(screen.getByTestId('activity-card-a1-route-chip')).toBeTruthy();
    expect(
      within(screen.getByTestId('activity-card-a1-title-row')).queryByTestId(
        'activity-card-a1-route-chip'
      )
    ).toBeNull();
  });
});
