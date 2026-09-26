/**
 * Scenario: the athlete scrolls the feed offline. No snapshot can be rendered,
 * because every rung of the ladder needs the network, but nothing says so
 * until a terminal failure arrives: 15 s of watchdog when idle, and scrolling
 * re-arms it, so a scrolling athlete waits the per-card 45 s timer.
 *
 * Expected behaviour: an offline card starts on the settled "nothing to draw"
 * mark rather than a spinner that cannot resolve, and goes back to the spinner
 * when the network returns.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));

let mockOnline = true;
let mockSnapshotLanded: ((uri: string) => void) | null = null;

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => mockOnline,
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'never',
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => 'file:///nothing.jpg',
  isPrioritySnapshot: () => false,
  clearPrioritySnapshot: jest.fn(),
  isTerrainCacheInitialized: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  getCameraOverride: () => null,
}));

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: (_id: string, cb: (uri: string) => void) => {
    mockSnapshotLanded = cb;
    return () => {};
  },
  subscribeSnapshotFailure: () => () => {},
}));

const SWISS_TRACK = [
  { longitude: 8.7, latitude: 47.5 },
  { longitude: 8.72, latitude: 47.52 },
  { longitude: 8.74, latitude: 47.54 },
];

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({
    coordinates: SWISS_TRACK,
    altitude: [],
    isLoading: false,
  }),
}));

const activity = {
  id: 'demo-1',
  type: 'Ride',
  country: 'Switzerland',
  stream_types: ['latlng'],
} as unknown as Activity;

const spinners = (tree: ReturnType<typeof render>) =>
  tree.UNSAFE_queryAllByType(ActivityIndicator).length;

const noMapMarks = (tree: ReturnType<typeof render>) =>
  tree
    .UNSAFE_queryAllByType(MaterialCommunityIcons)
    .filter((i) => i.props.name === 'map-marker-off').length;

describe('a feed card with no preview, offline', () => {
  beforeEach(() => {
    mockOnline = true;
    mockSnapshotLanded = null;
  });

  it('shows the no-map mark from the first render rather than a spinner', () => {
    mockOnline = false;
    const tree = render(<ActivityMapPreview activity={activity} />);

    expect(spinners(tree)).toBe(0);
    expect(noMapMarks(tree)).toBe(1);
  });

  it('still spins online, where the render is merely pending', () => {
    const tree = render(<ActivityMapPreview activity={activity} />);

    expect(spinners(tree)).toBe(1);
    expect(noMapMarks(tree)).toBe(0);
  });

  it('goes back to the spinner when the network returns', () => {
    mockOnline = false;
    const tree = render(<ActivityMapPreview activity={activity} />);
    expect(noMapMarks(tree)).toBe(1);

    // The component is memoised, and in the app the network reaches it through
    // context, which re-renders past a memo. The mock does not, so the rerender
    // moves a real prop to make the render happen.
    mockOnline = true;
    act(() => {
      tree.rerender(<ActivityMapPreview activity={activity} index={1} />);
    });

    expect(spinners(tree)).toBe(1);
    expect(noMapMarks(tree)).toBe(0);
  });

  it('draws the snapshot that lands while offline, rather than the mark', () => {
    mockOnline = false;
    const tree = render(<ActivityMapPreview activity={activity} />);

    act(() => {
      mockSnapshotLanded?.('file:///cached.jpg');
    });

    expect(noMapMarks(tree)).toBe(0);
    expect(spinners(tree)).toBe(0);
  });
});
