// Skyline chart protobuf encoder for demo activities.

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

// Split zone time into plausible interval blocks, then encode to base64.
export function generateSkylineBytes(
  zoneTimes: Array<{ id: string; secs: number }> | null,
  hrZoneTimes: number[] | null,
  random: () => number
): string | undefined {
  // Power-based skyline
  if (zoneTimes) {
    const intervals: Array<{ duration: number; zone: number; intensity: number }> = [];
    for (const zt of zoneTimes) {
      if (zt.secs < 10) continue;
      const zoneNum = parseInt(zt.id.replace('Z', ''), 10);
      const blocks = Math.max(1, Math.min(3, Math.floor(zt.secs / 120)));
      const blockDur = Math.round(zt.secs / blocks);
      for (let b = 0; b < blocks; b++) {
        const dur = b === blocks - 1 ? zt.secs - blockDur * (blocks - 1) : blockDur;
        const intensity = [55, 75, 88, 100, 115, 130, 160][zoneNum - 1] ?? 100;
        intervals.push({
          duration: dur,
          zone: zoneNum,
          intensity: Math.round(intensity + (random() - 0.5) * 10),
        });
      }
    }
    for (let i = intervals.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [intervals[i], intervals[j]] = [intervals[j], intervals[i]];
    }
    if (intervals.length === 0) return undefined;
    const bytes = [
      ...encodeVarint((1 << 3) | 0),
      ...encodeVarint(7), // field 1: num zones
      ...encodePacked(
        2,
        intervals.map((i) => i.duration)
      ),
      ...encodePacked(
        3,
        intervals.map((i) => i.intensity)
      ),
      ...encodePacked(
        4,
        intervals.map((i) => i.zone)
      ),
      ...encodeVarint((5 << 3) | 0),
      ...encodeVarint(1), // field 5: power basis
    ];
    return btoa(String.fromCharCode(...bytes));
  }
  // HR-based skyline
  if (hrZoneTimes) {
    const intervals: Array<{ duration: number; zone: number; intensity: number }> = [];
    for (let z = 0; z < hrZoneTimes.length; z++) {
      if (hrZoneTimes[z] < 10) continue;
      const zoneNum = z + 1;
      const blocks = Math.max(1, Math.min(2, Math.floor(hrZoneTimes[z] / 180)));
      const blockDur = Math.round(hrZoneTimes[z] / blocks);
      for (let b = 0; b < blocks; b++) {
        const dur = b === blocks - 1 ? hrZoneTimes[z] - blockDur * (blocks - 1) : blockDur;
        intervals.push({ duration: dur, zone: zoneNum, intensity: 60 + zoneNum * 10 });
      }
    }
    for (let i = intervals.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [intervals[i], intervals[j]] = [intervals[j], intervals[i]];
    }
    if (intervals.length === 0) return undefined;
    const bytes = [
      ...encodeVarint((1 << 3) | 0),
      ...encodeVarint(5), // field 1: 5 HR zones
      ...encodePacked(
        2,
        intervals.map((i) => i.duration)
      ),
      ...encodePacked(
        3,
        intervals.map((i) => i.intensity)
      ),
      ...encodePacked(
        4,
        intervals.map((i) => i.zone)
      ),
      ...encodeVarint((5 << 3) | 0),
      ...encodeVarint(2), // field 5: HR basis
    ];
    return btoa(String.fromCharCode(...bytes));
  }
  return undefined;
}
