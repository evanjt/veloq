/**
 * Scenario: the iOS form sheet sizes a scroll view only when it is the first view of the sheet's
 * content, and the root stack puts every sheet route inside a shared frame.
 *
 * Expected behaviour: the chart data sheet, whose root is its scroll view, keeps that scroll view
 * first inside the frame on iOS and lists the rows it was given.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import ChartDataSheet from '@/app/sheets/chart-data';
import { rootScreenLayout } from '@/shared/ui/rootScreenLayout';
import { openSheet } from '@/shared/app/sheetRequest';
import type { ChartTable } from '@/shared/charts/chartSummary';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';

const mockPush = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const table: ChartTable = {
  title: 'Weekly hours',
  columns: ['Week', 'Hours'],
  rows: [
    { key: 'w1', cells: ['Week 1', '4.5'] },
    { key: 'w2', cells: ['Week 2', '6.0'] },
  ],
};

it('keeps its scroll view first inside the sheet frame on iOS', async () => {
  expect(Platform.OS).toBe('ios');
  void openSheet<ChartTable, never>('sheets/chart-data', table);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(
    rootScreenLayout({ route: { name: 'sheets/chart-data' }, children: <ChartDataSheet /> })
  );
  expect(sheetScrollPlacement(screen.toJSON())).toBe('root');
  expect(screen.getByText('Weekly hours')).toBeTruthy();
  expect(screen.getByText('Week 2')).toBeTruthy();
});
