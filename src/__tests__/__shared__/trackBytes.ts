/**
 * Builds the bytes the engine hands across the bridge for a track, so a test
 * can feed the real `decodeCoords` what a native read returns. The stream is
 * pinned against the engine's own encoder by
 * `bindings/trackCodecVectors.test.ts`.
 */

export interface TrackPoint {
  latitude: number;
  longitude: number;
  elevation?: number;
}

function varint(out: number[], value: number): void {
  let v = value;
  while (v > 0x7f) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function zigzag(out: number[], v: number): void {
  varint(out, v >= 0 ? v * 2 : -v * 2 - 1);
}

export function encodeTrack(points: TrackPoint[]): ArrayBuffer {
  const out: number[] = [];
  varint(out, points.length);
  const withEle = points.filter((p) => p.elevation !== undefined).length;
  const mode = withEle === 0 ? 0 : withEle === points.length ? 1 : 2;
  out.push(mode);
  if (mode === 2) {
    const bitmap = new Array<number>(Math.ceil(points.length / 8)).fill(0);
    points.forEach((p, i) => {
      if (p.elevation !== undefined) bitmap[i >> 3] |= 1 << (i % 8);
    });
    out.push(...bitmap);
  }
  let lat = 0;
  let lng = 0;
  let ele = 0;
  for (const p of points) {
    const la = Math.round(p.latitude * 1e6);
    const ln = Math.round(p.longitude * 1e6);
    zigzag(out, la - lat);
    zigzag(out, ln - lng);
    lat = la;
    lng = ln;
    if (mode !== 0 && p.elevation !== undefined) {
      const e = Math.round(p.elevation * 10);
      zigzag(out, e - ele);
      ele = e;
    }
  }
  return new Uint8Array(out).buffer;
}
