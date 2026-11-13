/**
 * Scenario: an athlete logs a session by hand and types into the notes, the last field, with the
 * Continue button under it.
 *
 * Expected behaviour: every field and the button sit on the screen scroll view that clears the
 * keyboard, and a tap on Continue with the keyboard up reaches the button. The form pads its own
 * bottom edge, so the system adds no content inset to it.
 */

import { render, within } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import { ScreenScrollView } from '@/shared/ui/ScreenScrollView';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

it('keeps every field and Continue on the scroll view that clears the keyboard', async () => {
  const view = await render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);
  const scroll = within(view.UNSAFE_getByType(ScreenScrollView));

  for (const id of [
    'manual-entry-name',
    'manual-entry-duration',
    'manual-entry-notes',
    'manual-entry-continue',
  ]) {
    expect(scroll.getByTestId(id)).toBeTruthy();
  }
  const props = view.UNSAFE_getByType(ScrollView).props;
  expect(props.keyboardShouldPersistTaps).toBe('handled');
  expect(props.contentInsetAdjustmentBehavior).toBe('never');
});
