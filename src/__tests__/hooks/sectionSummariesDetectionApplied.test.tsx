/**
 * Scenario: a detection run lands after its follow gave up, so no TypeScript
 * caller fires `sections`. The engine posts `detectionApplied` and nothing else.
 *
 * Expected behaviour: the section summaries are read again on that event and
 * return the new count.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useSectionSummaries } from '@/features/routes/hooks/useEngine';

const listeners: Record<string, (() => void)[]> = {};
let count = 3;

const mockEngine = {
  subscribe: (event: string, cb: () => void) => {
    (listeners[event] ||= []).push(cb);
    return () => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
    };
  },
  getFilteredSectionSummaries: jest.fn((..._args: unknown[]) => ({
    totalCount: count,
    summaries: [],
  })),
};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

function Probe() {
  const { totalCount } = useSectionSummaries();
  return <Text testID="count">{String(totalCount)}</Text>;
}

describe('useSectionSummaries', () => {
  it('reads again when a detection run is applied', () => {
    const tree = render(<Probe />);
    expect(tree.getByTestId('count').props.children).toBe('3');

    count = 7;
    act(() => {
      for (const cb of listeners.detectionApplied ?? []) cb();
    });

    expect(tree.getByTestId('count').props.children).toBe('7');
    expect(mockEngine.getFilteredSectionSummaries).toHaveBeenCalledTimes(2);
  });
});
