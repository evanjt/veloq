/**
 * Scenario: the pager lays every page side by side in one translated row, so a
 * page out of view is still on screen as far as the accessibility tree knows.
 * A screen reader swiping past the last element of one tab walks into the next
 * tab's content.
 *
 * Expected behaviour: only the active page is in the accessibility tree, and a
 * tab change moves that with it.
 */

import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SwipeableTabs } from '@/shared/ui';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const TABS = [
  { key: 'kettle', label: 'Kettle', icon: 'cup' as const },
  { key: 'teapot', label: 'Teapot', icon: 'kettle' as const },
  { key: 'saucer', label: 'Saucer', icon: 'circle-outline' as const },
];

function pager(activeTab: string, lazy = false) {
  return (
    <SwipeableTabs
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={jest.fn()}
      isDark={false}
      lazy={lazy}
    >
      <Text>boiling water</Text>
      <Text>steeping leaves</Text>
      <Text>catching drips</Text>
    </SwipeableTabs>
  );
}

const visible = { includeHiddenElements: false } as const;

describe('the pager and the accessibility tree', () => {
  it('exposes the active page and hides the pages either side of it', () => {
    render(pager('teapot'));

    expect(screen.getByText('steeping leaves', visible)).toBeTruthy();
    expect(screen.queryByText('boiling water', visible)).toBeNull();
    expect(screen.queryByText('catching drips', visible)).toBeNull();
    // Hidden, not unmounted: a visited page keeps its state.
    expect(screen.getByText('catching drips', { includeHiddenElements: true })).toBeTruthy();
  });

  it('moves the exposed page with the active tab', () => {
    render(pager('teapot'));
    screen.rerender(pager('saucer'));

    expect(screen.getByText('catching drips', visible)).toBeTruthy();
    expect(screen.queryByText('steeping leaves', visible)).toBeNull();
  });

  it('hides a visited page that is out of view on a lazy pager', () => {
    render(pager('kettle', true));
    screen.rerender(pager('teapot', true));

    expect(screen.getByText('steeping leaves', visible)).toBeTruthy();
    expect(screen.queryByText('boiling water', visible)).toBeNull();
    expect(screen.queryByText('catching drips', { includeHiddenElements: true })).toBeNull();
  });

  it('mounts only the page a lazy pager opens on, not the first page as well', () => {
    render(pager('saucer', true));

    expect(screen.getByText('catching drips', visible)).toBeTruthy();
    expect(screen.queryByText('boiling water', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('steeping leaves', { includeHiddenElements: true })).toBeNull();
  });

  it('leaves the tab strip itself in the tree', () => {
    render(pager('teapot'));

    expect(screen.getAllByRole('tab', visible)).toHaveLength(3);
  });
});
