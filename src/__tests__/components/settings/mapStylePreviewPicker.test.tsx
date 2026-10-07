import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MapStylePreviewPicker } from '@/features/settings/components/MapStylePreviewPicker';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

it('announces the selected map style and lets another style be chosen', () => {
  const onValueChange = jest.fn();
  render(<MapStylePreviewPicker value="dark" onValueChange={onValueChange} />);

  expect(
    screen.getByRole('button', { name: 'settings.dark' }).props.accessibilityState.selected
  ).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'settings.satellite' }));
  expect(onValueChange).toHaveBeenCalledWith('satellite');
});
