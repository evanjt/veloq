/**
 * Scenario: on a device the engine handle exists from the first require, so a
 * subscriber mounts holding the same object before and after the open. Opening
 * announces nothing on any channel, and a memo keyed on the trigger keeps the
 * empty default it read before the open, which is what happens when the first
 * open fails on a held file and the retry opens it later.
 *
 * Expected behaviour: the trigger moves when the engine opens, with one handle
 * throughout, and does not move again on renders that open nothing.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';

const mockHandle = { subscribe: () => () => {} };

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockHandle,
  isEngineReady: () => true,
}));

function Probe() {
  const trigger = useEngineSubscription(['activities']);
  return <Text testID="trigger">{String(trigger)}</Text>;
}

beforeEach(() => {
  useEngineStatus.setState({ readyNonce: 0 });
});

describe('a subscriber mounted before the engine opened', () => {
  it('moves its trigger when the engine opens under the same handle', async () => {
    const tree = await render(<Probe />);
    const before = tree.getByTestId('trigger').props.children;

    await act(() => useEngineStatus.getState().markEngineReady());

    expect(tree.getByTestId('trigger').props.children).not.toBe(before);
  });

  it('moves again when a clear reopens it, and not on a render that opens nothing', async () => {
    const tree = await render(<Probe />);
    await act(() => useEngineStatus.getState().markEngineReady());
    const afterFirst = tree.getByTestId('trigger').props.children;

    await tree.rerender(<Probe />);
    expect(tree.getByTestId('trigger').props.children).toBe(afterFirst);

    await act(() => useEngineStatus.getState().markEngineReady());
    expect(tree.getByTestId('trigger').props.children).not.toBe(afterFirst);
  });
});
