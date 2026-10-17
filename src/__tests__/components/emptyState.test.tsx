/**
 * Scenario: a card or a chart with nothing to draw. The smallest EmptyState
 * still drew a 64 pt disc, so every card and chart hand-rolled its own line at
 * its own size, and one chart drew a title over nothing.
 *
 * Expected behaviour: the `inline` form draws no disc, its title on `bodySmall`
 * at 600 and its hint on `caption`, and its action is the small secondary
 * Button. The disc forms keep their disc.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { EmptyState } from '@/shared/ui/EmptyState';
import { typography } from '@/theme';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

describe('EmptyState inline', () => {
  it('draws no icon disc', () => {
    const screen = render(<EmptyState variant="inline" title="No laps" />);

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.queryByTestId('empty-state-icon')).toBeNull();
  });

  it('sets the title on bodySmall at 600 and the hint on caption', () => {
    const screen = render(
      <EmptyState variant="inline" title="No laps" description="Laps appear after a ride" />
    );

    const title = StyleSheet.flatten(screen.getByTestId('empty-state-title').props.style);
    expect(title.fontSize).toBe(typography.bodySmall.fontSize);
    expect(title.fontWeight).toBe('600');

    const hint = StyleSheet.flatten(screen.getByTestId('empty-state-description').props.style);
    expect(hint.fontSize).toBe(typography.caption.fontSize);
  });

  it('draws no hint when there is none', () => {
    const screen = render(<EmptyState variant="inline" title="No laps" />);

    expect(screen.queryByTestId('empty-state-description')).toBeNull();
  });

  it('offers its action and calls back on a press', () => {
    const onAction = jest.fn();
    const screen = render(
      <EmptyState variant="inline" title="No laps" actionLabel="Scan" onAction={onAction} />
    );

    fireEvent.press(screen.getByText('Scan'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('draws no action for a label with no callback', () => {
    const screen = render(<EmptyState variant="inline" title="No laps" actionLabel="Scan" />);

    expect(screen.queryByText('Scan')).toBeNull();
  });

  it('prefixes its parts with a caller testID', () => {
    const screen = render(<EmptyState variant="inline" title="No laps" testID="laps-empty" />);

    expect(screen.getByTestId('laps-empty')).toBeTruthy();
    expect(screen.getByTestId('laps-empty-title')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });
});

describe('EmptyState with a disc', () => {
  it.each(['screen', 'compact'] as const)('the %s form draws its icon disc', (variant) => {
    const screen = render(<EmptyState variant={variant} icon="map-outline" title="No maps" />);

    expect(screen.getByTestId('empty-state-icon')).toBeTruthy();
    expect(screen.getByText('No maps')).toBeTruthy();
  });

  it('refuses a press on its action while the action runs', () => {
    const onAction = jest.fn();
    const screen = render(
      <EmptyState
        variant="compact"
        icon="map-outline"
        title="No maps"
        actionLabel="Scan"
        onAction={onAction}
        actionLoading
      />
    );

    expect(screen.getByRole('button').props.accessibilityState.busy).toBe(true);
    fireEvent.press(screen.getByRole('button'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('is the screen form when no variant is named', () => {
    const screen = render(<EmptyState icon="map-outline" title="No maps" />);

    const disc = StyleSheet.flatten(screen.getByTestId('empty-state-icon').props.style);
    expect(disc.width).toBe(96);
  });
});
