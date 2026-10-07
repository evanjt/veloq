/**
 * Scenario: HRV logged on the 1st and the 3rd. The engine's series carries
 * the 1st's reading over the 2nd, which is what the line draws, and scrubbing
 * the summary card onto the 2nd printed that reading under the 2nd's date.
 *
 * Expected behaviour: a scrub onto a day with no reading of its own reads '-'
 * for that series, a day with one reads it, and letting go reads today again.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { SummaryCard } from '@/features/home/components/SummaryCard';
import { Card } from '@/shared/ui/Card';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

type Handlers = Record<string, (event?: Record<string, number>) => void>;

function capturePans() {
  const built: ReturnType<typeof Gesture.Pan>[] = [];
  const pan = Gesture.Pan.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = pan();
    built.push(gesture);
    return gesture;
  });
  return built;
}

async function settle(run: () => void = () => {}) {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => jest.restoreAllMocks());

async function mount() {
  const pans = capturePans();
  const tree = render(
    <SummaryCard
      onProfilePress={() => {}}
      heroMetric="hrv"
      heroValue={62}
      heroLabel="metrics.hrv"
      heroColor="#000"
      hrvData={[50, 50, 62]}
      hrvRead={[true, false, true]}
      rhrData={[48, 46, 46]}
      rhrRead={[true, true, false]}
      showSparkline
      supportingMetrics={[]}
    />
  );
  await settle();
  // The sparkline's own surface, which the scrub maps a finger across.
  const surface = tree.UNSAFE_getByType(GestureDetector).props.children;
  const { width } = StyleSheet.flatten(surface.props.style) as { width: number };
  const handlers = (pans[pans.length - 1] as unknown as { handlers: Handlers }).handlers;
  const scrubTo = (index: number) => settle(() => handlers.onStart?.({ x: (index / 2) * width }));
  return { tree, handlers, scrubTo };
}

describe('scrubbing the HRV sparkline', () => {
  it('uses the shared raised surface', async () => {
    const { tree } = await mount();
    expect(tree.UNSAFE_getByType(Card).props.variant).toBe('raised');
  });

  it('leaves horizontal spacing to the home stack', async () => {
    const { tree } = await mount();
    const frame = tree.UNSAFE_getByType(Card).parent;
    const style = StyleSheet.flatten(frame?.props.style) ?? {};

    expect(style).not.toHaveProperty('marginHorizontal');
    expect(style).not.toHaveProperty('marginBottom');
  });

  it("reads '-' on a day carried forward and the reading on a day with one", async () => {
    const { tree, scrubTo } = await mount();

    await scrubTo(1);
    expect(tree.getByTestId('summary-card-hrv-value')).toHaveTextContent('-', { exact: true });
    expect(tree.getByTestId('summary-card-rhr-value')).toHaveTextContent('46');

    await scrubTo(0);
    expect(tree.getByTestId('summary-card-hrv-value')).toHaveTextContent('50');
  });

  it("reads '-' for resting heart rate on its own filled day", async () => {
    const { tree, scrubTo } = await mount();

    await scrubTo(2);

    expect(tree.getByTestId('summary-card-hrv-value')).toHaveTextContent('62');
    expect(tree.getByTestId('summary-card-rhr-value')).toHaveTextContent('-', { exact: true });
  });

  it('reads today again on release', async () => {
    const { tree, handlers, scrubTo } = await mount();
    await scrubTo(1);

    await settle(() => handlers.onFinalize?.());

    expect(tree.getByTestId('summary-card-hrv-value')).toHaveTextContent('62');
  });
});
