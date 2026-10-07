/**
 * Scenario: `get_gps_track` was the last coordinate export still boxing a
 * record per point in Rust, and seven callers took it. The detail screen's is
 * the worst of them: it re-runs on every `activities` announcement, and a full
 * ride is tens of thousands of points.
 *
 * Expected behaviour: the stored track crosses as the varint blob, the same
 * encoding the section line and the representative route already use, and the reader
 * puts it through `decodeCoords` untouched.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { decodeCoords } from 'veloqrs';
import { useDetailCoordinates } from '@/features/activity/hooks/useDetailCoordinates';
import { useActivityDetailStreams } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.fn(() => []),
  })
);

const BLOB = new Uint8Array([2, 1, 2, 3, 4]).buffer;
const EMPTY = new Uint8Array([]).buffer;

// The real `useEngineRead` runs here rather than a stub of it, so the stub
// engine has to carry the channel it subscribes on.
const engine = {
  getGpsTrack: jest.fn(() => BLOB),
  getStreamBody: jest.fn<string | null, []>(() => null),
  syncActivityStreams: jest.fn(),
  subscribe: () => () => {},
};

const POINTS = [
  { latitude: 46.2044, longitude: 7.3601 },
  { latitude: 46.2051, longitude: 7.3612 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
  engine.getGpsTrack.mockReturnValue(BLOB);
  engine.getStreamBody.mockReturnValue(null);
  (decodeCoords as jest.Mock).mockReturnValue(POINTS);
});

function renderDetailStreams() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { ...renderHook(() => useActivityDetailStreams('a1'), { wrapper }), client };
}

describe('the detail stream read and stored-track fallback', () => {
  it('waits for a stream body containing latlng without reading the stored track', async () => {
    engine.getStreamBody.mockReturnValue(JSON.stringify({ latlng: [[46.2, 7.35]] }));
    const { result, rerender, unmount, client } = renderDetailStreams();

    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.coordinates).toEqual([{ latitude: 46.2, longitude: 7.35 }])
    );
    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    rerender(undefined);
    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    unmount();
    client.clear();
  });

  it('reads the stored track once after the stream body settles empty', async () => {
    const { result, rerender, unmount, client } = renderDetailStreams();

    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.coordinates).toEqual(POINTS));
    expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);
    rerender(undefined);
    expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
  });
});

describe('the stored track crosses the FFI encoded', () => {
  it('waits for the stream read before opening the stored track', () => {
    const { rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useDetailCoordinates('a1', undefined, pending),
      {
        initialProps: { pending: true },
      }
    );

    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    rerender({ pending: false });
    expect(engine.getGpsTrack).toHaveBeenCalledTimes(1);
  });
  it('decodes the blob the engine returned, untouched', () => {
    const { result } = renderHook(() => useDetailCoordinates('a1', undefined));

    expect(decodeCoords).toHaveBeenCalledWith(BLOB);
    expect(result.current).toEqual(POINTS);
  });

  it('reads an empty blob as no line', () => {
    engine.getGpsTrack.mockReturnValue(EMPTY);
    (decodeCoords as jest.Mock).mockReturnValue([]);

    const { result } = renderHook(() => useDetailCoordinates('a1', undefined));

    expect(result.current).toEqual([]);
  });

  it('does not read the engine at all when the stream body is already there', () => {
    const { result } = renderHook(() =>
      useDetailCoordinates('a1', [
        [46.2, 7.35],
        [46.21, 7.36],
      ])
    );

    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    expect(decodeCoords).not.toHaveBeenCalled();
    expect(result.current).toEqual([
      { latitude: 46.2, longitude: 7.35 },
      { latitude: 46.21, longitude: 7.36 },
    ]);
  });
});
