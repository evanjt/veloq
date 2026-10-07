/**
 * Scenario: the Today banner sat inside a Pressable whose only handler is a
 * development-only long press, so a release tap faded it and did nothing.
 *
 * Expected behaviour: outside development the banner has no touchable ancestor.
 */

import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { render, screen } from '@testing-library/react-native';

import { InsightsPanel } from '@/features/insights/components/InsightsPanel';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/features/routes/components/TodayBanner', () => ({
  TodayBanner: () =>
    require('react').createElement(require('react-native').View, { testID: 'banner' }),
}));
jest.mock('@/features/insights/components/InsightDetailSheet', () => ({
  InsightDetailSheet: () => null,
}));
jest.mock('@/features/insights/components/InsightDebugPanel', () => ({
  InsightDebugPanel: () => null,
}));

const hasTouchableAncestor = (node: ReactTestInstance): boolean => {
  for (let n: ReactTestInstance | null = node.parent; n; n = n.parent) {
    if (n.props && typeof n.props.onResponderGrant === 'function') return true;
  }
  return false;
};

describe('the Today banner press target', () => {
  const original = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
  afterEach(() => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = original;
  });

  it('is not touchable in a release build', () => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    render(<InsightsPanel insights={[]} />);
    expect(hasTouchableAncestor(screen.getByTestId('banner'))).toBe(false);
  });

  it('keeps the debug long press in development', () => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
    render(<InsightsPanel insights={[]} />);
    expect(hasTouchableAncestor(screen.getByTestId('banner'))).toBe(true);
  });
});
