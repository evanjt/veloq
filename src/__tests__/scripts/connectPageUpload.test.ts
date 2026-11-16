/**
 * Scenario: the connect page sends an archive to the phone as binary frames
 * and, after a dropped link, asks again for the same archive.
 *
 * Expected behaviour: the page sends only the bytes from the offset the phone
 * answers, never reads the archive whole, holds the channel's send buffer under
 * its ceiling, and numbers each begin's frames from zero.
 */

import { createHash } from 'crypto';

import {
  FRAME_HEADER,
  HIGH_WATER,
  LOW_WATER,
  PAYLOAD_BYTES,
  Sha256,
  hashBlob,
  importFrame,
  sendArchive,
  type UploadChannel,
} from '../../../web/connect/upload';

function bytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, n) => (n * 7) % 251);
}

/** A blob of `data` that counts the bytes read through slices and refuses a whole read. */
function blobOf(data: Uint8Array, name = 'rides.zip') {
  const reads: [number, number][] = [];
  const blob = {
    name,
    size: data.length,
    slice(start: number, end: number) {
      reads.push([start, end]);
      const part = data.slice(start, end);
      return { size: part.length, arrayBuffer: async () => part.buffer.slice(0) };
    },
  };
  return { blob, reads };
}

class FakeChannel implements UploadChannel {
  frames: Uint8Array[] = [];
  buffered = 0;
  bufferedAmountLowThreshold = 0;
  peak = 0;
  private waiting: (() => void)[] = [];
  get bufferedAmount() {
    return this.buffered;
  }
  send(data: ArrayBuffer) {
    this.frames.push(new Uint8Array(data));
    this.buffered += data.byteLength;
    this.peak = Math.max(this.peak, this.buffered);
  }
  onBufferedAmountLow(listener: () => void) {
    this.waiting.push(listener);
  }
  /** The network takes `count` bytes, and the channel says so when it falls to the threshold. */
  drain(count: number) {
    const before = this.buffered;
    this.buffered = Math.max(0, this.buffered - count);
    if (
      before > this.bufferedAmountLowThreshold &&
      this.buffered <= this.bufferedAmountLowThreshold
    ) {
      const listeners = this.waiting;
      this.waiting = [];
      for (const listener of listeners) listener();
    }
  }
}

const payloadOf = (frame: Uint8Array) => frame.slice(FRAME_HEADER);
const seqOf = (frame: Uint8Array) => new DataView(frame.buffer, frame.byteOffset).getUint32(6);
const idOf = (frame: Uint8Array) => new DataView(frame.buffer, frame.byteOffset).getUint32(2);

describe('the digest of an archive', () => {
  it('is the SHA-256 of the whole when fed in pieces', () => {
    const data = bytes(200_003);
    const hash = new Sha256();
    for (let at = 0; at < data.length; at += 777) hash.update(data.slice(at, at + 777));
    expect(hash.hex()).toBe(createHash('sha256').update(data).digest('hex'));
  });

  it('matches the empty message and one block boundary', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120]) {
      const data = bytes(length);
      const hash = new Sha256();
      hash.update(data);
      expect(hash.hex()).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });

  it('is taken a slice at a time and never from the whole archive', async () => {
    const data = bytes(3 * PAYLOAD_BYTES + 5);
    const { blob, reads } = blobOf(data);
    expect(await hashBlob(blob)).toBe(createHash('sha256').update(data).digest('hex'));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(([start, end]) => end - start <= 1024 * 1024)).toBe(true);
  });
});

describe('an inbound frame', () => {
  it('is a version, flags, the import id and the place, big-endian, then the bytes', () => {
    const frame = importFrame(0x01020304, 5, Uint8Array.of(9, 8, 7));
    expect(Array.from(frame)).toEqual([1, 0, 1, 2, 3, 4, 0, 0, 0, 5, 9, 8, 7]);
  });
});

describe('sending an archive', () => {
  const ask = (offset: number) => {
    const asked: [string, unknown][] = [];
    return {
      asked,
      send: async (method: string, params: unknown) => {
        asked.push([method, params]);
        return { importId: 77, offset };
      },
    };
  };

  it('begins with the name, size and digest and then sends every byte in order', async () => {
    const data = bytes(2 * PAYLOAD_BYTES + 100);
    const { blob } = blobOf(data);
    const channel = new FakeChannel();
    const phone = ask(0);
    const sent: number[] = [];

    const importId = await sendArchive({
      file: blob,
      sha256: createHash('sha256').update(data).digest('hex'),
      ask: phone.send,
      channel,
      onProgress: (bytesSent) => sent.push(bytesSent),
    });

    expect(importId).toBe(77);
    expect(phone.asked).toEqual([
      [
        'import.begin',
        {
          name: 'rides.zip',
          size: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
        },
      ],
    ]);
    expect(channel.frames.map(seqOf)).toEqual([0, 1, 2]);
    expect(channel.frames.every((frame) => idOf(frame) === 77)).toBe(true);
    const joined = Buffer.concat(channel.frames.map(payloadOf));
    expect(Buffer.compare(joined, Buffer.from(data))).toBe(0);
    expect(sent.at(-1)).toBe(data.length);
  });

  it('resumes from the offset the phone answers and sends no byte below it', async () => {
    const data = bytes(5 * PAYLOAD_BYTES + 123);
    const offset = 3 * PAYLOAD_BYTES;
    const { blob, reads } = blobOf(data);
    const channel = new FakeChannel();

    await sendArchive({
      file: blob,
      sha256: 'a'.repeat(64),
      ask: ask(offset).send,
      channel,
      onProgress: () => undefined,
    });

    expect(channel.frames.map(seqOf)).toEqual([0, 1, 2]);
    const joined = Buffer.concat(channel.frames.map(payloadOf));
    expect(Buffer.compare(joined, Buffer.from(data.slice(offset)))).toBe(0);
    expect(reads.every(([start]) => start >= offset)).toBe(true);
  });

  it('sends nothing when the phone already holds every byte', async () => {
    const data = bytes(1000);
    const { blob } = blobOf(data);
    const channel = new FakeChannel();
    await sendArchive({
      file: blob,
      sha256: 'a'.repeat(64),
      ask: ask(1000).send,
      channel,
      onProgress: () => undefined,
    });
    expect(channel.frames).toEqual([]);
  });

  it('refuses an offset past the end rather than send from a wrong place', async () => {
    const { blob } = blobOf(bytes(1000));
    await expect(
      sendArchive({
        file: blob,
        sha256: 'a'.repeat(64),
        ask: ask(1001).send,
        channel: new FakeChannel(),
        onProgress: () => undefined,
      })
    ).rejects.toThrow();
  });

  it('waits for the send buffer to fall to its low mark once it passes the high one', async () => {
    const data = bytes(Math.ceil((HIGH_WATER * 3) / PAYLOAD_BYTES) * PAYLOAD_BYTES);
    const { blob } = blobOf(data);
    const channel = new FakeChannel();
    let done = false;
    const sending = sendArchive({
      file: blob,
      sha256: 'a'.repeat(64),
      ask: ask(0).send,
      channel,
      onProgress: () => undefined,
    }).then(() => {
      done = true;
    });

    for (let turns = 0; turns < 10_000 && !done; turns++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (channel.buffered > LOW_WATER) channel.drain(channel.buffered - LOW_WATER);
    }
    await sending;

    expect(channel.bufferedAmountLowThreshold).toBe(LOW_WATER);
    expect(channel.peak).toBeLessThanOrEqual(HIGH_WATER + PAYLOAD_BYTES + FRAME_HEADER);
    expect(channel.frames).toHaveLength(data.length / PAYLOAD_BYTES);
  });

  it('stops when told to and sends no further frame', async () => {
    const data = bytes(10 * PAYLOAD_BYTES);
    const { blob } = blobOf(data);
    const channel = new FakeChannel();
    const controller = new AbortController();
    await expect(
      sendArchive({
        file: blob,
        sha256: 'a'.repeat(64),
        ask: ask(0).send,
        channel,
        signal: controller.signal,
        onProgress: (sentBytes) => {
          if (sentBytes >= 2 * PAYLOAD_BYTES) controller.abort();
        },
      })
    ).rejects.toThrow();
    expect(channel.frames).toHaveLength(2);
  });
});
