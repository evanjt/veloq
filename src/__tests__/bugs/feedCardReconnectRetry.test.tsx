/**
 * Scenario: a feed card asks for its map while offline, the render fails for
 * want of tiles and the card settles on the no-map mark. Then the network
 * returns.
 *
 * Expected behaviour: the reconnect asks the pool again for a card in range
 * with no stored preview, and the card goes back to the spinner, rather than
 * keeping the mark until it remounts.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import { setVisibleRange } from '@/features/activity/lib/previewRange';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

let mockOnline = true;
let mockStored = false;
let mockSnapshotFailed: (() => void) | null = null;

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => mockOnline,
}));

// One object, as the provider memoises it, so no effect re-runs on identity alone.
const mockPreferences = {
  getStyleForActivity: () => 'light',
  getTerrain3DMode: () => 'never',
  getActivityCamera: () => undefined,
  hasActivityOverride: () => false,
};

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => mockPreferences,
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => mockStored,
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => 'file:///stored.jpg',
  isTerrainCacheInitialised: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
}));

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: () => () => {},
  subscribeSnapshotFailure: (_id: string, cb: () => void) => {
    mockSnapshotFailed = cb;
    return () => {};
  },
}));

const LAKESIDE_TRACK = [
  { longitude: 8.7, latitude: 47.5 },
  { longitude: 8.72, latitude: 47.52 },
  { longitude: 8.74, latitude: 47.54 },
];

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({
    coordinates: LAKESIDE_TRACK,
    altitude: [],
    isLoading: false,
  }),
}));

const activity = {
  id: 'demo-1',
  type: 'Ride',
  stream_types: ['latlng'],
} as unknown as Activity;

const spinners = (tree: ReturnType<typeof render>) =>
  tree.UNSAFE_queryAllByType(ActivityIndicator).length;

const noMapMarks = (tree: ReturnType<typeof render>) =>
  tree
    .UNSAFE_queryAllByType(MaterialCommunityIcons)
    .filter((i) => i.props.name === 'map-marker-off').length;

function renderCard(index = 0) {
  const requestSnapshot = jest.fn();
  const snapshotRef = {
    current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
  };
  const card = (height: number) => (
    <ActivityMapPreview
      activity={activity}
      index={index}
      height={height}
      snapshotRef={snapshotRef}
      snapshotReady={true}
    />
  );
  let height = 160;
  const tree = render(card(height));
  // The component is memoised, and in the app the network reaches it through
  // context, which re-renders past a memo. The mock does not, so each rerender
  // moves a prop no effect reads to make the render happen.
  const rerender = () => act(() => tree.rerender(card(++height)));
  return { requestSnapshot, tree, rerender };
}

function failOffline() {
  mockOnline = false;
  const card = renderCard();
  act(() => mockSnapshotFailed?.());
  return card;
}

describe('a feed card whose preview failed offline', () => {
  beforeEach(() => {
    mockOnline = true;
    mockStored = false;
    mockSnapshotFailed = null;
    setVisibleRange(null);
  });

  it('asks again on reconnect and goes back to the spinner', () => {
    const { requestSnapshot, tree, rerender } = failOffline();
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(noMapMarks(tree)).toBe(1);

    mockOnline = true;
    rerender();

    expect(requestSnapshot).toHaveBeenCalledTimes(2);
    expect(spinners(tree)).toBe(1);
    expect(noMapMarks(tree)).toBe(0);
  });

  it('asks once per reconnect, not on every render after it', () => {
    const { requestSnapshot, rerender } = failOffline();

    mockOnline = true;
    rerender();
    rerender();

    expect(requestSnapshot).toHaveBeenCalledTimes(2);
  });

  it('asks again on a second reconnect after failing again', () => {
    const { requestSnapshot, rerender } = failOffline();
    mockOnline = true;
    rerender();

    mockOnline = false;
    rerender();
    act(() => mockSnapshotFailed?.());
    mockOnline = true;
    rerender();

    expect(requestSnapshot).toHaveBeenCalledTimes(3);
  });

  it('does not ask on reconnect for a card that did not fail', () => {
    mockOnline = false;
    const { requestSnapshot, rerender } = renderCard();

    mockOnline = true;
    rerender();

    expect(requestSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not ask on reconnect for a card outside the preview range', () => {
    setVisibleRange({ first: 0, last: 1 });
    mockOnline = false;
    const { requestSnapshot, tree, rerender } = renderCard(10);
    act(() => mockSnapshotFailed?.());
    expect(requestSnapshot).not.toHaveBeenCalled();

    mockOnline = true;
    rerender();

    expect(requestSnapshot).not.toHaveBeenCalled();
    expect(noMapMarks(tree)).toBe(1);
  });
});
