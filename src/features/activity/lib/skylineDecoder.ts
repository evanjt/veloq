/**
 * Decode intervals.icu skyline_chart_bytes (base64-encoded protobuf).
 *
 * Wire format:
 *   field 1 (varint): number of zones (typically 7)
 *   field 2 (length-delimited packed varints): duration per interval (seconds)
 *   field 3 (length-delimited): intensity values (% FTP or HR metric)
 *   field 4 (length-delimited packed varints): zone number per interval (1-based)
 *   field 5 (varint): zone basis — 1 = power, 2 = HR
 */

export interface SkylineInterval {
  duration: number;
  zone: number;
}

export interface SkylineData {
  intervals: SkylineInterval[];
  zoneBasis: 'power' | 'hr';
}

function decodeVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, pos];
}

function decodePackedVarints(buf: Uint8Array, offset: number, end: number): number[] {
  const values: number[] = [];
  let pos = offset;
  while (pos < end) {
    const [value, nextPos] = decodeVarint(buf, pos);
    values.push(value);
    pos = nextPos;
  }
  return values;
}

export function decodeSkylineBytes(base64: string): SkylineData | null {
  try {
    const binary = atob(base64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      buf[i] = binary.charCodeAt(i);
    }

    let durations: number[] = [];
    let zones: number[] = [];
    let zoneBasisValue = 1;
    let pos = 0;

    while (pos < buf.length) {
      const [tag, nextPos] = decodeVarint(buf, pos);
      pos = nextPos;
      const fieldNumber = tag >>> 3;
      const wireType = tag & 0x7;

      if (wireType === 0) {
        // varint
        const [value, afterValue] = decodeVarint(buf, pos);
        pos = afterValue;
        if (fieldNumber === 5) zoneBasisValue = value;
      } else if (wireType === 2) {
        // length-delimited
        const [length, afterLen] = decodeVarint(buf, pos);
        pos = afterLen;
        const end = pos + length;
        if (fieldNumber === 2) {
          durations = decodePackedVarints(buf, pos, end);
        } else if (fieldNumber === 4) {
          zones = decodePackedVarints(buf, pos, end);
        }
        // field 3 (intensity) — skip, not needed for color bar
        pos = end;
      } else {
        break;
      }
    }

    if (durations.length === 0 || zones.length === 0) return null;

    const count = Math.min(durations.length, zones.length);
    const intervals: SkylineInterval[] = [];
    for (let i = 0; i < count; i++) {
      intervals.push({ duration: durations[i], zone: zones[i] });
    }

    return {
      intervals,
      zoneBasis: zoneBasisValue === 2 ? 'hr' : 'power',
    };
  } catch {
    return null;
  }
}
