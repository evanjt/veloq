/**
 * Scenario: the strength body pair mounts four body diagrams where two are
 * drawn. The loupe pair is hidden by animating a container's opacity to zero,
 * so both copies stay mounted for the life of the tab, laid out and composited,
 * each drawn two and a half times larger than the pair on screen and clipped to
 * a 90 px circle nobody is looking through.
 *
 * Expected behaviour: the loupe pair is mounted while a scrub is live and not
 * before, and the fade out still runs before it goes.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { BodyPairWithLoupe } from '@/features/strength/components/BodyPairWithLoupe';

const SCALE = 0.8;

// Tagged by the scale it is drawn at, which is what tells the loupe's copies
// from the pair on screen.
jest.mock('react-native-body-highlighter', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ scale }: { scale: number }) => (
      <View testID={scale === 0.8 * 2.5 ? 'loupe-body' : 'body'} />
    ),
  };
});

type LongPress = ReturnType<typeof Gesture.LongPress>;
type Handlers = {
  onStart: (e: { x: number; y: number }) => void;
  onEnd: () => void;
  onFinalize: () => void;
};

/**
 * The gestures the diagram builds, newest last. The long press starts a scrub
 * and the pan ends it, which is how the component composes them.
 */
function captureGestures(): { press: LongPress[]; pan: LongPress[] } {
  const press: LongPress[] = [];
  const pan: LongPress[] = [];
  for (const [kind, built] of [
    ['LongPress', press],
    ['Pan', pan],
  ] as const) {
    const real = Gesture[kind].bind(Gesture) as () => LongPress;
    jest.spyOn(Gesture, kind).mockImplementation((() => {
      const gesture = real();
      built.push(gesture);
      return gesture;
    }) as never);
  }
  return { press, pan };
}

const newest = (built: LongPress[]) => built[built.length - 1];

const handlersOf = (gesture: LongPress) => (gesture as unknown as { handlers: Handlers }).handlers;

/**
 * A worklet reaches JS through `runOnJS`, which schedules rather than calls.
 * Under fake timers that schedule has to be run as well as awaited.
 */
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
  });
}

function diagram() {
  return (
    <BodyPairWithLoupe
      data={[]}
      gender="male"
      scale={SCALE}
      colors={['#111111']}
      onMuscleScrub={() => {}}
      tappableSlugs={new Set(['chest'])}
    />
  );
}

/** The bodies standing in the tree right now, by which pair they belong to. */
const mounted = (tree: ReturnType<typeof render>) => ({
  pair: tree.queryAllByTestId('body').length,
  loupe: tree.queryAllByTestId('loupe-body').length,
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the strength loupe', () => {
  it('mounts no body of its own until a scrub starts', () => {
    const tree = render(diagram());

    expect(mounted(tree)).toEqual({ pair: 2, loupe: 0 });
  });

  it('mounts its pair for the scrub', async () => {
    const { press } = captureGestures();
    const tree = render(diagram());

    await settle(() => handlersOf(newest(press)).onStart({ x: 10, y: 10 }));

    expect(mounted(tree)).toEqual({ pair: 2, loupe: 2 });
  });

  it('keeps them for the fade and drops them after it', async () => {
    const { press, pan } = captureGestures();
    const tree = render(diagram());
    await settle(() => handlersOf(newest(press)).onStart({ x: 10, y: 10 }));

    await settle(() => handlersOf(newest(pan)).onEnd());
    expect(mounted(tree).loupe).toBe(2);

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mounted(tree).loupe).toBe(0);
  });
});
