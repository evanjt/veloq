/**
 * Scenario: the event list arrives as a fresh array literal on every render, so
 * the subscribe effect cannot depend on it directly. It was keyed on a
 * `useMemo` whose only dependency was the very expression it computed, which
 * memoised the value on itself and bought nothing.
 *
 * Expected behaviour: the subscription is set up once for a given set of
 * events and torn down and rebuilt only when that set actually changes, no
 * matter how many times the caller re-renders with a new array.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import type { EngineEvent } from '@/shared/native/useEngineSubscription';

const subscribed: string[] = [];
const unsubscribed: string[] = [];
const listeners: Record<string, (() => void)[]> = {};

const mockEngine = {
  subscribe: (event: string, cb: () => void) => {
    subscribed.push(event);
    (listeners[event] ||= []).push(cb);
    return () => {
      unsubscribed.push(event);
      listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
    };
  },
};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

function Probe({ events }: { events: EngineEvent[] }) {
  const trigger = useEngineSubscription(events);
  return <Text testID="trigger">{String(trigger)}</Text>;
}

beforeEach(() => {
  subscribed.length = 0;
  unsubscribed.length = 0;
  for (const key of Object.keys(listeners)) delete listeners[key];
});

describe('the engine subscription key', () => {
  it('does not resubscribe when the caller passes an equal list again', () => {
    const tree = render(<Probe events={['sections', 'groups']} />);
    expect(subscribed).toEqual(['sections', 'groups']);

    // A new array literal with the same contents, three times over.
    tree.rerender(<Probe events={['sections', 'groups']} />);
    tree.rerender(<Probe events={['sections', 'groups']} />);
    tree.rerender(<Probe events={['sections', 'groups']} />);

    expect(subscribed).toEqual(['sections', 'groups']);
    expect(unsubscribed).toEqual([]);
  });

  it('resubscribes when the set of events actually changes', () => {
    const tree = render(<Probe events={['sections'] as EngineEvent[]} />);
    expect(subscribed).toEqual(['sections']);

    tree.rerender(<Probe events={['sections', 'activities'] as EngineEvent[]} />);

    expect(unsubscribed).toEqual(['sections']);
    expect(subscribed).toEqual(['sections', 'sections', 'activities']);
  });

  it('treats a reordered list as a different key, because the join is the key', () => {
    const tree = render(<Probe events={['sections', 'groups'] as EngineEvent[]} />);
    subscribed.length = 0;
    unsubscribed.length = 0;

    tree.rerender(<Probe events={['groups', 'sections'] as EngineEvent[]} />);

    expect(unsubscribed).toEqual(['sections', 'groups']);
    expect(subscribed).toEqual(['groups', 'sections']);
  });

  it('bumps the trigger when a subscribed event fires', () => {
    const tree = render(<Probe events={['sections'] as EngineEvent[]} />);
    expect(tree.getByTestId('trigger').props.children).toBe('0');

    act(() => listeners.sections.forEach((l) => l()));

    expect(tree.getByTestId('trigger').props.children).toBe('1');
  });
});
