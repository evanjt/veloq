/**
 * Scenario: on a pushed screen the tab pager took the rightward swipe at its
 * first tab and the swipe from the leading edge, so the system back swipe
 * never fired over it.
 *
 * Expected behaviour: the pager's pan fails those touches, leaving them to the
 * system, and still activates a swipe it can page with.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { SwipeableTabs } from '@/shared/ui';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

type Touch = { absoluteX: number; absoluteY: number; x: number; y: number };
type TouchEvent = { allTouches: Touch[] };
type Manager = { activate: jest.Mock; fail: jest.Mock };
type PanHandlers = {
  onTouchesDown?: (e: TouchEvent, mgr: Manager) => void;
  onTouchesMove?: (e: TouchEvent, mgr: Manager) => void;
};

const TABS = [
  { key: 'one', label: 'Alpha', icon: 'lightbulb-outline' as const },
  { key: 'two', label: 'Beta', icon: 'dumbbell' as const },
  { key: 'three', label: 'Gamma', icon: 'map-marker-path' as const },
];

// The window is 750 wide under Jest.
const MID = 375;

async function renderPager(activeTab: string) {
  const built: ReturnType<typeof Gesture.Pan>[] = [];
  const real = Gesture.Pan.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = real();
    built.push(gesture);
    return gesture;
  });
  await render(
    <SwipeableTabs tabs={TABS} activeTab={activeTab} onTabChange={jest.fn()} isDark={false}>
      {TABS.map((tab) => (
        <React.Fragment key={tab.key} />
      ))}
    </SwipeableTabs>
  );
  const pan = built[built.length - 1];
  if (!pan) throw new Error('the pager built no pan');
  return (pan as unknown as { handlers: PanHandlers }).handlers;
}

const touch = (x: number) => ({ allTouches: [{ absoluteX: x, absoluteY: 300, x, y: 100 }] });

function swipe(handlers: PanHandlers, fromX: number, toX: number, ...thenX: number[]): Manager {
  const mgr: Manager = { activate: jest.fn(), fail: jest.fn() };
  handlers.onTouchesDown?.(touch(fromX), mgr);
  for (const x of [fromX + (toX - fromX) / 4, toX, ...thenX]) {
    handlers.onTouchesMove?.(touch(x), mgr);
  }
  return mgr;
}

describe('the tab pager on a pushed screen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fails a rightward swipe at the first tab', async () => {
    const mgr = swipe(await renderPager('one'), MID, MID + 60);
    expect(mgr.fail).toHaveBeenCalled();
    expect(mgr.activate).not.toHaveBeenCalled();
  });

  it('fails a swipe that starts at the leading edge on a later tab', async () => {
    const mgr = swipe(await renderPager('two'), 6, 80);
    expect(mgr.fail).toHaveBeenCalled();
    expect(mgr.activate).not.toHaveBeenCalled();
  });

  it('activates a rightward swipe from mid-screen on a later tab', async () => {
    const mgr = swipe(await renderPager('two'), MID, MID + 60);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();
  });

  it('activates a leftward swipe at the first tab', async () => {
    const mgr = swipe(await renderPager('one'), MID, MID - 60);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();
  });

  it('keeps a swipe it has taken when the finger turns back past where it began', async () => {
    const mgr = swipe(await renderPager('one'), MID, MID - 60, MID + 60);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();
  });

  it('keeps a swipe it has taken when a second finger lands', async () => {
    const handlers = await renderPager('one');
    const mgr = swipe(handlers, MID, MID - 60);
    const second = { absoluteX: 600, absoluteY: 300, x: 600, y: 100 };
    handlers.onTouchesDown?.({ allTouches: [touch(MID + 60).allTouches[0]!, second] }, mgr);
    handlers.onTouchesMove?.({ allTouches: [touch(MID + 60).allTouches[0]!, second] }, mgr);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();
  });

  it('decides each touch afresh', async () => {
    const handlers = await renderPager('one');
    expect(swipe(handlers, MID, MID - 60).activate).toHaveBeenCalledTimes(1);
    expect(swipe(handlers, MID, MID + 60).fail).toHaveBeenCalled();
  });

  it('fails a leftward swipe at the last tab', async () => {
    const mgr = swipe(await renderPager('three'), MID, MID - 60);
    expect(mgr.fail).toHaveBeenCalled();
    expect(mgr.activate).not.toHaveBeenCalled();
  });
});
