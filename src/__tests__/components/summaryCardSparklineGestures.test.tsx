/**
 * Scenario: both summary card sparklines are a tap target that opens the hero
 * metric's chart and a drag target that scrubs the hero. Nothing exercised
 * either gesture, so composing them simultaneously (a scrub that also
 * navigates on release) or dropping the long tap window (a slightly slow tap
 * that does nothing) passed every gate.
 *
 * Expected behaviour: a tap navigates and selects no day, a drag past the
 * slop scrubs and does not navigate, the tap waits for the drag to fail, and
 * a tap held up to half a second still counts.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { SummaryCardSparkline } from '@/features/home/components/SummaryCardSparkline';
import { SummaryCardHRVSparkline } from '@/features/home/components/SummaryCardHRVSparkline';
import { CHART_CONFIG } from '@/shared/charts/constants';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

type Built = { pans: ReturnType<typeof Gesture.Pan>[]; taps: ReturnType<typeof Gesture.Tap>[] };
type Handlers = Record<string, (event?: Record<string, number>) => void>;
type Config = Record<string, unknown> & { requireToFail?: unknown[]; simultaneousWith?: unknown[] };

/** Every pan and tap the chart builds, newest last. */
function captureGestures(): Built {
  const built: Built = { pans: [], taps: [] };
  const pan = Gesture.Pan.bind(Gesture);
  const tap = Gesture.Tap.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = pan();
    built.pans.push(gesture);
    return gesture;
  });
  jest.spyOn(Gesture, 'Tap').mockImplementation(() => {
    const gesture = tap();
    built.taps.push(gesture);
    return gesture;
  });
  return built;
}

const handlersOf = (gesture: unknown) => (gesture as { handlers: Handlers }).handlers;
const configOf = (gesture: unknown) => (gesture as { config: Config }).config;

/** The scrub and the tap reach JS through runOnJS, which the reanimated mock defers. */
async function settle(run: () => void) {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const SERIES = [40, 41, 43, 42, 44, 45, 46];

const CHARTS = [
  [
    'fitness',
    (props: { onTap: () => void; onScrub: (v: unknown) => void }) => (
      <SummaryCardSparkline
        fitnessData={SERIES}
        fatigueData={SERIES.map((v) => v + 5)}
        formData={SERIES.map((v) => -v / 4)}
        width={300}
        {...props}
      />
    ),
  ],
  [
    'HRV',
    (props: { onTap: () => void; onScrub: (v: unknown) => void }) => (
      <SummaryCardHRVSparkline
        hrvData={SERIES}
        rhrData={SERIES.map((v) => v + 10)}
        width={300}
        {...props}
      />
    ),
  ],
] as const;

afterEach(() => jest.restoreAllMocks());

describe.each(CHARTS)('the %s sparkline', (_name, chart) => {
  function mount() {
    const built = captureGestures();
    const onTap = jest.fn();
    const onScrub = jest.fn();
    const tree = render(chart({ onTap, onScrub }));
    const pan = built.pans[built.pans.length - 1];
    const tap = built.taps[built.taps.length - 1];
    const attached = tree.UNSAFE_getByType(GestureDetector).props.gesture as { prepare(): void };
    return { pan, tap, attached, onTap, onScrub };
  }

  it('navigates on a tap and selects no day', async () => {
    const { tap, onTap, onScrub } = mount();

    await settle(() => handlersOf(tap).onEnd?.({ x: 150, y: 20 }));

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onScrub).not.toHaveBeenCalled();
  });

  it('scrubs on a drag and does not navigate', async () => {
    const { pan, onTap, onScrub } = mount();

    await settle(() => {
      handlersOf(pan).onStart?.({ x: 10 });
      handlersOf(pan).onUpdate?.({ x: 200 });
    });

    expect(onScrub).toHaveBeenCalled();
    expect(onScrub.mock.calls.at(-1)?.[0]).not.toBeNull();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('starts the scrub only past the drag slop, and the tap waits for it to fail', () => {
    const { pan, tap, attached } = mount();

    expect(configOf(pan)).toMatchObject({
      activeOffsetXStart: -CHART_CONFIG.DRAG_SLOP,
      activeOffsetXEnd: CHART_CONFIG.DRAG_SLOP,
    });
    // The detector prepares the composition when it attaches, which is what
    // writes the relation between the two into the tap's config.
    attached.prepare();
    expect(configOf(tap).requireToFail).toContain(pan);
    expect(configOf(tap).simultaneousWith ?? []).not.toContain(pan);
  });

  it('counts a touch held for half a second as a tap', () => {
    const { tap } = mount();

    expect(configOf(tap).maxDurationMs).toBeGreaterThanOrEqual(500);
  });
});
