/**
 * Scenario: the section page's row drew delete or remove and rematch as bare icons beside Edit
 * bounds.
 * Expected behaviour: the row keeps a labelled Edit bounds and, while a section is offered, a
 * labelled Accept; delete or remove and rematch live in the header's overflow menu, the
 * destructive row last and in the error text.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { SectionActionRow } from '@/features/routes/components/section/SectionActionRow';
import { SectionOverflowMenu } from '@/features/routes/components/section/SectionOverflowMenu';
import type { FrequentSection } from '@/types';
import { colors } from '@/theme';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

const section = (sectionType: 'custom' | 'auto', isUserDefined = false): FrequentSection =>
  ({ sectionType, isUserDefined }) as unknown as FrequentSection;

describe('SectionActionRow', () => {
  async function renderRow(target: FrequentSection) {
    const handlers = { startTrim: jest.fn(), handleAcceptSection: jest.fn() };
    await render(<SectionActionRow isDark={false} section={target} {...handlers} />);
    return handlers;
  }

  it('draws no bare delete, remove or rematch button on an auto section', async () => {
    await renderRow(section('auto'));
    for (const name of [
      'sections.deleteSection',
      'sections.removeSection',
      'sections.rematchActivities',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'sections.editBounds' })).toHaveTextContent(
      'sections.editBounds'
    );
  });

  it('offers a labelled Accept while the section is offered', async () => {
    const handlers = await renderRow(section('auto'));
    const accept = screen.getByRole('button', { name: 'sections.acceptSection' });
    expect(accept).toHaveTextContent('sections.acceptSection');
    await fireEvent.press(accept);
    expect(handlers.handleAcceptSection).toHaveBeenCalledTimes(1);
  });

  it('offers no Accept once the section is accepted', async () => {
    await renderRow(section('auto', true));
    expect(screen.queryByRole('button', { name: 'sections.acceptSection' })).toBeNull();
  });
});

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
