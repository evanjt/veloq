/**
 * Scenario: scrubbing the season comparison chart showed the month tooltip with
 * no haptic, where the same scrub on the fitness chart gives a light tick.
 *
 * Expected behaviour: the scrub fires one light impact when it starts, the
 * month under the finger is the one shown, and lifting the finger closes the
 * tooltip.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { getIntlLocale } from '@/shared/format/format';
import { getEngine } from '@/shared/native/engine';
import { capturePans, scrub, scrubPan, pressAndLift, release } from '../__shared__/chartScrub';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const WIDTH = 360;

const monthName = (index: number) =>
  new Date(2026, index, 1).toLocaleDateString(getIntlLocale(), { month: 'short' });

let client: QueryClient;
let pans: ReturnType<typeof capturePans>;

async function renderChart() {
  pans = capturePans();
  await render(
    <QueryClientProvider client={client}>
      <SeasonComparison />
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(screen.UNSAFE_getAllByType(View).some((n) => n.props.onLayout)).toBe(true)
  );
  const chart = screen.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  await act(async () => {
    await fireEvent(chart!, 'layout', { nativeEvent: { layout: { width: WIDTH, height: 200 } } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue({
    getTrainingScreenData: trainingScreenRead({
      months: () => [
        {
          year: 2026,
          month: 1,
          stats: { count: 1, totalDuration: 7200, totalDistance: 1000, totalTss: 10 },
        },
        {
          year: 2026,
          month: 12,
          stats: { count: 1, totalDuration: 3600, totalDistance: 1000, totalTss: 10 },
        },
      ],
    }),
    subscribe: () => () => {},
  } as unknown as ReturnType<typeof getEngine>);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('season comparison scrub', () => {
  it('fires one light impact when the scrub starts', async () => {
    await renderChart();

    await scrub(scrubPan(pans), 10);

    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('fires no impact for a touch lifted without moving', async () => {
    await renderChart();

    await pressAndLift(scrubPan(pans), 10, 50);

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('shows the first and last month at the chart edges and closes on release', async () => {
    await renderChart();
    const pan = scrubPan(pans);

    await scrub(pan, WIDTH - 1);
    expect(screen.getByTestId('season-tooltip').props.children).toBe(monthName(11));

    await scrub(pan, 1);
    expect(screen.getByTestId('season-tooltip').props.children).toBe(monthName(0));

    await release(pan);
    expect(screen.queryByTestId('season-tooltip')).toBeNull();
  });

  it('switches month at the boundary between two twelfths of the width', async () => {
    await renderChart();

    // March spans x 60 to 90 of 360, so 89 is still March and 91 is April.
    const pan = scrubPan(pans);
    await scrub(pan, 89);
    expect(screen.getByTestId('season-tooltip').props.children).toBe(monthName(2));

    await scrub(pan, 91);
    expect(screen.getByTestId('season-tooltip').props.children).toBe(monthName(3));
  });
});
