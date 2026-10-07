/**
 * Scenario: the recording screen opens with a name already in the field, either
 * the one passed in or a generated "Morning Ride". The athlete then edits it.
 * Expected behaviour: the name is there on the very first render rather than
 * appearing a commit later, and nothing that happens afterwards overwrites what
 * the athlete typed.
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  getTimeOfDayKey,
  useActivityNameGeneration,
} from '@/features/recording/hooks/useActivityNameGeneration';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

describe('the recording name', () => {
  /** Every value the hook returned, in render order. */
  function renderRecording(args: { initialName?: string; type: 'Ride' | 'Run' }) {
    const seen: string[] = [];
    const rendered = renderHook(() => {
      const value = useActivityNameGeneration({ startTime: null, ...args });
      seen.push(value.name);
      return value;
    });
    return { ...rendered, seen };
  }

  it('is seeded on the first render, not a commit later', () => {
    const { seen } = renderRecording({ initialName: 'Hill repeats', type: 'Ride' });

    // The value the very first render produced, before any effect could run.
    expect(seen[0]).toBe('Hill repeats');
    expect(seen).not.toContain('');
  });

  it('generates a time-of-day name when none was passed in', () => {
    const { result, seen } = renderRecording({ type: 'Ride' });

    expect(result.current.name).toMatch(
      /^recording\.timeOfDay\.(morning|afternoon|evening|night) Ride$/
    );
    expect(seen[0]).toContain('Ride');
  });

  it('splits a camel-case type into words for the default name', () => {
    const { result } = renderHook(() =>
      useActivityNameGeneration({ startTime: null, type: 'VirtualRide' as never })
    );

    expect(result.current.name).toContain('Virtual Ride');
  });

  it('keeps an edit when the props change underneath it', () => {
    const { result, rerender } = renderHook(
      (props: { initialName?: string; type: 'Ride' | 'Run' }) =>
        useActivityNameGeneration({ startTime: null, ...props }),
      { initialProps: { initialName: 'Hill repeats', type: 'Ride' as const } }
    );

    act(() => result.current.setName('My own name'));
    rerender({ initialName: 'Something else', type: 'Run' });

    expect(result.current.name).toBe('My own name');
  });

  it('keeps an empty name the athlete cleared', () => {
    const { result, rerender } = renderHook(() =>
      useActivityNameGeneration({ startTime: null, initialName: 'Hill repeats', type: 'Ride' })
    );

    act(() => result.current.setName(''));
    rerender(undefined);

    expect(result.current.name).toBe('');
  });
});

describe('recording start time names', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 26, 8, 0));
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    [11, 59, 'morning'],
    [12, 0, 'afternoon'],
    [16, 59, 'afternoon'],
    [17, 0, 'evening'],
    [20, 59, 'evening'],
    [21, 0, 'night'],
  ] as const)('uses the start at %i:%i for %s', (hour, minute, expected) => {
    const startTime = new Date(2026, 8, 25, hour, minute).getTime();
    expect(getTimeOfDayKey(startTime)).toBe(expected);
    const { result } = renderHook(() => useActivityNameGeneration({ type: 'Ride', startTime }));
    expect(result.current.name).toBe(`recording.timeOfDay.${expected} Ride`);
  });

  it('names a restored evening ride reviewed the next morning', () => {
    const startTime = new Date(2026, 8, 25, 18, 30).getTime();
    const { result } = renderHook(() => useActivityNameGeneration({ type: 'Ride', startTime }));
    expect(result.current.name).toBe('recording.timeOfDay.evening Ride');
  });

  it('uses the clock when a manual entry has no start time', () => {
    const { result } = renderHook(() =>
      useActivityNameGeneration({ type: 'Ride', startTime: null })
    );
    expect(getTimeOfDayKey(null)).toBe('morning');
    expect(result.current.name).toBe('recording.timeOfDay.morning Ride');
  });

  it('treats an epoch start as a timestamp rather than a missing start', () => {
    const epochHour = new Date(0).getHours();
    const expected =
      epochHour < 12
        ? 'morning'
        : epochHour < 17
          ? 'afternoon'
          : epochHour < 21
            ? 'evening'
            : 'night';
    jest.setSystemTime(new Date(2026, 8, 26, 13, 0));
    expect(getTimeOfDayKey(0)).toBe(expected);
  });

  it('preserves an explicit name and subsequent edits when the start changes', () => {
    const { result, rerender } = renderHook(
      ({ startTime }: { startTime: number }) =>
        useActivityNameGeneration({
          type: 'Ride',
          initialName: 'Hill repeats',
          startTime,
        }),
      { initialProps: { startTime: new Date(2026, 8, 25, 18, 30).getTime() } }
    );
    expect(result.current.name).toBe('Hill repeats');
    act(() => result.current.setName('My ride'));
    rerender({ startTime: new Date(2026, 8, 26, 12, 30).getTime() });
    expect(result.current.name).toBe('My ride');
    act(() => result.current.setName(''));
    rerender({ startTime: new Date(2026, 8, 26, 21, 30).getTime() });
    expect(result.current.name).toBe('');
  });
});
