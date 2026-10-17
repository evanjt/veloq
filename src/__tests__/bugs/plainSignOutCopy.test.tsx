/**
 * Scenario: a signed-in athlete takes the plain sign-out, which keeps the
 * library, the profile and the sport settings on the phone and removes only
 * the session.
 *
 * Expected behaviour: the row and its confirm say "Sign out", the confirm
 * names no API credentials whatever the sign-in method, and the row is not
 * drawn in the error red that marks the delete row beside it. The account line
 * names the sign-in method in words rather than the protocol.
 */

import React from 'react';
import { Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { useAuthStore, type AuthMethod } from '@/shared/app/AuthStore';
import { colors } from '@/theme';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ cancelQueries: jest.fn(async () => {}), clear: jest.fn() }),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

let alert: jest.SpyInstance;
beforeEach(() => {
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

function iconIn(testID: string) {
  return screen
    .getByTestId(testID)
    .findAll((node) => node.type === MaterialCommunityIcons || node.type === ChromeIcon)[0];
}

describe.each<AuthMethod>(['oauth', 'apiKey'])('a %s session', (authMethod) => {
  beforeEach(() => {
    useAuthStore.setState({ authMethod, isDemoMode: false, athleteId: 'i1' });
  });

  it('confirms the plain sign-out as a sign-out that names no API credentials', async () => {
    await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />);
    const row = screen.getByTestId('settings-logout-button');
    expect(screen.queryByText(/disconnect/i)).toBeNull();

    await fireEvent.press(row);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(message).not.toMatch(/credential|API/i);
    expect(`${title}`).not.toMatch(/disconnect/i);
    const confirm = buttons?.find((b: { style?: string }) => b.style !== 'cancel');
    expect(confirm?.text).not.toMatch(/disconnect/i);
  });

  it('draws only the delete row in the error red', async () => {
    await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />);
    expect(iconIn('settings-logout-button')?.props.color).not.toBe(colors.error);
    expect(iconIn('settings-logout-clear-button')?.props.color).toBe(colors.error);
  });

  it('names the sign-in method without the protocol', async () => {
    await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />);
    expect(screen.queryByText(/OAuth/)).toBeNull();
  });
});
