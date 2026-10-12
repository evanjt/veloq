/**
 * Scenario: the activity card menu opens over the feed in a transparent modal.
 *
 * Expected behaviour: on iOS the modal leaves the feed in the view hierarchy,
 * so the menu card marks itself modal and VoiceOver cannot swipe past it into
 * the feed.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ActivityCardContextMenu } from '@/features/activity/components/ActivityCardContextMenu';
import type { Activity } from '@/types';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => (key === 'activity.terrainRow' ? 'Relief' : key) }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/maps', () => ({
  resolveTerrain3D: () => ({ show3D: false }),
}));

jest.mock('@/features/settings', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'auto',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: [] }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
}));

const activity = { id: 'a1', name: 'Morning ride', type: 'Ride' } as Activity;

describe('ActivityCardContextMenu', () => {
  it('traps screen-reader focus inside the open menu card', async () => {
    await render(<ActivityCardContextMenu visible onDismiss={jest.fn()} activity={activity} />);

    expect(screen.getByTestId('activity-card-context-menu').props.accessibilityViewIsModal).toBe(
      true
    );
  });

  it('shows the translated terrain row label', async () => {
    await render(<ActivityCardContextMenu visible onDismiss={jest.fn()} activity={activity} />);

    expect(screen.getByText('Relief')).toBeTruthy();
  });
});
