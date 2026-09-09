/**
 * Scenario: the recording screen opens with a name already in the field, either
 * the one passed in or a generated "Morning Ride". The athlete then edits it.
 * Expected behaviour: the name is there on the very first render rather than
 * appearing a commit later, and nothing that happens afterwards overwrites what
 * the athlete typed.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useActivityNameGeneration } from '@/features/recording/hooks/useActivityNameGeneration';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('the recording name', () => {
  /** Every value the hook returned, in render order. */
  function renderRecording(args: { initialName?: string; type: 'Ride' | 'Run' }) {
    const seen: string[] = [];
    const rendered = renderHook(() => {
      const value = useActivityNameGeneration(args);
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
      useActivityNameGeneration({ type: 'VirtualRide' as never })
    );

    expect(result.current.name).toContain('Virtual Ride');
  });

  it('keeps an edit when the props change underneath it', () => {
    const { result, rerender } = renderHook(
      (props: { initialName?: string; type: 'Ride' | 'Run' }) => useActivityNameGeneration(props),
      { initialProps: { initialName: 'Hill repeats', type: 'Ride' as const } }
    );

    act(() => result.current.setName('My own name'));
    rerender({ initialName: 'Something else', type: 'Run' });

    expect(result.current.name).toBe('My own name');
  });

  it('keeps an empty name the athlete cleared', () => {
    const { result, rerender } = renderHook(() =>
      useActivityNameGeneration({ initialName: 'Hill repeats', type: 'Ride' })
    );

    act(() => result.current.setName(''));
    rerender(undefined);

    expect(result.current.name).toBe('');
  });
});
