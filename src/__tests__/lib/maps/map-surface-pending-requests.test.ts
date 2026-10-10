/**
 * Scenario: a cluster expansion or a feature query is in flight when the
 * screen unmounts, the surface reclaimer releases the map, or the render
 * process crashes. The page that would answer is gone in all three.
 *
 * Expected behaviour: every waiting caller is settled with the empty answer
 * its call site named, so no closure is retained for the life of the process.
 * A page that is alive but never answers settles the same way once the
 * deadline passes.
 */
import { createPendingRequests } from '@/features/maps/lib/pendingRequests';

describe('createPendingRequests', () => {
  it('resolves a request when its answer arrives', async () => {
    const pending = createPendingRequests();
    const sent: string[] = [];
    const answer = pending.open<number[]>([], (id) => sent.push(id));

    expect(sent).toHaveLength(1);
    pending.settle(sent[0], [1, 2, 3]);
    await expect(answer).resolves.toEqual([1, 2, 3]);
    expect(pending.size()).toBe(0);
  });

  it('gives every request a distinct id', () => {
    const pending = createPendingRequests();
    const sent: string[] = [];
    pending.open<number[]>([], (id) => sent.push(id));
    pending.open<number[]>([], (id) => sent.push(id));

    expect(sent[0]).not.toBe(sent[1]);
    expect(pending.size()).toBe(2);
  });

  it('settles every waiting caller with its own empty answer on abandon', async () => {
    const pending = createPendingRequests();
    const ids: string[] = [];
    const features = pending.open<GeoJSON.Feature[]>([], (id) => ids.push(id));
    const zoom = pending.open<number | null>(null, (id) => ids.push(id));

    pending.abandon();

    await expect(features).resolves.toEqual([]);
    await expect(zoom).resolves.toBeNull();
    expect(pending.size()).toBe(0);
  });

  it('ignores an answer to a request that has already been settled', async () => {
    const pending = createPendingRequests();
    const ids: string[] = [];
    const answer = pending.open<number[]>([], (id) => ids.push(id));

    pending.abandon();
    pending.settle(ids[0], [9]);

    await expect(answer).resolves.toEqual([]);
  });

  it('ignores an answer to an id it never issued', () => {
    const pending = createPendingRequests();
    expect(() => pending.settle('req_never', [1])).not.toThrow();
  });

  it('settles a request opened after an abandon, not before', async () => {
    const pending = createPendingRequests();
    pending.abandon();

    const ids: string[] = [];
    const answer = pending.open<number[]>([], (id) => ids.push(id));
    expect(pending.size()).toBe(1);
    pending.settle(ids[0], [4]);
    await expect(answer).resolves.toEqual([4]);
  });

  describe('the deadline', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('hands a request the page never answers its empty answer', async () => {
      const pending = createPendingRequests(2000);
      const features = pending.open<number[]>([], () => {});
      const zoom = pending.open<number | null>(null, () => {});

      jest.advanceTimersByTime(1999);
      expect(pending.size()).toBe(2);
      jest.advanceTimersByTime(1);

      await expect(features).resolves.toEqual([]);
      await expect(zoom).resolves.toBeNull();
      expect(pending.size()).toBe(0);
    });

    it('ignores an answer that arrives after the deadline', async () => {
      const pending = createPendingRequests(2000);
      const ids: string[] = [];
      const answer = pending.open<number[]>([], (id) => ids.push(id));

      jest.advanceTimersByTime(2000);
      pending.settle(ids[0], [5]);

      await expect(answer).resolves.toEqual([]);
    });

    it('leaves no timer behind once the page answers or goes away', () => {
      const pending = createPendingRequests(2000);
      const ids: string[] = [];
      pending.open<number[]>([], (id) => ids.push(id));
      pending.open<number[]>([], (id) => ids.push(id));

      pending.settle(ids[0], [1]);
      pending.abandon();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts the clock per request', async () => {
      const pending = createPendingRequests(2000);
      const first = pending.open<string>('empty', () => {});
      jest.advanceTimersByTime(1500);
      const ids: string[] = [];
      const second = pending.open<string>('empty', (id) => ids.push(id));
      jest.advanceTimersByTime(500);

      await expect(first).resolves.toBe('empty');
      expect(pending.size()).toBe(1);
      pending.settle(ids[0], 'answered');
      await expect(second).resolves.toBe('answered');
    });
  });
});
