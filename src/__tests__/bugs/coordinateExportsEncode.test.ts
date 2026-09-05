/**
 * Scenario: the varint blob exists so a coordinate list crosses the FFI once,
 * unboxed. Two exports opted out of it and returned `Vec<FfiGpsPoint>`, so
 * every point was boxed in Rust and unboxed again in TypeScript, on the one
 * path whose whole reason for the encoding was to stop paying that.
 *
 * Expected behaviour: both exports hand back the encoded blob, and both hooks
 * put it through `decodeCoords` rather than reading boxed points. The codec
 * itself is `coordsElevationDecode.test.ts`; what is checked here is that the
 * blob is what crosses and that it reaches the decoder untouched.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { decodeCoords } from 'veloqrs';
import { useConsensusRoute, useSectionPolyline } from '@/features/routes/hooks/useEngine';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  getConsensusRoute: jest.fn(() => BLOB),
  getSectionPolyline: jest.fn(() => BLOB),
  subscribe: jest.fn(() => jest.fn()),
};

const EXPECTED = [
  { lat: 46.2044, lng: 7.3601 },
  { lat: 46.2051, lng: 7.3612 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
  (decodeCoords as jest.Mock).mockReturnValue([
    { latitude: 46.2044, longitude: 7.3601 },
    { latitude: 46.2051, longitude: 7.3612 },
  ]);
});

describe('the consensus route crosses the FFI encoded', () => {
  it('decodes the blob the engine returned, untouched', async () => {
    const { result } = renderHook(() => useConsensusRoute('group1'));

    await waitFor(() => expect(result.current.points).toEqual(EXPECTED));
    expect(decodeCoords).toHaveBeenCalledWith(BLOB);
  });

  it('reads an empty blob as no route rather than as an empty one', async () => {
    engine.getConsensusRoute.mockReturnValueOnce(EMPTY);
    (decodeCoords as jest.Mock).mockReturnValueOnce([]);

    const { result } = renderHook(() => useConsensusRoute('group1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.points).toBeNull();
  });
});

describe('the section polyline crosses the FFI encoded', () => {
  it('decodes the blob the engine returned, untouched', () => {
    const { result } = renderHook(() => useSectionPolyline('sec1'));

    expect(result.current.polyline).toEqual(EXPECTED);
    expect(decodeCoords).toHaveBeenCalledWith(BLOB);
  });

  it('gives an empty line for an empty blob', () => {
    engine.getSectionPolyline.mockReturnValueOnce(EMPTY);
    (decodeCoords as jest.Mock).mockReturnValueOnce([]);

    const { result } = renderHook(() => useSectionPolyline('sec1'));

    expect(result.current.polyline).toEqual([]);
  });

  it('gives an empty line when the read throws', () => {
    engine.getSectionPolyline.mockImplementationOnce(() => {
      throw new Error('gone');
    });

    const { result } = renderHook(() => useSectionPolyline('sec1'));

    expect(result.current.polyline).toEqual([]);
  });
});
