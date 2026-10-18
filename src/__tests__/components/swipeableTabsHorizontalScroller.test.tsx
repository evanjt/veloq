/**
 * Scenario: a page in the tab pager holds a row of chips that scrolls
 * sideways, and a sideways pan on that row paged the tabs instead.
 *
 * Expected behaviour: the pager's pan waits for the row's own gesture to fail,
 * so a pan that starts on the row scrolls it, and only for as long as the row
 * is mounted. A pan anywhere else on the page still pages.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { SwipeableTabs } from '@/shared/ui';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

type Pan = ReturnType<typeof Gesture.Pan>;
type Native = ReturnType<typeof Gesture.Native>;
type Manager = { activate: jest.Mock; fail: jest.Mock };
type Touch = { allTouches: { absoluteX: number; absoluteY: number; x: number; y: number }[] };
type Handlers = {
  onTouchesDown?: (e: Touch, mgr: Manager) => void;
  onTouchesMove?: (e: Touch, mgr: Manager) => void;
};

const TABS = [
  { key: 'plots', label: 'Plots', icon: 'chart-line' as const },
  { key: 'notes', label: 'Notes', icon: 'note-text-outline' as const },
];

const STREAMS = [CHART_CONFIGS.power, CHART_CONFIGS.heartrate, CHART_CONFIGS.cadence];

function capture() {
  const pans: Pan[] = [];
  const natives: Native[] = [];
  const realPan = Gesture.Pan.bind(Gesture);
  const realNative = Gesture.Native.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = realPan();
    pans.push(gesture);
    return gesture;
  });
  jest.spyOn(Gesture, 'Native').mockImplementation(() => {
    const gesture = realNative();
    natives.push(gesture);
    return gesture;
  });
  return { pans, natives };
}

function pager(withRow: boolean) {
  return (
    <SwipeableTabs tabs={TABS} activeTab="plots" onTabChange={jest.fn()} isDark={false}>
      {withRow ? (
        <ChartTypeSelector available={STREAMS} selected={['power']} onToggle={jest.fn()} />
      ) : (
        <React.Fragment />
      )}
      <React.Fragment />
    </SwipeableTabs>
  );
}

const waitsOn = (pan: Pan) => pan.config.requireToFail ?? [];

describe('a sideways scrolling row on a pager page', () => {
  afterEach(() => jest.restoreAllMocks());

  it('makes the pager wait for the row before it pages', async () => {
    const { pans, natives } = capture();
    await render(pager(true));
    const row = natives[natives.length - 1];
    expect(row).toBeDefined();
    expect(waitsOn(pans[pans.length - 1]!)).toContain(row);
  });

  it('stops the wait once the row is gone', async () => {
    const { pans } = capture();
    const tree = await render(pager(true));
    await tree.rerender(pager(false));
    expect(waitsOn(pans[pans.length - 1]!)).toEqual([]);
  });

  it('still pages a pan that starts anywhere else', async () => {
    const { pans } = capture();
    await render(pager(true));
    const handlers = (pans[pans.length - 1] as unknown as { handlers: Handlers }).handlers;
    const mgr: Manager = { activate: jest.fn(), fail: jest.fn() };
    const at = (x: number): Touch => ({
      allTouches: [{ absoluteX: x, absoluteY: 500, x, y: 400 }],
    });
    handlers.onTouchesDown?.(at(375), mgr);
    handlers.onTouchesMove?.(at(345), mgr);
    handlers.onTouchesMove?.(at(315), mgr);
    expect(mgr.activate).toHaveBeenCalledTimes(1);
    expect(mgr.fail).not.toHaveBeenCalled();
  });

  it('is a plain row outside a pager', async () => {
    const { natives } = capture();
    await render(<ChartTypeSelector available={STREAMS} selected={[]} onToggle={jest.fn()} />);
    expect(natives).toHaveLength(1);
  });
});
