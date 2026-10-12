/**
 * Scenario: an athlete restores onto a new phone, or signs in with an API key
 * kept in a password manager.
 *
 * Expected behaviour: every credential field declares its purpose to both
 * platforms' autofill, so the server, username and password are offered and
 * stored as one login. A secret field can be revealed to check a paste before
 * it is sent, and return on the key field connects.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';
import { ApiKeyLoginForm } from '@/features/auth/components/ApiKeyLoginForm';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => ({
    url: 'https://files.example.org/remote.php/dav',
    username: 'heron',
    password: 'reed-marsh-wader',
  }),
  setWebdavConfig: jest.fn(),
  clearWebdavConfig: jest.fn(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));

describe('the WebDAV form', () => {
  it('declares the server, username and password to autofill on both platforms', async () => {
    await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);

    const url = screen.getByTestId('backup-webdav-url');
    expect(url.props.textContentType).toBe('URL');
    expect(url.props.autoComplete).toBe('url');

    const username = screen.getByTestId('backup-webdav-username');
    expect(username.props.textContentType).toBe('username');
    expect(username.props.autoComplete).toBe('username');

    const password = screen.getByTestId('backup-webdav-password');
    expect(password.props.textContentType).toBe('password');
    expect(password.props.autoComplete).toBe('current-password');
  });

  it('reveals the password and hides it again', async () => {
    await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
    expect(screen.getByTestId('backup-webdav-password').props.secureTextEntry).toBe(true);

    const toggle = screen.getByTestId('backup-webdav-password-reveal');
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('common.showPassword');
    expect(toggle.props.accessibilityState).toMatchObject({ selected: false });

    await fireEvent.press(toggle);
    expect(screen.getByTestId('backup-webdav-password').props.secureTextEntry).toBe(false);
    const shown = screen.getByTestId('backup-webdav-password-reveal');
    expect(shown.props.accessibilityLabel).toBe('common.hidePassword');
    expect(shown.props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(shown);
    expect(screen.getByTestId('backup-webdav-password').props.secureTextEntry).toBe(true);
  });
});

describe('the API key form', () => {
  async function renderOpen(onLogin = jest.fn(async () => {})) {
    await render(
      <ApiKeyLoginForm
        onLogin={onLogin}
        isLoading={false}
        disabled={false}
        onOpenDeveloperSettings={jest.fn()}
        prefillApiKey="kestrel-key"
      />
    );
    return onLogin;
  }

  it('declares the key as a password so a manager can store and refill it', async () => {
    await renderOpen();
    const input = screen.getByTestId('login-apikey-input');
    expect(input.props.textContentType).toBe('password');
    expect(input.props.autoComplete).toBe('password');
  });

  it('reveals the key so a paste can be checked before connecting', async () => {
    await renderOpen();
    expect(screen.getByTestId('login-apikey-input').props.secureTextEntry).toBe(true);

    const toggle = screen.getByTestId('login-apikey-input-reveal');
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('common.showPassword');
    expect(toggle.props.accessibilityState).toMatchObject({ selected: false });

    await fireEvent.press(toggle);
    expect(screen.getByTestId('login-apikey-input').props.secureTextEntry).toBe(false);
    const shown = screen.getByTestId('login-apikey-input-reveal');
    expect(shown.props.accessibilityLabel).toBe('common.hidePassword');
    expect(shown.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('connects from the return key', async () => {
    const onLogin = await renderOpen();
    const input = screen.getByTestId('login-apikey-input');
    expect(input.props.returnKeyType).toBe('go');

    await fireEvent(input, 'submitEditing');

    expect(onLogin).toHaveBeenCalledWith('kestrel-key');
  });

  it('does not connect from return with an empty field, as the button does not', async () => {
    const onLogin = await renderOpen();
    await fireEvent.changeText(screen.getByTestId('login-apikey-input'), '   ');

    await fireEvent(screen.getByTestId('login-apikey-input'), 'submitEditing');

    expect(onLogin).not.toHaveBeenCalled();
  });
});
