/**
 * Scenario: the varint blob exists so a coordinate list crosses the FFI once,
 * unboxed. An export opted out of it and returned `Vec<FfiGpsPoint>`, so
 * every point was boxed in Rust and unboxed again in TypeScript, on the one
 * path whose whole reason for the encoding was to stop paying that.
 *
 * Expected behaviour: the export hands back the encoded blob, and the hook
 * put it through `decodeCoords` rather than reading boxed points. The codec
 * itself is `coordsElevationDecode.test.ts`; what is checked here is that the
 * blob is what crosses and that it reaches the decoder untouched.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { decodeCoords } from 'veloqrs';
import { useRepresentativeRoute } from '@/features/routes/hooks/useEngine';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.fn(() => [
      { latitude: 46.2044, longitude: 7.3601 },
      { latitude: 46.2051, longitude: 7.3612 },
    ]),
  })
);

const BLOB = new Uint8Array([2, 1, 2, 3, 4]).buffer;
const EMPTY = new Uint8Array([]).buffer;

const engine = {
  getRepresentativeRoute: jest.fn(() => BLOB),
  subscribe: jest.fn((_event: string, _refresh: () => void) => jest.fn()),
};

const EXPECTED = [
  { lat: 46.2044, lng: 7.3601 },
  { lat: 46.2051, lng: 7.3612 },
];

beforeEach(() => {
  jest.clearAllMocks();
  engine.subscribe.mockImplementation(() => jest.fn());
  (getEngine as jest.Mock).mockReturnValue(engine);
  (decodeCoords as jest.Mock).mockReturnValue([
    { latitude: 46.2044, longitude: 7.3601 },
    { latitude: 46.2051, longitude: 7.3612 },
  ]);
});

describe('the representative route crosses the FFI encoded', () => {
  it('decodes the blob the engine returned, untouched', async () => {
    const { result } = renderHook(() => useRepresentativeRoute('group1'));

    await waitFor(() => expect(result.current.points).toEqual(EXPECTED));
    expect(decodeCoords).toHaveBeenCalledWith(BLOB);
  });

  it('reads an empty blob as no route rather than as an empty one', async () => {
    engine.getRepresentativeRoute.mockReturnValueOnce(EMPTY);
    (decodeCoords as jest.Mock).mockReturnValueOnce([]);

    const { result } = renderHook(() => useRepresentativeRoute('group1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.points).toBeNull();
  });

  it('reloads the representative after the group changes', async () => {
    let refreshGroups: (() => void) | undefined;
    engine.subscribe.mockImplementation((event: string, refresh: () => void) => {
      if (event === 'groups') refreshGroups = refresh;
      return jest.fn();
    });
    const nextBlob = new Uint8Array([6, 5, 4]).buffer;
    (decodeCoords as jest.Mock).mockImplementation((blob: ArrayBuffer) =>
      blob === nextBlob ? [{ latitude: 47, longitude: 8 }] : [{ latitude: 46, longitude: 7 }]
    );
    const { result } = renderHook(() => useRepresentativeRoute('group1'));
    expect(result.current.points).toEqual([{ lat: 46, lng: 7 }]);

    engine.getRepresentativeRoute.mockReturnValue(nextBlob);
    act(() => refreshGroups?.());
    await waitFor(() => expect(result.current.points).toEqual([{ lat: 47, lng: 8 }]));
  });
});
