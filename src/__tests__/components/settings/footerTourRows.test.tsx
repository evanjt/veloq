/**
 * Scenario: the settings footer is the only way into the tours that does not
 * depend on a launch card, and demo mode never offers the What's New card, so
 * without a footer row the release slides cannot be opened there at all.
 *
 * Expected behaviour: "App tour" opens the tutorial and "Release notes" opens the
 * release slides, signed in or in demo mode.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { FooterSection } from '@/features/settings/components/FooterSection';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

describe.each([
  ['in demo mode', true],
  ['signed in', false],
])('the footer tour rows %s', (_label, isDemoMode) => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode });
    useWhatsNewStore.setState({ tourState: null });
  });

  it('opens the release slides from the Release notes row', async () => {
    const { getByTestId } = await render(<FooterSection />);

    await fireEvent.press(getByTestId('settings-release-notes'));

    expect(useWhatsNewStore.getState().tourState?.mode).toBe('whatsNew');
  });

  it('opens the tutorial from the App tour row', async () => {
    const { getByTestId } = await render(<FooterSection />);

    await fireEvent.press(getByTestId('settings-app-tour'));

    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');
  });

  it('names each row by its title', async () => {
    const { getByRole } = await render(<FooterSection />);

    expect(getByRole('button', { name: 't(settings.releaseNotes)' })).toBeTruthy();
    expect(getByRole('button', { name: 't(settings.appTour)' })).toBeTruthy();
  });
});
