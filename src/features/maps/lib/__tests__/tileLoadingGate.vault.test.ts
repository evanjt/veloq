import { createTileLoadingGate } from '../tileLoadingGate';

describe('createTileLoadingGate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows only after the delay while tiles are still loading', () => {
    const seen: boolean[] = [];
    const gate = createTileLoadingGate(300, (v) => seen.push(v));
    gate.loading();
    jest.advanceTimersByTime(299);
    expect(seen).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(seen).toEqual([true]);
  });

  it('never shows when the tiles settle inside the delay', () => {
    const seen: boolean[] = [];
    const gate = createTileLoadingGate(300, (v) => seen.push(v));
    gate.loading();
    jest.advanceTimersByTime(100);
    gate.settled();
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it('hides once shown and settled', () => {
    const seen: boolean[] = [];
    const gate = createTileLoadingGate(300, (v) => seen.push(v));
    gate.loading();
    jest.advanceTimersByTime(300);
    gate.settled();
    expect(seen).toEqual([true, false]);
  });

  it('treats a settle with no prior loading as a no-op', () => {
    const seen: boolean[] = [];
    const gate = createTileLoadingGate(300, (v) => seen.push(v));
    gate.settled();
    expect(seen).toEqual([]);
  });

  it('repeated loading messages arm one timer and report once', () => {
    const seen: boolean[] = [];
    const gate = createTileLoadingGate(300, (v) => seen.push(v));
    gate.loading();
    jest.advanceTimersByTime(200);
    gate.loading();
    jest.advanceTimersByTime(100);
    expect(seen).toEqual([true]);
    gate.loading();
    expect(seen).toEqual([true]);
  });

  it('cancel drops a pending show and a shown state without reporting', () => {
    const seen: boolean[] = [];
    const gate = createTileLoadingGate(300, (v) => seen.push(v));
    gate.loading();
    gate.cancel();
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });
});
