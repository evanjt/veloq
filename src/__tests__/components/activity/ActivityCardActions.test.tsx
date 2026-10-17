/**
 * Scenario: a screen reader user moves through the feed. Each card drew four
 * stops that all read the name, the section chip sat inside another press and
 * was never focused on iOS, and the menu a hold opens was announced nowhere.
 * Expected behaviour: a card is one button whose actions open its route, its
 * sections and its menu, the same as the chips and the hold.
 */

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import * as haptics from '@/shared/ui/haptics';
import type { Activity } from '@/types';

const mockNavigateTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: (path: string) => mockNavigateTo(path),
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
jest.mock('@/features/strength', () => ({ StrengthActivityCard: () => null }));
jest.mock('@/features/activity/components/ActivityMapPreview', () => ({
  ActivityMapPreview: () => null,
}));
jest.mock('@/features/activity/components/ActivityCardContextMenu', () => {
  const { Text } = require('react-native');
  return {
    ActivityCardContextMenu: ({
      visible,
      children,
    }: {
      visible: boolean;
      children: React.ReactNode;
    }) => (
      <>
        {children}
        {visible ? <Text testID="card-menu">menu</Text> : null}
      </>
    ),
  };
});
jest.mock('@/shared/ui/haptics', () => ({
  ...jest.requireActual('@/shared/ui/haptics'),
  light: jest.fn(),
  medium: jest.fn(),
}));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

const ride = {
  id: 'a1',
  name: 'Lakeside loop',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 5400,
  total_elevation_gain: 400,
  average_heartrate: 142,
  stream_types: ['latlng'],
} as Activity;

const highlights = [{ sectionName: 'Climb', isPr: true, trend: 1, startIndex: 0, endIndex: 1 }];
const route = { routeName: 'Lake', isPr: true, trend: 1, prImprovementSeconds: 12 };

const actionNames = () =>
  (screen.getByRole('button').props.accessibilityActions ?? []).map(
    (action: { name: string }) => action.name
  );

const fire = (name: string) =>
  fireEvent(screen.getByRole('button'), 'accessibilityAction', {
    nativeEvent: { actionName: name },
  });

beforeEach(() => mockNavigateTo.mockClear());

describe('the map card for a screen reader', () => {
  it('is one button carrying the route, section and menu actions', () => {
    render(<ActivityCard activity={ride} routeHighlight={route} sectionHighlights={highlights} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(actionNames()).toEqual(['openRoute', 'openSections', 'longpress']);
  });

  it('opens the menu from the hold action', () => {
    render(<ActivityCard activity={ride} sectionHighlights={highlights} />);

    expect(screen.queryByTestId('card-menu')).toBeNull();
    fire('longpress');
    expect(screen.getByTestId('card-menu')).toBeTruthy();
  });

  it('opens the sections tab from the sections action', () => {
    render(<ActivityCard activity={ride} sectionHighlights={highlights} />);

    fire('openSections');
    expect(mockNavigateTo).toHaveBeenCalledWith('/activity/a1?tab=sections');
  });

  it('offers no route action without a route chip', () => {
    render(<ActivityCard activity={ride} />);

    expect(actionNames()).toEqual(['longpress']);
  });

  it('reads the name once, with the stats the card draws', () => {
    render(<ActivityCard activity={ride} />);

    const label: string = screen.getByRole('button').props.accessibilityLabel;
    expect(label.split('Lakeside loop')).toHaveLength(2);
    expect(label).toContain('42');
    expect(label).toContain('142');
  });
});

describe('the compact card for a screen reader', () => {
  const indoor = { ...ride, stream_types: [] } as unknown as Activity;

  it('is one button that opens its menu from the hold action', () => {
    render(<ActivityCard activity={indoor} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(actionNames()).toEqual(['longpress']);
    fire('longpress');
    expect(screen.getByTestId('card-menu')).toBeTruthy();
  });
});

describe.each(['ios', 'android'] as const)('a card opening its menu on %s', (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', os);
    jest.mocked(haptics.light).mockClear();
    jest.mocked(haptics.medium).mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('fires no haptic of its own, leaving the open to the menu', () => {
    render(<ActivityCard activity={ride} />);

    fire('longpress');
    expect(screen.getByTestId('card-menu')).toBeTruthy();
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(haptics.light).not.toHaveBeenCalled();
  });
});
