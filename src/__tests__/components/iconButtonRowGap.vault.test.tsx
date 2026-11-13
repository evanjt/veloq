/**
 * Scenario: a row draws two icon-only buttons next to each other.
 *
 * Expected behaviour: the row's gap keeps their drawn edges at least
 * `spacing.sm` apart and is at least the slop each lends the other, read off
 * the buttons as they render, so their hit areas never overlap.
 */

import React, { createRef } from 'react';
import type { TextInstance } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { MapPopup } from '@/features/maps/components/regional/MapPopup';
import { spacing } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

// The host view of a pressable carries its resolved style and its hit slop.
function hostOf(node: ReactTestInstance): ReactTestInstance {
  let current: ReactTestInstance | null = node;
  while (current && current.props.hitSlop === undefined) current = current.parent;
  if (!current) throw new Error('no pressable host');
  return current;
}

// The nearest view holding both, the row whose gap separates them.
function rowOf(a: ReactTestInstance, b: ReactTestInstance): ReactTestInstance {
  const ancestors = new Set<ReactTestInstance>();
  for (let n: ReactTestInstance | null = a; n; n = n.parent) ancestors.add(n);
  for (let n: ReactTestInstance | null = b; n; n = n.parent) {
    if (ancestors.has(n) && typeof n.type === 'string') return n;
  }
  throw new Error('no shared row');
}

function expectApart(a: ReactTestInstance, b: ReactTestInstance) {
  const left = hostOf(a);
  const right = hostOf(b);
  const gap = Number(flatten(rowOf(left, right).props.style).gap ?? 0);
  expect(gap).toBeGreaterThanOrEqual(spacing.sm);
  expect(gap).toBeGreaterThanOrEqual(left.props.hitSlop.right + right.props.hitSlop.left);
}

describe('icon button rows', () => {
  it('keeps the map popup zoom and close buttons apart', async () => {
    await render(
      <MapPopup
        testID="popup"
        titleTestID="popup-title"
        closeTestID="popup-close"
        titleRef={createRef<TextInstance>()}
        title="Harbour loop"
        stats={[]}
        closeLabel="Close"
        onClose={jest.fn()}
        zoom={{ testID: 'popup-zoom', onPress: jest.fn(), label: 'Zoom' }}
      />
    );
    expectApart(screen.getByTestId('popup-zoom'), screen.getByTestId('popup-close'));
  });
});
