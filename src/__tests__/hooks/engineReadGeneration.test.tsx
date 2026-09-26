/**
 * Scenario: a screen reads the engine inside a `useMemo` and lists the
 * subscription counter in the deps so the read re-runs when a sync lands. The
 * body never reads that counter, so `exhaustive-deps` calls it an unnecessary
 * dependency and the render gate calls it the sanctioned shape. Doing what
 * `exhaustive-deps` says removes the key, and the read then shows what was
 * true at mount.
 *
 * Expected behaviour: the hook hands back a reader the memo actually calls, so
 * the dependency is real. The reader's identity changes when a subscribed
 * event fires and at no other time, which is what re-runs the read.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { EngineEvent } from '@/shared/native/useEngineSubscription';

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const listeners: Record<string, (() => void)[]> = {};
let value = 'first';

const mockEngine = {
  subscribe: (event: string, cb: () => void) => {
    (listeners[event] ||= []).push(cb);
    return () => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
    };
  },
  read: () => {
    reads += 1;
    return value;
  },
};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

function fire(event: string): void {
  act(() => {
    for (const cb of listeners[event] ?? []) cb();
  });
}

let reads = 0;

function Probe({ events, other }: { events: EngineEvent[]; other: string }) {
  const readEngine = useEngineRead(events);
  const shown = React.useMemo(
    () => readEngine((engine) => (engine as unknown as { read: () => string }).read()),
    [readEngine]
  );
  return (
    <Text testID="shown">
      {shown}:{other}
    </Text>
  );
}

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  value = 'first';
  reads = 0;
  mockGetEngine.mockReturnValue(mockEngine as unknown as ReturnType<typeof getEngine>);
});

it('re-runs the read when a subscribed event fires', () => {
  const screen = render(<Probe events={['activities']} other="a" />);
  expect(screen.getByTestId('shown')).toHaveTextContent('first:a');

  value = 'second';
  fire('activities');

  expect(screen.getByTestId('shown')).toHaveTextContent('second:a');
});

it('keeps the reader identity stable, so a render nothing announced re-reads nothing', () => {
  const screen = render(<Probe events={['activities']} other="a" />);
  const before = reads;

  screen.rerender(<Probe events={['activities']} other="b" />);

  expect(reads).toBe(before);
});

it('hands the read undefined rather than throwing when the engine is not there', () => {
  mockGetEngine.mockReturnValue(null);

  function NoEngine() {
    const readEngine = useEngineRead(['activities']);
    const shown = readEngine(() => 'read ran');
    return <Text testID="shown">{String(shown)}</Text>;
  }

  const screen = render(<NoEngine />);

  expect(screen.getByTestId('shown')).toHaveTextContent('undefined');
});
