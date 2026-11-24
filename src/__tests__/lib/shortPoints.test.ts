import {
  nativeCoordFromShort,
  shortCoordFromNative,
  shortCoordsFromNative,
} from '@/shared/ffi/shortPoints';

describe('short and native coordinates', () => {
  it('maps a short point to the native shape with no field added', () => {
    expect(nativeCoordFromShort({ lat: -37.81, lng: 144.96 })).toStrictEqual({
      latitude: -37.81,
      longitude: 144.96,
    });
  });

  it('maps a native point to the short shape, dropping its elevation', () => {
    expect(
      shortCoordFromNative({ latitude: -37.81, longitude: 144.96, elevation: 12 })
    ).toStrictEqual({
      lat: -37.81,
      lng: 144.96,
    });
  });

  it('keeps zero on both axes rather than reading it as absent', () => {
    expect(nativeCoordFromShort({ lat: 0, lng: 0 })).toStrictEqual({ latitude: 0, longitude: 0 });
    expect(shortCoordFromNative({ latitude: 0, longitude: 0 })).toStrictEqual({ lat: 0, lng: 0 });
  });

  it('returns the same point after a round trip', () => {
    const short = { lat: 51.5, lng: -0.12 };
    expect(shortCoordFromNative(nativeCoordFromShort(short))).toStrictEqual(short);
  });
});

describe('short points from a native list', () => {
  it('maps every point in order, dropping elevation', () => {
    expect(
      shortCoordsFromNative([
        { latitude: 1, longitude: 2, elevation: 5 },
        { latitude: 0, longitude: -3 },
      ])
    ).toStrictEqual([
      { lat: 1, lng: 2 },
      { lat: 0, lng: -3 },
    ]);
  });

  it('maps an empty list to an empty list', () => {
    expect(shortCoordsFromNative([])).toStrictEqual([]);
  });
});
