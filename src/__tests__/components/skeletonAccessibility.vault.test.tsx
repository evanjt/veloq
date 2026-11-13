/**
 * Scenario: a screen reader moves through a screen whose content is still
 * loading behind skeletons.
 * Expected behaviour: each skeleton is one busy progress element that says it
 * is loading, and none of its grey blocks is a focus stop of its own.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ActivityCardSkeleton, ChartSkeleton } from '@/shared/ui/Shimmer';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

function descendants(node: ReactTestInstance): ReactTestInstance[] {
  return node.children.flatMap((child) =>
    typeof child === 'string' ? [] : [child, ...descendants(child)]
  );
}

it.each([
  ['chart', <ChartSkeleton key="chart" />],
  ['activity card', <ActivityCardSkeleton key="card" />],
])('the %s skeleton is one busy progress element', async (_name, element) => {
  await render(element);

  const root = screen.getByRole('progressbar');
  expect(root.props.accessibilityLabel).toBe('common.loading');
  expect(root.props.accessibilityState).toEqual({ busy: true });
  expect(root.props.importantForAccessibility).toBeUndefined();
  const blocks = root.children.filter((child) => typeof child !== 'string');
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(block.props.accessibilityElementsHidden).toBe(true);
  }
  expect(
    descendants(root).filter(
      (node) => node.props.accessible === true || node.props.accessibilityRole !== undefined
    )
  ).toHaveLength(0);
});
