import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { getEngine } from '@/shared/native/engine';
import { darkColors } from '@/theme';
import { capturePans, scrub, scrubPan } from '../__shared__/chartScrub';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: true }) }));

afterEach(() => jest.restoreAllMocks());

it('draws the season summary with a visible dark region tint', async () => {
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue({
    getTrainingScreenData: trainingScreenRead({
      months: () => [
        {
          year: 2026,
          month: 1,
          stats: { count: 1, totalDuration: 3600, totalDistance: 40000, totalTss: 50 },
        },
      ],
    }),
    subscribe: () => () => {},
  } as unknown as ReturnType<typeof getEngine>);
  const built = capturePans();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <SeasonComparison />
    </QueryClientProvider>
  );

  await waitFor(() => {
    const summary = screen
      .UNSAFE_getAllByType(View)
      .find((view) => StyleSheet.flatten(view.props.style)?.minHeight === 44);
    expect(StyleSheet.flatten(summary?.props.style)?.backgroundColor).toBe(darkColors.stateHover);
  });

  const chart = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  await act(async () => {
    await fireEvent(chart!, 'layout', { nativeEvent: { layout: { width: 360, height: 200 } } });
  });
  await scrub(scrubPan(built), 10);
  const selected = screen
    .UNSAFE_getAllByType(View)
    .find((node) => StyleSheet.flatten(node.props.style)?.minHeight === 44);
  expect(StyleSheet.flatten(selected?.props.style)?.backgroundColor).toBe(darkColors.statePressed);
  await view.unmount();
  client.clear();
});
