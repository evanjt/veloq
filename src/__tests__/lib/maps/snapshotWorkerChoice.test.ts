/**
 * Scenario: in `smart` 3D mode the feed mixes flat and drape cards by whether
 * the ride has terrain worth draping. The pool handed each request to
 * whichever worker was free first, so a feed of ride, run, ride, run gave each
 * worker flat, drape, flat, drape, and every render rebuilt the whole style
 * instead of jumping the camera over the one already mounted.
 *
 * Expected behaviour: a request prefers a free worker that already holds its
 * style and mode, and is never held back when none does.
 */

import { pickSnapshotWorker } from '@/features/maps/lib/snapshotWorkerChoice';

const flat = { mapStyle: 'light', flat: true };
const drape = { mapStyle: 'light', flat: false };

function worker(id: number, lastRender: { mapStyle: string; flat: boolean } | null) {
  return { worker: id, lastRender };
}

describe('which worker takes the next render', () => {
  it('prefers the one that last drew the same thing', () => {
    const free = [worker(0, drape), worker(1, flat)];

    expect(pickSnapshotWorker(free, flat)).toBe(1);
    expect(pickSnapshotWorker(free, drape)).toBe(0);
  });

  it('sends it out anyway when no free worker matches', () => {
    // An idle worker is worth more than a fast path.
    const free = [worker(0, drape)];

    expect(pickSnapshotWorker(free, flat)).toBe(0);
  });

  it('holds nothing back when every free worker holds the wrong style', () => {
    // A priority render is the card the athlete is looking at, and an idle
    // worker is worth more than a fast path either way.
    const free = [worker(0, drape), worker(1, drape)];

    expect(pickSnapshotWorker(free, flat)).toBe(0);
  });

  it('tells two modes of the same style apart', () => {
    const free = [worker(0, { mapStyle: 'light', flat: false })];

    expect(pickSnapshotWorker(free, { mapStyle: 'light', flat: true })).toBe(0);
    expect(pickSnapshotWorker([worker(0, { mapStyle: 'light', flat: true })], flat)).toBe(0);
  });

  it('tells two styles of the same mode apart', () => {
    const free = [
      worker(0, { mapStyle: 'dark', flat: true }),
      worker(1, { mapStyle: 'light', flat: true }),
    ];

    expect(pickSnapshotWorker(free, { mapStyle: 'light', flat: true })).toBe(1);
  });

  it('treats an absent flat as a drape, which is what the page does', () => {
    const free = [worker(0, { mapStyle: 'light', flat: true }), worker(1, drape)];

    expect(pickSnapshotWorker(free, { mapStyle: 'light' })).toBe(1);
  });

  it('takes the first free worker when none has drawn anything yet', () => {
    expect(pickSnapshotWorker([worker(0, null), worker(1, null)], flat)).toBe(0);
  });

  it('answers null when nothing is free', () => {
    expect(pickSnapshotWorker([], flat)).toBeNull();
  });
});
