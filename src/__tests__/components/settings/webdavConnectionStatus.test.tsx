/**
 * Scenario: the WebDAV connection test reported its outcome as text in the
 * button row, which a screen reader never heard.
 *
 * Expected behaviour: the outcome is a status message, spoken through a polite
 * live region on Android and an announcement on iOS, success and failure alike.
 */

import { AccessibilityInfo, Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';

const mockTest = jest.fn();

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => ({
    url: 'https://files.example.org/dav/',
    username: 'keeper',
    password: 'lighthouse',
    plainLan: false,
  }),
  setWebdavConfig: jest.fn(async () => {}),
  clearWebdavConfig: jest.fn(async () => {}),
  testWebdavConnection: () => mockTest(),
  webdavUrlProblem: () => null,
}));

const originalOS = Platform.OS;
let announce: jest.SpyInstance;

beforeEach(() => {
  mockTest.mockReset();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = originalOS;
  announce.mockRestore();
});

function liveRegionOf(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (at.props.accessibilityLiveRegion) return at.props.accessibilityLiveRegion;
  }
  return undefined;
}

it('speaks a successful connection test on Android', async () => {
  Platform.OS = 'android';
  mockTest.mockResolvedValue({ kind: 'ok' });
  render(<WebdavConfigForm onConfigChange={() => {}} onRemoved={() => {}} />);
  fireEvent.press(screen.getByText('backup.testConnection'));

  const result = await screen.findByText('backup.connectionSuccess');
  expect(liveRegionOf(result)).toBe('polite');
});

it('announces a failed connection test on iOS', async () => {
  Platform.OS = 'ios';
  mockTest.mockResolvedValue({ kind: 'unreachable' });
  render(<WebdavConfigForm onConfigChange={() => {}} onRemoved={() => {}} />);
  fireEvent.press(screen.getByText('backup.testConnection'));

  await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
  const spoken = announce.mock.calls[0][0] as string;
  expect(spoken.length).toBeGreaterThan(0);
  expect(liveRegionOf(screen.getByText(spoken))).toBe('polite');
});
