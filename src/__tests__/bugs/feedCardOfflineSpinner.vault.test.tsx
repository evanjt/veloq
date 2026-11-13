/**
 * Scenario: the athlete scrolls the feed offline. No snapshot can be rendered,
 * because every rung of the ladder needs the network, but nothing says so
 * until a terminal failure arrives: the pipeline's staleness watchdog or the
 * failure event at the end of the retry ladder.
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
import type { FeedCard } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

let mockOnline = true;
let mockSnapshotLanded: ((uri: string) => void) | null = null;

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => mockOnline,
}));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'never',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => 'file:///nothing.jpg',
  isTerrainCacheInitialised: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
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
  sportType: 'Ride',
  hasGps: true,
} as FeedCard;

const spinners = (tree: Awaited<ReturnType<typeof render>>) =>
  tree.UNSAFE_queryAllByType(ActivityIndicator).length;

const noMapMarks = (tree: Awaited<ReturnType<typeof render>>) =>
  tree
    .UNSAFE_queryAllByType(MaterialCommunityIcons)
    .filter((i) => i.props.name === 'map-marker-off').length;

describe('a feed card with no preview, offline', () => {
  beforeEach(() => {
    mockOnline = true;
    mockSnapshotLanded = null;
  });

  it('shows the no-map mark from the first render rather than a spinner', async () => {
    mockOnline = false;
    const tree = await render(<ActivityMapPreview activity={activity} />);

    expect(spinners(tree)).toBe(0);
    expect(noMapMarks(tree)).toBe(1);
  });

  it('still spins online, where the render is merely pending', async () => {
    const tree = await render(<ActivityMapPreview activity={activity} />);

    expect(spinners(tree)).toBe(1);
    expect(noMapMarks(tree)).toBe(0);
  });

  it('goes back to the spinner when the network returns', async () => {
    mockOnline = false;
    const tree = await render(<ActivityMapPreview activity={activity} />);
    expect(noMapMarks(tree)).toBe(1);

    // The component is memoised, and in the app the network reaches it through
    // context, which re-renders past a memo. The mock does not, so the rerender
    // moves a real prop to make the render happen.
    mockOnline = true;
    await act(async () => {
      await tree.rerender(<ActivityMapPreview activity={activity} index={1} />);
    });

    expect(spinners(tree)).toBe(1);
    expect(noMapMarks(tree)).toBe(0);
  });

  it('draws the snapshot that lands while offline, rather than the mark', async () => {
    mockOnline = false;
    const tree = await render(<ActivityMapPreview activity={activity} />);

    await act(() => {
      mockSnapshotLanded?.('file:///cached.jpg');
    });

    expect(noMapMarks(tree)).toBe(0);
    expect(spinners(tree)).toBe(0);
  });
});
