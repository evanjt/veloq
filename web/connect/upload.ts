/**
 * Sending an archive to the phone over the data channel.
 *
 * The page reads the archive a slice at a time from the `File` the athlete
 * chose, so a 500 MB collection is never held whole, hashes it the same way,
 * and sends it as binary frames after `import.begin`. The phone answers how
 * many bytes of that archive it already holds, so a page whose link dropped
 * calls `sendArchive` again with the same file and goes on from there.
 *
 * An inbound frame is the engine's `remote/import.rs` layout: a `u8` version, a
 * `u8` of flags, the `u32` import id and the `u32` place of the frame since
 * `import.begin`, from 0, all big-endian, then at most `PAYLOAD_BYTES` of the
 * archive.
 */

/** The engine's `MAX_PAYLOAD`: the most archive bytes one frame carries. */
export const PAYLOAD_BYTES = 16 * 1024;
/** The engine's inbound `HEADER_BYTES`. */
export const FRAME_HEADER = 10;
export const FRAME_VERSION = 1;

/** Frames are sent while the channel holds less than this unsent. */
export const HIGH_WATER = 1024 * 1024;
/** Once past `HIGH_WATER` the sender waits until the channel holds no more than this. */
export const LOW_WATER = 256 * 1024;

/** The most of the archive read in one slice when hashing. */
const HASH_SLICE_BYTES = 1024 * 1024;

/** What the sender needs of an archive: its name, its size and slices of it. */
export interface Archive {
  readonly name: string;
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** What the sender needs of a data channel. */
export interface UploadChannel {
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: ArrayBuffer): void;
  /** Call `listener` once, when the buffered amount falls to the threshold. */
  onBufferedAmountLow(listener: () => void): void;
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 over input that arrives in pieces. Web Crypto digests one whole
 * buffer and so cannot hash an archive that is never held whole.
 */
export class Sha256 {
  private state = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private filled = 0;
  private length = 0;
  private words = new Uint32Array(64);

  update(data: Uint8Array) {
    this.length += data.length;
    let at = 0;
    while (at < data.length) {
      const take = Math.min(64 - this.filled, data.length - at);
      this.block.set(data.subarray(at, at + take), this.filled);
      this.filled += take;
      at += take;
      if (this.filled === 64) {
        this.compress();
        this.filled = 0;
      }
    }
  }

  /** The digest of everything fed so far, as lowercase hex. */
  hex(): string {
    const finished = new Sha256();
    finished.state.set(this.state);
    finished.block.set(this.block);
    finished.filled = this.filled;
    finished.length = this.length;
    const bits = this.length * 8;
    const padding = new Uint8Array((this.filled < 56 ? 56 : 120) - this.filled + 8);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(padding.length - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(padding.length - 4, bits >>> 0);
    finished.update(padding);
    return Array.from(finished.state, (word) => word.toString(16).padStart(8, '0')).join('');
  }

  private compress() {
    const w = this.words;
    const view = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    const [sa = 0, sb = 0, sc = 0, sd = 0, se = 0, sf = 0, sg = 0, sh = 0] = this.state;
    let [a, b, c, d, e, f, g, h] = [sa, sb, sc, sd, se, sf, sg, sh];
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choose + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const s = this.state;
    s[0] = sa + a;
    s[1] = sb + b;
    s[2] = sc + c;
    s[3] = sd + d;
    s[4] = se + e;
    s[5] = sf + f;
    s[6] = sg + g;
    s[7] = sh + h;
  }
}

/** The SHA-256 of an archive in lowercase hex, read a slice at a time. */
export async function hashBlob(
  file: Archive,
  onProgress: (bytesRead: number) => void = () => undefined
): Promise<string> {
  const hash = new Sha256();
  for (let at = 0; at < file.size; at += HASH_SLICE_BYTES) {
    const end = Math.min(at + HASH_SLICE_BYTES, file.size);
    hash.update(new Uint8Array(await file.slice(at, end).arrayBuffer()));
    onProgress(end);
  }
  return hash.hex();
}

/** One inbound frame carrying `payload` as frame `seq` of import `importId`. */
export function importFrame(importId: number, seq: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER + payload.length);
  const view = new DataView(frame.buffer);
  frame[0] = FRAME_VERSION;
  view.setUint32(2, importId);
  view.setUint32(6, seq);
  frame.set(payload, FRAME_HEADER);
  return frame;
}

export interface SendArchive {
  file: Archive;
  /** The lowercase hex SHA-256 of the whole archive, from `hashBlob`. */
  sha256: string;
  /** Ask the phone a text method over the link. */
  ask: (method: string, params: object) => Promise<unknown>;
  channel: UploadChannel;
  /** Called with the bytes of the archive the phone holds, after each frame. */
  onProgress: (bytesSent: number, size: number) => void;
  signal?: AbortSignal;
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('upload stopped');
}

/** Wait until the channel holds no more than its low mark, or the upload is stopped. */
function untilRoom(channel: UploadChannel, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stopped = () => reject(new Error('upload stopped'));
    signal?.addEventListener('abort', stopped, { once: true });
    channel.onBufferedAmountLow(() => {
      signal?.removeEventListener('abort', stopped);
      resolve();
    });
  });
}

/**
 * Send `file` to the phone from the offset it holds and return the import id,
 * for `import.commit`. A second call with the same file after a drop begins
 * again under the same digest and sends only what the phone lacks.
 */
export async function sendArchive(args: SendArchive): Promise<number> {
  const { file, channel, signal } = args;
  const begun = (await args.ask('import.begin', {
    name: file.name,
    size: file.size,
    sha256: args.sha256,
  })) as { importId: number; offset: number };
  if (!Number.isInteger(begun.offset) || begun.offset < 0 || begun.offset > file.size) {
    throw new Error('the phone holds more of the archive than it has');
  }
  channel.bufferedAmountLowThreshold = LOW_WATER;
  let sent = begun.offset;
  args.onProgress(sent, file.size);
  for (let seq = 0; sent < file.size; seq++) {
    aborted(signal);
    const end = Math.min(sent + PAYLOAD_BYTES, file.size);
    const payload = new Uint8Array(await file.slice(sent, end).arrayBuffer());
    aborted(signal);
    if (channel.bufferedAmount > HIGH_WATER) await untilRoom(channel, signal);
    const frame = importFrame(begun.importId, seq, payload);
    channel.send(frame.buffer as ArrayBuffer);
    sent = end;
    args.onProgress(sent, file.size);
  }
  return begun.importId;
}
