/**
 * Scenario: the section page held a row under the map for Edit bounds alone, with delete or
 * remove and rematch as bare icons beside it.
 * Expected behaviour: the header's overflow menu holds Edit bounds first when the section has a
 * line, then rematch, then delete or remove, the destructive row last and in the error text.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { SectionOverflowMenu } from '@/features/routes/components/section/SectionOverflowMenu';
import { colors } from '@/theme';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

describe('SectionOverflowMenu', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function openMenu(over: Partial<React.ComponentProps<typeof SectionOverflowMenu>> = {}) {
    const handlers = {
      onDelete: jest.fn(),
      onToggleDisable: jest.fn(),
      onRematch: jest.fn(),
    };
    await render(
      <PaperProvider>
        <SectionOverflowMenu
          sectionType="auto"
          isSectionDisabled={false}
          isRematching={false}
          isRematchHeld={false}
          tint={colors.textPrimary}
          {...handlers}
          {...over}
        />
      </PaperProvider>
    );
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'activity.moreActions' }));
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    return handlers;
  }

  function rows() {
    return screen.getAllByRole('menuitem').map((row) => row.props.accessibilityLabel as string);
  }

  function labelColour(name: string) {
    const label = within(screen.getByRole('menuitem', { name })).getByText(name);
    return StyleSheet.flatten(label.props.style).color;
  }

  it('holds rematch and remove on an auto section, remove last and destructive', async () => {
    const handlers = await openMenu();
    expect(rows()).toEqual(['sections.rematchActivities', 'sections.removeSection']);
    expect(labelColour('sections.removeSection')).toBe(colors.errorText);
    expect(labelColour('sections.rematchActivities')).toBe(colors.textPrimary);

    await fireEvent.press(screen.getByRole('menuitem', { name: 'sections.rematchActivities' }));
    expect(handlers.onRematch).toHaveBeenCalledTimes(1);
  });

  it('removes an auto section from the menu', async () => {
    const handlers = await openMenu();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'sections.removeSection' }));
    expect(handlers.onToggleDisable).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it('deletes a custom section from the menu', async () => {
    const handlers = await openMenu({ sectionType: 'custom' });
    expect(rows()).toEqual(['sections.rematchActivities', 'sections.deleteSection']);
    await fireEvent.press(screen.getByRole('menuitem', { name: 'sections.deleteSection' }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleDisable).not.toHaveBeenCalled();
  });

  it('lists Edit bounds first and enters the tool from it', async () => {
    const onEditBounds = jest.fn();
    await openMenu({ onEditBounds });
    expect(rows()).toEqual([
      'sections.editBounds',
      'sections.rematchActivities',
      'sections.removeSection',
    ]);
    expect(labelColour('sections.editBounds')).toBe(colors.textPrimary);

    await fireEvent.press(screen.getByRole('menuitem', { name: 'sections.editBounds' }));
    expect(onEditBounds).toHaveBeenCalledTimes(1);
  });

  it('lists no Edit bounds with no handler, as for a section with no line', async () => {
    await openMenu({ onEditBounds: undefined });
    expect(rows()).not.toContain('sections.editBounds');
  });

  it('restores a removed section, which is not destructive', async () => {
    await openMenu({ isSectionDisabled: true });
    expect(rows()).toContain('sections.restoreSection');
    expect(labelColour('sections.restoreSection')).toBe(colors.textPrimary);
  });

  it('leaves rematch out while one runs, while detection is held, or with no handler', async () => {
    await openMenu({ isRematching: true });
    expect(rows()).toEqual(['sections.removeSection']);
    await screen.unmount();

    await openMenu({ isRematchHeld: true });
    expect(rows()).toEqual(['sections.removeSection']);
    await screen.unmount();

    await openMenu({ onRematch: undefined });
    expect(rows()).toEqual(['sections.removeSection']);
  });
});
