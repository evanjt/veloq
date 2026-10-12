/**
 * Scenario: a press that leaves for a web page was announced as a button on
 * some rows and as a link on others, and opened in the system browser on some
 * and the in-app browser on others.
 *
 * Expected behaviour: every row and line that opens a web page is announced
 * as a link and opens it in the in-app browser.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { ExternalLinkRow } from '@/shared/ui';
import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import { SupportSection } from '@/features/settings/components/SupportSection';
import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import AboutScreen from '@/app/about';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(async () => undefined),
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ cancelQueries: jest.fn(async () => {}), clear: jest.fn() }),
}));

const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;
let openURL: jest.SpyInstance;

beforeEach(() => {
  openBrowser.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => openURL.mockRestore());

async function expectInAppLink(
  tree: Awaited<ReturnType<typeof render>>,
  name: string,
  url: string | RegExp
) {
  const link = tree.getByRole('link', { name });
  expect(tree.getAllByRole('link', { name })).toHaveLength(1);
  await fireEvent.press(link);
  expect(openBrowser).toHaveBeenLastCalledWith(
    typeof url === 'string' ? url : expect.stringMatching(url)
  );
  expect(openURL).not.toHaveBeenCalled();
}

describe('ExternalLinkRow', () => {
  it('is a full-height link with the open-in-new glyph and no chevron', async () => {
    const tree = await render(
      <ExternalLinkRow url="https://example.org" label="Example" testID="external" />
    );
    expect(tree.queryByRole('button')).toBeNull();
    expect(tree.UNSAFE_queryAllByProps({ name: 'open-in-new' })).toHaveLength(1);
    expect(tree.queryByTestId('row-chevron')).toBeNull();
    await expectInAppLink(tree, 'Example', 'https://example.org');
  });
});

describe('external links on settings', () => {
  it('announces the subscription row of Support as a link', async () => {
    await expectInAppLink(
      await render(<SupportSection />),
      'settings.subscribe',
      /^https:\/\/intervals\.icu\/settings\/subscription$/
    );
  });

  it('announces the profile row as a link to the athlete page', async () => {
    useAuthStore.setState({ authMethod: 'apiKey' });
    await expectInAppLink(
      await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />),
      'Rider',
      /^https:\/\/intervals\.icu\/athlete\//
    );
  });

  it('announces the notification privacy line as a link', async () => {
    useAuthStore.setState({ authMethod: 'oauth', isDemoMode: false });
    useNotificationPreferences.setState({ isLoaded: true });
    await expectInAppLink(
      await render(<NotificationSection />),
      'notifications.settings.privacyHint',
      /^https:\/\/veloq\.fit\/privacy$/
    );
  });

  it('opens the About links in the in-app browser', async () => {
    await expectInAppLink(
      await render(<AboutScreen />),
      'about.veloqPrivacy',
      /^https:\/\/veloq\.fit\/privacy$/
    );
  });
});
