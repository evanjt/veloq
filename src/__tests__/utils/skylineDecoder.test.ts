import { decodeSkylineBytes } from '@/lib/utils/skylineDecoder';

// Helper: encode a minimal protobuf for testing
function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function encodePacked(fieldNumber: number, values: number[]): number[] {
  const payload: number[] = [];
  for (const v of values) payload.push(...encodeVarint(v));
  return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(payload.length), ...payload];
}

function makeTestPayload(opts: {
  numZones?: number;
  durations: number[];
  intensities: number[];
  zones: number[];
  zoneBasis?: number;
}): string {
  const bytes = [
    ...encodeVarint((1 << 3) | 0),
    ...encodeVarint(opts.numZones ?? 7),
    ...encodePacked(2, opts.durations),
    ...encodePacked(3, opts.intensities),
    ...encodePacked(4, opts.zones),
    ...encodeVarint((5 << 3) | 0),
    ...encodeVarint(opts.zoneBasis ?? 1),
  ];
  return btoa(String.fromCharCode(...bytes));
}

describe('decodeSkylineBytes', () => {
  it('decodes a simple power-based skyline', () => {
    const b64 = makeTestPayload({
      durations: [300, 120, 60],
      intensities: [75, 105, 130],
      zones: [2, 4, 6],
      zoneBasis: 1,
    });

    const result = decodeSkylineBytes(b64);
    expect(result).not.toBeNull();
    expect(result!.zoneBasis).toBe('power');
    expect(result!.intervals).toHaveLength(3);
    expect(result!.intervals[0]).toEqual({ duration: 300, zone: 2 });
    expect(result!.intervals[1]).toEqual({ duration: 120, zone: 4 });
    expect(result!.intervals[2]).toEqual({ duration: 60, zone: 6 });
  });

  it('decodes an HR-based skyline', () => {
    const b64 = makeTestPayload({
      numZones: 5,
      durations: [600, 300],
      intensities: [70, 90],
      zones: [1, 3],
      zoneBasis: 2,
    });

    const result = decodeSkylineBytes(b64);
    expect(result).not.toBeNull();
    expect(result!.zoneBasis).toBe('hr');
    expect(result!.intervals).toHaveLength(2);
    expect(result!.intervals[0]).toEqual({ duration: 600, zone: 1 });
    expect(result!.intervals[1]).toEqual({ duration: 300, zone: 3 });
  });

  it('returns null for empty string', () => {
    expect(decodeSkylineBytes('')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(decodeSkylineBytes('!!!not-base64!!!')).toBeNull();
  });

  it('returns null when durations are missing', () => {
    // Only has zones field, no durations
    const bytes = [
      ...encodeVarint((1 << 3) | 0),
      ...encodeVarint(7),
      ...encodePacked(4, [1, 2, 3]),
    ];
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(decodeSkylineBytes(b64)).toBeNull();
  });

  it('returns null when zones are missing', () => {
    const bytes = [
      ...encodeVarint((1 << 3) | 0),
      ...encodeVarint(7),
      ...encodePacked(2, [300, 120]),
    ];
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(decodeSkylineBytes(b64)).toBeNull();
  });

  it('handles mismatched duration/zone counts (takes minimum)', () => {
    const b64 = makeTestPayload({
      durations: [300, 120, 60, 200],
      intensities: [75, 105, 130],
      zones: [2, 4, 6],
    });

    const result = decodeSkylineBytes(b64);
    expect(result).not.toBeNull();
    expect(result!.intervals).toHaveLength(3);
  });

  it('decodes a real-world intervals.icu payload', () => {
    // Real payload from intervals.icu API (VirtualRide, power-based)
    // field 2 durations: [393, 130, 59, 72, 86, 4, 51, 270, 30, 37, 84, 1, 95, 406, 23, 1]
    // field 4 zones: [4, 6, 6, 2, 6, 5, 5, 3, 7, 1, 5, 4, 6, 2, 2, 6]
    const realPayload = makeTestPayload({
      durations: [393, 130, 59, 72, 86, 4, 51, 270, 30, 37, 84, 1, 95, 406, 23, 1],
      intensities: [98, 123, 138, 57, 127, 113, 109, 87, 164, 23, 109, 104, 125, 91, 160, 150],
      zones: [4, 6, 6, 2, 6, 5, 5, 3, 7, 1, 5, 4, 6, 2, 2, 6],
      zoneBasis: 1,
    });

    const result = decodeSkylineBytes(realPayload);
    expect(result).not.toBeNull();
    expect(result!.zoneBasis).toBe('power');
    expect(result!.intervals).toHaveLength(16);
    expect(result!.intervals[0]).toEqual({ duration: 393, zone: 4 });
    expect(result!.intervals[8]).toEqual({ duration: 30, zone: 7 });
  });
});
