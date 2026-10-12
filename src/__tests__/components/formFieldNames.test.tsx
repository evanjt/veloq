/**
 * Scenario: the backup server form, the API key sign-in, manual entry and the
 * hero rename each drew their own input, and the first two named it by
 * placeholder alone. A configured server showed three filled boxes, and a
 * screen reader read the address, then "demo, text field", then "secure text
 * field".
 *
 * Expected behaviour: every one of those fields is found by its label while it
 * holds a value, on the shared field.
 */
import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react-native';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';
import { ApiKeyLoginForm } from '@/features/auth/components/ApiKeyLoginForm';
import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import { HeroNameRow, type TextFieldHandle } from '@/shared/ui';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#18181B', textSecondary: '#52525B' } }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => ({
    url: 'https://cloud.example.org/dav/',
    username: 'keeper',
    password: 'lantern',
    plainLan: false,
  }),
  setWebdavConfig: jest.fn(async () => {}),
  clearWebdavConfig: jest.fn(async () => {}),
  testWebdavConnection: jest.fn(async () => ({ kind: 'ok' })),
  webdavUrlProblem: () => null,
}));

describe('the WebDAV server form', () => {
  it('names each stored credential by its label', async () => {
    await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);

    expect(screen.getByLabelText('backup.serverUrl').props.value).toBe(
      'https://cloud.example.org/dav/'
    );
    expect(screen.getByLabelText('backup.username').props.value).toBe('keeper');
    const password = screen.getByLabelText('backup.password');
    expect(password.props.value).toBe('lantern');
    expect(password.props.secureTextEntry).toBe(true);
  });
});

describe('the API key sign-in', () => {
  it('names the key field while it holds a key', async () => {
    await render(
      <ApiKeyLoginForm
        onLogin={jest.fn(async () => {})}
        isLoading={false}
        disabled={false}
        onOpenDeveloperSettings={jest.fn()}
        prefillApiKey="kestrel-key"
      />
    );

    const field = screen.getByLabelText('settings.authApiKey');
    expect(field.props.value).toBe('kestrel-key');
    expect(field.props.secureTextEntry).toBe(true);
  });
});

describe('manual entry', () => {
  it('names every field and finishes a number pad with Done', async () => {
    await render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);

    expect(screen.getByLabelText('recording.activityName')).toBeTruthy();
    for (const key of ['recording.duration', 'recording.distance', 'recording.avgHr']) {
      expect(screen.getByLabelText(key).props.returnKeyType).toBe('done');
    }
    expect(screen.getByLabelText('recording.notes').props.multiline).toBe(true);
  });
});

describe('the hero rename', () => {
  it('names the rename field by its label', async () => {
    await render(
      <HeroNameRow
        name="Old jetty"
        editable={{
          isEditing: true,
          editName: 'Old jetty',
          inputRef: createRef<TextFieldHandle>(),
          label: 'Section name',
          testIDPrefix: 'section',
          onStartEdit: jest.fn(),
          onSave: jest.fn(),
          onCancel: jest.fn(),
          onChange: jest.fn(),
        }}
      />
    );

    const field = screen.getByLabelText('Section name');
    expect(field.props.value).toBe('Old jetty');
    expect(field.props.keyboardAppearance).toBe('dark');
  });
});
