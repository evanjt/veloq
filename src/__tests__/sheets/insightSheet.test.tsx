import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import InsightSheet from '@/app/sheets/insight';
import { InsightsPanel } from '@/features/insights/components/InsightsPanel';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';
import { initialiseI18n } from '@/i18n';
import type { Insight } from '@/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();
const mockOrder: string[] = [];
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    canGoBack: () => true,
    back: () => {
      mockOrder.push('dismiss');
      mockBack();
    },
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app/navigation', () => ({
  tapTo: (target: unknown) => {
    mockOrder.push('navigate');
    mockNavigate(target);
  },
  goBack: jest.requireActual('@/shared/app/navigation').goBack,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/features/routes', () => ({ TodayBanner: () => null }));
jest.mock('@/features/insights/components/InsightDebugPanel', () => ({
  InsightDebugPanel: () => null,
}));
jest.mock('@/features/insights/components/InsightListCard', () => ({
  InsightListCard: ({
    insight,
    onPress,
  }: {
    insight: Insight;
    onPress: (value: Insight) => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID={`insight-card-${insight.id}`} onPress={() => onPress(insight)}>
        <Text>{insight.title}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@/features/insights/components/content/InsightDetailContent', () => ({
  InsightDetailContent: () => null,
}));

const insight = (id: string, title: string): Insight =>
  ({
    id,
    title,
    category: 'section_changed',
    priority: 1,
    icon: 'history',
    iconTone: 'info',
    timestamp: 0,
    isNew: false,
    navigationTarget: `/section/${id}`,
  }) as Insight;

beforeAll(async () => initialiseI18n('en-GB'));
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockNavigate.mockClear();
  mockOrder.length = 0;
});

it('opens the tapped insight in a route and dismisses before opening its detail', async () => {
  await render(
    <InsightsPanel insights={[insight('one', 'First climb'), insight('two', 'Second climb')]} />
  );
  await fireEvent.press(screen.getByTestId('insight-card-two'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: 'sheets/insight',
    params: { request: expect.any(String) },
  });
  mockParams = { request: mockPush.mock.calls[0][0].params.request };
  await render(<InsightSheet />);
  const sheet = within(screen.getByTestId('insight-detail-sheet'));
  expect(sheet.getByText('Second climb')).toBeTruthy();
  expect(sheet.queryByText('First climb')).toBeNull();

  expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');

  await fireEvent.press(sheet.getByTestId('methodology-toggle'));
  await fireEvent.press(sheet.getByTestId('insight-data-link'));
  expect(mockOrder).toEqual(['dismiss', 'navigate']);
  expect(mockNavigate).toHaveBeenCalledWith('/section/two');
});
