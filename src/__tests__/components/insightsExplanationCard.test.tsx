/**
 * Scenario: the Insights sub-tab, with cards, with none yet, and when the
 * pipeline failed.
 *
 * Expected behaviour: the explanation card closes the panel in each of the
 * three, after the cards, the empty hint or the failure.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';

import { InsightsPanel } from '@/features/insights/components/InsightsPanel';
import type { Insight } from '@/types';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: require('@/theme').colors }),
}));
jest.mock('@/shared/app/sheetRequest', () => ({ useSheetOpener: () => jest.fn() }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes', () => ({ TodayBanner: () => null }));
jest.mock('@/features/insights/components/InsightDebugPanel', () => ({
  InsightDebugPanel: () => null,
}));
jest.mock('@/features/insights/components/InsightListCard', () => {
  const { Text } = require('react-native');
  return {
    InsightListCard: ({ insight }: { insight: { id: string } }) => <Text>{insight.id}</Text>,
  };
});

const insight = { id: 'card-one' } as unknown as Insight;

function lastChildOfScroll() {
  const panel = screen.getByTestId('insights-panel');
  const scroll = panel.children[0] as unknown as { props: { children: unknown } };
  const children = React.Children.toArray(scroll.props.children as React.ReactNode).filter(
    Boolean
  ) as React.ReactElement<{ testID?: string }>[];
  return children.at(-1);
}

describe('the Insights explanation card', () => {
  it.each([
    ['with cards', { insights: [insight] }],
    ['with none yet', { insights: [] }],
    ['after a failure', { insights: [], failed: true, onRetry: jest.fn() }],
  ])('closes the panel %s', async (_label, props) => {
    await render(<InsightsPanel {...props} />);

    const card = screen.getByTestId('insights-explanation');
    expect(within(card).getByText('insights.explanation.title')).toBeTruthy();
    expect(within(card).getByText('insights.explanation.foundLabel')).toBeTruthy();
    expect(within(card).getByText('insights.aboutBody')).toBeTruthy();
    expect(lastChildOfScroll()?.props.testID).toBe('insights-explanation');
  });
});
