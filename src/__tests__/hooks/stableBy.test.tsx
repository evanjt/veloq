/**
 * Scenario: a query refetches on window focus and hands back a new array
 * holding the same data. The feed and the insights tab both keep the previous
 * reference so a FlatList and a memo do not rebuild, and they did it by
 * comparing and rewriting a ref during render.
 *
 * Expected behaviour: the same reference while the key is unchanged, a fresh
 * one the moment it moves, and nothing written during render, so a render
 * React throws away leaves nothing for the next one to read.
 */

import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { useStableBy } from '@/shared/app/useStableBy';

interface Props {
  v: { id: string }[];
  k: string;
}

describe('useStableBy', () => {
  it('hands back the first reference while the key holds', () => {
    const first = [{ id: 'a' }];
    const { result, rerender } = renderHook(({ v, k }: Props) => useStableBy(v, k), {
      initialProps: { v: first, k: 'a' },
    });

    expect(result.current).toBe(first);

    rerender({ v: [{ id: 'a' }], k: 'a' });

    expect(result.current).toBe(first);
  });

  it('takes the new reference when the key moves', () => {
    const first = [{ id: 'a' }];
    const second = [{ id: 'b' }];
    const { result, rerender } = renderHook(({ v, k }: Props) => useStableBy(v, k), {
      initialProps: { v: first, k: 'a' },
    });

    rerender({ v: second, k: 'b' });

    expect(result.current).toBe(second);
  });

  it('does not give a later value back under an unchanged key', () => {
    const first = [{ id: 'a' }];
    const { result, rerender } = renderHook(({ v, k }: Props) => useStableBy(v, k), {
      initialProps: { v: first, k: 'a' },
    });

    rerender({ v: [{ id: 'a' }], k: 'a' });
    rerender({ v: [{ id: 'a' }], k: 'a' });

    expect(result.current).toBe(first);
  });

  it('carries undefined, which is a different answer from an empty list', () => {
    const { result, rerender } = renderHook(
      ({ v, k }: { v: number[] | undefined; k: string }) => useStableBy(v, k),
      { initialProps: { v: undefined as number[] | undefined, k: 'none' } }
    );

    expect(result.current).toBeUndefined();

    const empty: number[] = [];
    rerender({ v: empty, k: '' });

    expect(result.current).toBe(empty);
  });

  /**
   * A double render is what the rule's hazard looks like from a test: the hook
   * runs twice for one commit. A ref written on the first pass is read by the
   * second; a memo keyed on the same key is not.
   */
  it('survives a double render under StrictMode', () => {
    const first = [{ id: 'a' }];
    const { result, rerender } = renderHook(({ v, k }: Props) => useStableBy(v, k), {
      initialProps: { v: first, k: 'a' },
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    });

    expect(result.current).toBe(first);

    rerender({ v: [{ id: 'a' }], k: 'a' });

    expect(result.current).toBe(first);
  });
});
