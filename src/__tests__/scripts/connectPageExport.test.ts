/**
 * Scenario: the connect page pulls the whole library from the phone as one archive: it asks the
 * phone to build it, waits for it, reads it in 1 MiB asks by offset and saves the bytes.
 *
 * Expected behaviour: the saved bytes equal the phone's archive; a link dropped part way resumes
 * at the bytes written, after the phone confirms the same export and digest; a failed build ends
 * the pull with the phone's reason; the last byte is followed by `export.done`; raw reply frames
 * settle an ask with their bytes, never parsed as text.
 */

import { createHash } from 'crypto';

import {
  READ_BYTES,
  pullArchive,
  type ArchiveSink,
  type PullState,
} from '../../../web/connect/exportArchive';
import { Replies } from '../../../web/connect/link';

const MIB = 1024 * 1024;

function archive(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, n) => (n * 13 + (n >> 8)) % 251);
}

class MemorySink implements ArchiveSink {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;
  async write(bytes: Uint8Array) {
    this.chunks.push(bytes);
  }
  async close() {
    this.closed = true;
  }
  async abort() {
    this.aborted = true;
  }
  get saved() {
    return Buffer.concat(this.chunks);
  }
}

/** A phone that answers the four export methods for one archive. */
function phone(data: Uint8Array, options: { building?: number; failure?: string } = {}) {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const asked: [string, Record<string, number>][] = [];
  let statuses = 0;
  let dropAt: number | null = null;
  const handle = async (method: string, given: object): Promise<unknown> => {
    const params = given as Record<string, number>;
    asked.push([method, params]);
    switch (method) {
      case 'export.begin':
        return { exportId: 'e1' };
      case 'export.status': {
        statuses += 1;
        if (options.failure) {
          return {
            state: 'failed',
            bytes: 0,
            rides: 4,
            ridesDone: 1,
            sha256: null,
            error: options.failure,
          };
        }
        if (statuses <= (options.building ?? 0)) {
          return {
            state: 'building',
            bytes: 10,
            rides: 4,
            ridesDone: statuses,
            sha256: null,
            error: null,
          };
        }
        return { state: 'ready', bytes: data.length, rides: 4, ridesDone: 4, sha256, error: null };
      }
      case 'export.read': {
        if (dropAt !== null && params.offset >= dropAt) {
          dropAt = null;
          throw new Error('not connected');
        }
        return data.slice(params.offset, params.offset + params.length);
      }
      case 'export.done':
        return { ok: true };
      default:
        throw new Error(`unknown method ${method}`);
    }
  };
  return {
    ask: handle,
    asked,
    sha256,
    dropAfter(offset: number) {
      dropAt = offset;
    },
    reads: () => asked.filter(([method]) => method === 'export.read').map(([, p]) => p),
  };
}

const state = (): PullState => ({ exportId: null, sha256: null, bytes: 0, written: 0 });
const options = { since: null, originals: true };

describe('pulling the library archive', () => {
  it('reads a 3 MiB archive in three asks and saves the same bytes', async () => {
    const data = archive(3 * MIB);
    const fake = phone(data);
    const sink = new MemorySink();
    await pullArchive({
      ask: fake.ask,
      sink,
      state: state(),
      options,
      onProgress: () => undefined,
    });

    expect(fake.reads()).toEqual([
      { exportId: 'e1', offset: 0, length: READ_BYTES },
      { exportId: 'e1', offset: MIB, length: READ_BYTES },
      { exportId: 'e1', offset: 2 * MIB, length: READ_BYTES },
    ]);
    expect(Buffer.compare(sink.saved, Buffer.from(data))).toBe(0);
    expect(sink.closed).toBe(true);
    expect(fake.asked.map(([method]) => method).at(-1)).toBe('export.done');
  });

  it('sends the since-date and the originals switch with the begin', async () => {
    const fake = phone(archive(10));
    await pullArchive({
      ask: fake.ask,
      sink: new MemorySink(),
      state: state(),
      options: { since: 1_700_000_000, originals: false },
      onProgress: () => undefined,
    });
    expect(fake.asked[0]).toEqual(['export.begin', { since: 1_700_000_000, originals: false }]);
  });

  it('asks the last read for only the bytes left', async () => {
    const data = archive(MIB + 5);
    const fake = phone(data);
    const sink = new MemorySink();
    await pullArchive({
      ask: fake.ask,
      sink,
      state: state(),
      options,
      onProgress: () => undefined,
    });
    expect(fake.reads().map((read) => read.length)).toEqual([READ_BYTES, 5]);
    expect(Buffer.compare(sink.saved, Buffer.from(data))).toBe(0);
  });

  it('shows the rides done and the bytes written while it builds and reads', async () => {
    const fake = phone(archive(2 * MIB), { building: 2 });
    const seen: { ridesDone: number; rides: number; written: number }[] = [];
    await pullArchive({
      ask: fake.ask,
      sink: new MemorySink(),
      state: state(),
      options,
      pollMs: 0,
      onProgress: (progress) => seen.push(progress),
    });
    expect(seen[0]).toMatchObject({ ridesDone: 1, rides: 4, written: 0 });
    expect(seen.at(-1)).toMatchObject({ ridesDone: 4, rides: 4, written: 2 * MIB });
  });

  it('resumes a dropped link at the bytes written and saves the same bytes', async () => {
    const data = archive(3 * MIB);
    const fake = phone(data);
    fake.dropAfter(MIB);
    const sink = new MemorySink();
    const held = state();
    await expect(
      pullArchive({ ask: fake.ask, sink, state: held, options, onProgress: () => undefined })
    ).rejects.toThrow('not connected');
    expect(held.written).toBe(MIB);
    expect(sink.closed).toBe(false);
    expect(sink.aborted).toBe(false);

    await pullArchive({ ask: fake.ask, sink, state: held, options, onProgress: () => undefined });

    expect(fake.asked.filter(([method]) => method === 'export.begin')).toHaveLength(1);
    expect(fake.reads().map((read) => read.offset)).toEqual([0, MIB, MIB, 2 * MIB]);
    expect(Buffer.compare(sink.saved, Buffer.from(data))).toBe(0);
  });

  it('refuses to resume when the phone holds another archive', async () => {
    const first = phone(archive(2 * MIB));
    first.dropAfter(MIB);
    const sink = new MemorySink();
    const held = state();
    await pullArchive({
      ask: first.ask,
      sink,
      state: held,
      options,
      onProgress: () => undefined,
    }).catch(() => undefined);
    const other = phone(archive(2 * MIB).map((byte) => byte ^ 1));
    await expect(
      pullArchive({ ask: other.ask, sink, state: held, options, onProgress: () => undefined })
    ).rejects.toThrow();
    expect(other.reads()).toEqual([]);
    expect(sink.aborted).toBe(true);
  });

  it('ends with the phone’s reason when the build fails, and writes nothing', async () => {
    const fake = phone(archive(10), { failure: 'no space left' });
    const sink = new MemorySink();
    await expect(
      pullArchive({ ask: fake.ask, sink, state: state(), options, onProgress: () => undefined })
    ).rejects.toThrow('no space left');
    expect(sink.chunks).toEqual([]);
    expect(sink.aborted).toBe(true);
    expect(fake.reads()).toEqual([]);
  });

  it('aborts the sink and sends no done when a range arrives with a flipped byte', async () => {
    const data = archive(2 * MIB);
    const fake = phone(data);
    let reads = 0;
    const ask = async (method: string, params: object) => {
      const reply = await fake.ask(method, params);
      if (method === 'export.read' && ++reads === 2) {
        const bad = (reply as Uint8Array).slice();
        bad[7] ^= 1;
        return bad;
      }
      return reply;
    };
    const sink = new MemorySink();
    await expect(
      pullArchive({ ask, sink, state: state(), options, onProgress: () => undefined })
    ).rejects.toThrow(/does not match/);
    expect(sink.aborted).toBe(true);
    expect(sink.closed).toBe(false);
    expect(fake.asked.map(([method]) => method)).not.toContain('export.done');
  });

  it('checks the digest across a resume, over the bytes written before the drop', async () => {
    const data = archive(3 * MIB);
    const fake = phone(data);
    fake.dropAfter(MIB);
    const sink = new MemorySink();
    const held = state();
    await pullArchive({
      ask: fake.ask,
      sink,
      state: held,
      options,
      onProgress: () => undefined,
    }).catch(() => undefined);
    await pullArchive({ ask: fake.ask, sink, state: held, options, onProgress: () => undefined });
    expect(sink.closed).toBe(true);
  });

  it('stops when told to, reads no further and leaves the file to the caller', async () => {
    const fake = phone(archive(3 * MIB));
    const sink = new MemorySink();
    const controller = new AbortController();
    await expect(
      pullArchive({
        ask: fake.ask,
        sink,
        state: state(),
        options,
        signal: controller.signal,
        onProgress: ({ written }) => {
          if (written >= MIB) controller.abort();
        },
      })
    ).rejects.toThrow();
    expect(fake.reads()).toHaveLength(1);
    expect(sink.aborted).toBe(false);
    expect(sink.closed).toBe(false);
  });
});

describe('a raw reply frame', () => {
  const RAW = 4;
  const LAST = 2;
  function frame(id: number, seq: number, flags: number, body: Uint8Array) {
    const out = new Uint8Array(10 + body.length);
    const view = new DataView(out.buffer);
    view.setUint8(0, 1);
    view.setUint8(1, flags);
    view.setUint32(2, id);
    view.setUint32(6, seq);
    out.set(body, 10);
    return out;
  }

  it('settles an ask with its joined bytes, which are not read as JSON', async () => {
    const replies = new Replies();
    const bytes = Uint8Array.of(0x50, 0x4b, 3, 4, 0, 255, 128);
    const asked = (id: number) => id === 9;
    expect(await replies.take(frame(9, 0, RAW, bytes.slice(0, 3)), asked)).toBeUndefined();
    const reply = await replies.take(frame(9, 1, RAW | LAST, bytes.slice(3)), asked);
    expect(reply?.id).toBe(9);
    expect(Array.from(reply?.result as Uint8Array)).toEqual(Array.from(bytes));
  });

  it('is an empty result when the one frame carries nothing', async () => {
    const reply = await new Replies().take(frame(9, 0, RAW | LAST, new Uint8Array()), () => true);
    expect((reply?.result as Uint8Array).length).toBe(0);
  });
});
