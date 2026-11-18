/**
 * Scenario: the section page's overflow menu carries the send-to-watch action.
 * Expected behaviour: the row is present only when the page passes a handler, and pressing it calls
 * that handler once.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { SectionOverflowMenu } from '@/features/routes/components/section/SectionOverflowMenu';
import { colors } from '@/theme';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

async function openMenu(onSendToWatch?: () => void) {
  await render(
    <PaperProvider>
      <SectionOverflowMenu
        sectionType="custom"
        isSectionDisabled={false}
        isRematching={false}
        isRematchHeld={false}
        tint={colors.textPrimary}
        onDelete={jest.fn()}
        onToggleDisable={jest.fn()}
        onSendToWatch={onSendToWatch}
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
}

describe('SectionOverflowMenu send to watch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls the handler once when the row is pressed', async () => {
    const onSendToWatch = jest.fn();
    await openMenu(onSendToWatch);

    await fireEvent.press(screen.getByRole('menuitem', { name: 'sections.sendToWatch' }));

    expect(onSendToWatch).toHaveBeenCalledTimes(1);
  });

  it('has no row without a handler', async () => {
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: 'sections.sendToWatch' })).toBeNull();
  });
});
