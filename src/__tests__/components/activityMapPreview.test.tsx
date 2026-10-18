/**
 * Scenario: a feed card showing a cached basemap snapshot.
 * Expected behaviour: the preview draws the image and nothing over it but the
 * compass. The credit for the same basemap is carried by every live map surface
 * and by the detail screen the card opens, and on a card it cost a pill's
 * height of the stat band for a line nobody reads at that size.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import type { FeedCard } from '@/types';
import { calculateTerrainCamera } from '@/features/maps/lib/cameraAngle';
import { getEngine } from '@/shared/native/engine';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockSyncListeners = new Map<string, Set<() => void>>();
let mockSyncCompleted = 0;

let mockMapStyle = 'light';
let mockHasOverride = false;
const mockDeleteSuperseded = jest.fn();
let mockSnapshotLanded: (() => void) | null = null;
let mockTerrain3DMode = 'never';
const mockCached = new Set<string>();
const mockKey = (id: string, style: string, is3D: boolean) =>
  is3D ? `${id}_${style}_3d` : `${id}_${style}`;

// react-native-iap reaches for NitroModules at import time, and the shared UI
// barrel pulls it in transitively.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => mockMapStyle,
    getTerrain3DMode: () => mockTerrain3DMode,
    getActivityCamera: () => mockCameraOverride ?? undefined,
    hasActivityOverride: () => mockHasOverride,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(mockKey(id, style, is3D)),
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: (id: string, style: string, is3D: boolean) =>
    `file:///snapshots/${mockKey(id, style, is3D)}.jpg`,
  isTerrainCacheInitialised: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: (...args: unknown[]) => mockDeleteSuperseded(...args),
}));

let mockCameraOverride: {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
} | null = null;

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: (id: string, cb: (uri: string) => void) => {
    mockSnapshotLanded = () => cb(`file:///snapshots/${id}.jpg`);
    return () => {};
  },
  subscribeSnapshotFailure: () => () => {},
}));

const SWISS_TRACK = [
  { longitude: 8.7, latitude: 47.5 },
  { longitude: 8.72, latitude: 47.52 },
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
  distance: 42000,
  elevationGain: 300,
  hasGps: true,
} as FeedCard;

describe('ActivityMapPreview', () => {
  beforeEach(() => {
    mockMapStyle = 'light';
    mockTerrain3DMode = 'never';
    mockHasOverride = false;
    mockCameraOverride = null;
    mockDeleteSuperseded.mockClear();
    mockSnapshotLanded = null;
    mockCached.clear();
    mockCached.add(mockKey('demo-1', 'light', false));
    mockCached.add(mockKey('demo-1', 'satellite', false));
    mockSyncCompleted = 0;
    mockSyncListeners.clear();
    mockGetEngine.mockReturnValue({
      getSyncStatus: jest.fn(() => ({
        state: 0,
        inFlight: 0,
        completed: mockSyncCompleted,
        total: 3,
      })),
      subscribe: jest.fn((event: string, cb: () => void) => {
        const listeners = mockSyncListeners.get(event) ?? new Set<() => void>();
        listeners.add(cb);
        mockSyncListeners.set(event, listeners);
        return () => listeners.delete(cb);
      }),
    } as unknown as ReturnType<typeof getEngine>);
  });

  it('does not render again for sync progress within the same state', async () => {
    let renders = 0;
    await render(
      <React.Profiler
        id="preview"
        onRender={() => {
          renders += 1;
        }}
      >
        <ActivityMapPreview activity={activity} />
      </React.Profiler>
    );
    const before = renders;

    await act(() => {
      mockSyncCompleted = 1;
      mockSyncListeners.get('syncProgress')?.forEach((notify) => notify());
    });
    expect(renders).toBe(before);
  });

  it('draws no credit over the cached snapshot', async () => {
    const { queryByTestId } = await render(<ActivityMapPreview activity={activity} />);

    expect(queryByTestId('map-attribution')).toBeNull();
    expect(queryByTestId('map-attribution-text')).toBeNull();
  });

  it('shows the cached image at full opacity on its first frame', async () => {
    const { getByTestId } = await render(<ActivityMapPreview activity={activity} />);

    const preview = getByTestId('activity-map-preview-ready-demo-1');
    const { Image } = require('react-native');
    expect(preview.findByType(Image).props.fadeDuration).toBe(0);
  });

  it('keeps the snapshot out of iOS Smart Invert, so the map is not drawn as a negative', async () => {
    const { getByTestId } = await render(<ActivityMapPreview activity={activity} />);

    const preview = getByTestId('activity-map-preview-ready-demo-1');
    const { Image } = require('react-native');
    expect(preview.findByType(Image).props.accessibilityIgnoresInvertColors).toBe(true);
  });

  it('draws the compass of a turned snapshot without an SVG surface', async () => {
    // An SVG surface re-renders and dispatches a layout event every time the
    // list reattaches the row, which held feed scroll frames past the budget.
    mockTerrain3DMode = 'always';
    mockCameraOverride = { center: [8.71, 47.51], zoom: 13, bearing: 90, pitch: 60 };
    mockCached.add(mockKey('demo-1', 'light', true));

    const { getByTestId, UNSAFE_root } = await render(<ActivityMapPreview activity={activity} />);

    expect(getByTestId('activity-map-preview-compass')).toBeTruthy();
    const svgHosts = UNSAFE_root.findAll(
      (node) => typeof node.type === 'string' && node.type.startsWith('RNSVG')
    );
    expect(svgHosts).toHaveLength(0);
  });

  it('draws no compass over a snapshot facing north', async () => {
    const { queryByTestId } = await render(<ActivityMapPreview activity={activity} />);

    expect(queryByTestId('activity-map-preview-compass')).toBeNull();
  });

  it('draws none over a satellite snapshot either, where the credit was longest', async () => {
    mockMapStyle = 'satellite';

    const { queryByTestId } = await render(<ActivityMapPreview activity={activity} />);

    expect(queryByTestId('map-attribution')).toBeNull();
  });

  it('asks for a stand-in with the terrain camera when only the flat key is cached', async () => {
    mockTerrain3DMode = 'always';
    const requestSnapshot = jest.fn();
    const snapshotRef = {
      current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
    };

    await render(
      <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
    );

    expect(requestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'demo-1',
        flat: true,
        standIn: true,
        firstPaint: true,
        camera: calculateTerrainCamera(
          SWISS_TRACK.map((p) => [p.longitude, p.latitude]),
          []
        ).camera,
      })
    );
  });

  it('sends an overridden card to the head of the queue', async () => {
    mockHasOverride = true;
    mockTerrain3DMode = 'always';
    const requestSnapshot = jest.fn();
    const snapshotRef = {
      current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
    };

    await render(
      <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
    );

    expect(requestSnapshot).toHaveBeenCalledWith(expect.objectContaining({ priority: true }));
  });

  it('leaves an ordinary card in the queue it landed in', async () => {
    mockTerrain3DMode = 'always';
    const requestSnapshot = jest.fn();
    const snapshotRef = {
      current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
    };

    await render(
      <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
    );

    expect(requestSnapshot).toHaveBeenCalledWith(expect.objectContaining({ priority: false }));
  });

  it('deletes the superseded renders once the overridden one has landed', async () => {
    mockHasOverride = true;
    mockMapStyle = 'satellite';
    mockTerrain3DMode = 'always';

    await render(<ActivityMapPreview activity={activity} />);
    await act(() => mockSnapshotLanded?.());

    expect(mockDeleteSuperseded).toHaveBeenCalledWith('demo-1', 'satellite', true);
  });

  it('keeps every render for a card the athlete has not overridden', async () => {
    await render(<ActivityMapPreview activity={activity} />);
    await act(() => mockSnapshotLanded?.());

    expect(mockDeleteSuperseded).not.toHaveBeenCalled();
  });

  it('serves the cached flat render without queuing anything', async () => {
    const requestSnapshot = jest.fn();
    const snapshotRef = {
      current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
    };

    await render(
      <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
    );

    expect(requestSnapshot).not.toHaveBeenCalled();
  });
});
