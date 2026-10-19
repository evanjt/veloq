// A PNG decoder with no dependency beyond `node:zlib`, for guards that judge
// an image the tree carries.
//
// It reads non-interlaced images at 8 bits a channel in every colour type, which
// is what the asset tools here write. Anything else throws naming the format,
// so a guard refuses an image it cannot read rather than passing it unread.

import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Channels a pixel carries, by colour type: grey, RGB, palette, grey and
// alpha, RGBA.
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * The image in `bytes` as `{ width, height, rgba, alpha }`, `rgba` holding four
 * bytes a pixel, row by row, and `alpha` whether the file itself carries
 * transparency rather than having it filled in at 255. Throws on anything that
 * is not a PNG this can read.
 */
export function decodePng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG');
  }
  let header;
  let palette;
  let transparency;
  const data = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = body;
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colourType = header[9];
  const interlace = header[12];
  const channels = CHANNELS[colourType];
  if (depth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(
      `PNG at bit depth ${depth}, colour type ${colourType}, interlace ${interlace} is not read here; ` +
        'write it non-interlaced at 8 bits a channel'
    );
  }
  if (colourType === 3 && !palette) throw new Error('palette PNG has no PLTE chunk');

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('PNG image data is short');

  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value;
      if (filter === 0) value = line[i];
      else if (filter === 1) value = line[i] + left;
      else if (filter === 2) value = line[i] + up;
      else if (filter === 3) value = line[i] + ((left + up) >> 1);
      else if (filter === 4) value = line[i] + paeth(left, up, upLeft);
      else throw new Error(`PNG row ${y} has unknown filter ${filter}`);
      row[i] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      const v = row.subarray(x * channels, (x + 1) * channels);
      if (colourType === 6) rgba.set(v, out);
      else if (colourType === 2) rgba.set([v[0], v[1], v[2], 255], out);
      else if (colourType === 4) rgba.set([v[0], v[0], v[0], v[1]], out);
      else if (colourType === 0) rgba.set([v[0], v[0], v[0], 255], out);
      else {
        const index = v[0];
        rgba.set(
          [
            palette[index * 3],
            palette[index * 3 + 1],
            palette[index * 3 + 2],
            transparency && index < transparency.length ? transparency[index] : 255,
          ],
          out
        );
      }
    }
    previous = row;
  }
  const alpha = colourType === 4 || colourType === 6 || (colourType === 3 && !!transparency);
  return { width, height, rgba, alpha };
}
