/**
 * Scenario: a worklet that calls back into JavaScript holds the function it
 * calls for as long as the UI runtime keeps the worklet, and that outlives the
 * screen. The pager's swipe handler held the screen's tab callback that way, so
 * every closed detail screen stayed reachable with everything it had read.
 *
 * Expected behaviour: a swipe still changes the tab while the pager is
 * mounted, and once it unmounts nothing a worklet holds reaches the screen.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import type { GestureType } from 'react-native-gesture-handler';

import { SwipeableTabs } from '@/shared/ui';
import { collectGarbage } from '../__shared__/collectGarbage';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

// What the UI runtime keeps: every function a worklet hands to the JS thread.
const mockHeldByWorklets: ((...args: unknown[]) => unknown)[] = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    runOnJS: (fn: (...args: unknown[]) => unknown) => {
      mockHeldByWorklets.push(fn);
      return fn;
    },
  };
});

const mockGestures: GestureType[] = [];
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: GestureType; children: unknown }) => {
      mockGestures.push(gesture);
      return children;
    },
  };
});

const TABS = [
  { key: 'kettle', label: 'Kettle', icon: 'cup' as const },
  { key: 'teapot', label: 'Teapot', icon: 'kettle' as const },
];

/** Stands in for everything a detail screen has read: its streams, its body. */
class ScreenData {
  samples = new Array(1000).fill(0);
}

function swipeToNext() {
  const pan = mockGestures[mockGestures.length - 1];
  const handlers = pan.handlers as unknown as {
    onUpdate: (e: object) => void;
    onEnd: (e: object, success: boolean) => void;
  };
  act(() => {
    handlers.onUpdate({ translationX: -300 });
    handlers.onEnd({ velocityX: -1000 }, true);
  });
}

function mountScreen(onTabChange: (key: string) => void) {
  return render(
    <SwipeableTabs tabs={TABS} activeTab="kettle" onTabChange={onTabChange} isDark={false}>
      <Text>boiling water</Text>
      <Text>steeping leaves</Text>
    </SwipeableTabs>
  );
}

/** Mounts a pager whose tab callback alone holds the screen's data. */
function mountHoldingData() {
  const data = new ScreenData();
  const view = mountScreen((key) => {
    data.samples[0] = key.length;
  });
  return { view, data: new WeakRef(data) };
}

beforeEach(() => {
  mockHeldByWorklets.length = 0;
  mockGestures.length = 0;
});

describe('the pager swipe and the screen behind it', () => {
  it('changes the tab on a swipe while mounted', () => {
    const onTabChange = jest.fn();
    mountScreen(onTabChange);

    swipeToNext();

    expect(onTabChange).toHaveBeenCalledWith('teapot');
  });

  it('calls the newest tab callback after the screen re-renders with another', () => {
    const first = jest.fn();
    const second = jest.fn();
    const view = mountScreen(first);
    view.rerender(
      <SwipeableTabs tabs={TABS} activeTab="kettle" onTabChange={second} isDark={false}>
        <Text>boiling water</Text>
        <Text>steeping leaves</Text>
      </SwipeableTabs>
    );

    swipeToNext();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('teapot');
  });

  it('stops reaching the screen once the pager unmounts', () => {
    const onTabChange = jest.fn();
    const view = mountScreen(onTabChange);
    swipeToNext();
    expect(mockHeldByWorklets.length).toBeGreaterThan(0);
    onTabChange.mockClear();

    view.unmount();
    for (const held of mockHeldByWorklets) held('teapot');

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('lets a closed screen be collected while the worklets keep their functions', async () => {
    const screenData = mountHoldingData();
    swipeToNext();

    screenData.view.unmount();
    // The gesture objects stand for the JS side, which unmounting releases.
    mockGestures.length = 0;
    await collectGarbage();

    expect(mockHeldByWorklets.length).toBeGreaterThan(0);
    expect(screenData.data.deref()).toBeUndefined();
  });
});
