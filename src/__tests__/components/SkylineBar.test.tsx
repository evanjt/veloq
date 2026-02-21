/**
 * Tests for SkylineBar logic — decoder + color mapping.
 * Uses decoder output directly since React Native rendering isn't
 * available in the Jest transform configuration.
 */
import { decodeSkylineBytes } from '@/lib/utils/skylineDecoder';

// Inline zone color constants (must match useSportSettings.ts)
const POWER_ZONE_COLORS = [
  '#009E80',
  '#009E00',
  '#FFCB0E',
  '#FF7F0E',
  '#DD0447',
  '#6633CC',
  '#1A1A1A',
];
const HR_ZONE_COLORS = ['#009E80', '#009E00', '#FFCB0E', '#FF7F0E', '#DD0447'];

// Helper to build test payloads
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

function makePayload(durations: number[], zones: number[], zoneBasis: number = 1): string {
  const bytes = [
    ...encodeVarint((1 << 3) | 0),
    ...encodeVarint(7),
    ...encodePacked(2, durations),
    ...encodePacked(
      3,
      durations.map(() => 100)
    ),
    ...encodePacked(4, zones),
    ...encodeVarint((5 << 3) | 0),
    ...encodeVarint(zoneBasis),
  ];
  return btoa(String.fromCharCode(...bytes));
}

/** Simulate SkylineBar color resolution logic */
function resolveColors(
  skylineBytes: string,
  isDark: boolean
): Array<{ flex: number; color: string }> | null {
  const decoded = decodeSkylineBytes(skylineBytes);
  if (!decoded || decoded.intervals.length === 0) return null;
  const palette = decoded.zoneBasis === 'hr' ? HR_ZONE_COLORS : POWER_ZONE_COLORS;
  return decoded.intervals.map((interval) => {
    const zoneIndex = Math.min(Math.max(interval.zone - 1, 0), palette.length - 1);
    let color = palette[zoneIndex];
    if (isDark && interval.zone === 7 && decoded.zoneBasis === 'power') {
      color = '#B0B0B0';
    }
    return { flex: interval.duration, color };
  });
}

describe('SkylineBar color resolution', () => {
  it('maps power zones to POWER_ZONE_COLORS', () => {
    const payload = makePayload([300, 120, 60], [2, 4, 6], 1);
    const result = resolveColors(payload, false);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result![0].color).toBe(POWER_ZONE_COLORS[1]); // Z2 = index 1
    expect(result![1].color).toBe(POWER_ZONE_COLORS[3]); // Z4 = index 3
    expect(result![2].color).toBe(POWER_ZONE_COLORS[5]); // Z6 = index 5
  });

  it('maps HR zones to HR_ZONE_COLORS', () => {
    const payload = makePayload([300, 200], [1, 4], 2);
    const result = resolveColors(payload, false);
    expect(result).not.toBeNull();
    expect(result![0].color).toBe(HR_ZONE_COLORS[0]); // Z1 = index 0
    expect(result![1].color).toBe(HR_ZONE_COLORS[3]); // Z4 = index 3
  });

  it('swaps Z7 to light grey in dark mode (power)', () => {
    const payload = makePayload([300], [7], 1);
    const lightResult = resolveColors(payload, false);
    const darkResult = resolveColors(payload, true);
    expect(lightResult![0].color).toBe(POWER_ZONE_COLORS[6]); // near-black
    expect(darkResult![0].color).toBe('#B0B0B0'); // light grey
  });

  it('does not swap Z5 HR in dark mode', () => {
    const payload = makePayload([300], [5], 2);
    const darkResult = resolveColors(payload, true);
    expect(darkResult![0].color).toBe(HR_ZONE_COLORS[4]);
  });

  it('sets flex proportional to duration', () => {
    const payload = makePayload([600, 300, 100], [2, 3, 5], 1);
    const result = resolveColors(payload, false);
    expect(result![0].flex).toBe(600);
    expect(result![1].flex).toBe(300);
    expect(result![2].flex).toBe(100);
  });

  it('returns null for invalid payload', () => {
    expect(resolveColors('invalid!!!', false)).toBeNull();
  });

  it('clamps out-of-range zone numbers', () => {
    const payload = makePayload([300], [10], 1);
    const result = resolveColors(payload, false);
    expect(result).not.toBeNull();
    // Zone 10 should clamp to last color (Z7)
    expect(result![0].color).toBe(POWER_ZONE_COLORS[6]);
  });
});
