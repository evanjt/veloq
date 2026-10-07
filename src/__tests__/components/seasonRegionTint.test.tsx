import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { getEngine } from '@/shared/native/engine';
import { darkColors } from '@/theme';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

let mockOnStart: ((event: { x: number }) => void) | undefined;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('react-native-gesture-handler', () => {
  const pan = {
    activateAfterLongPress: () => pan,
    minDistance: () => pan,
    onStart: (callback: (event: { x: number }) => void) => {
      mockOnStart = callback;
      return pan;
    },
    onUpdate: () => pan,
    onEnd: () => pan,
    onFinalize: () => pan,
  };
  return {
    ...jest.requireActual('react-native-gesture-handler'),
    Gesture: { Pan: () => pan },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SeasonComparison />
    </QueryClientProvider>
  );

  await waitFor(() => {
    const summary = screen
      .UNSAFE_getAllByType(View)
      .find((view) => StyleSheet.flatten(view.props.style)?.minHeight === 44);
    expect(StyleSheet.flatten(summary?.props.style)?.backgroundColor).toBe(
      darkColors.regionTintIdle
    );
  });

  await act(async () => {
    mockOnStart?.({ x: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const selected = screen
    .UNSAFE_getAllByType(View)
    .find((node) => StyleSheet.flatten(node.props.style)?.minHeight === 44);
  expect(StyleSheet.flatten(selected?.props.style)?.backgroundColor).toBe(
    darkColors.regionTintActive
  );
  view.unmount();
  client.clear();
});
