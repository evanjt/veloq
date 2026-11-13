/**
 * Scenario: the notification switch and both account badges read the auth
 * state to say which source the athlete is signed in to.
 *
 * Expected behaviour: each says what it said before those reads shared one
 * owner, including the two badges' disagreement over a session with no
 * method: the hub row says Demo while the profile says `intervals.icu · `.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import { useAuthStore, type AuthMethod } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ cancelQueries: jest.fn(async () => {}), clear: jest.fn() }),
}));

const exact = { normalizer: (text: string) => text };

beforeEach(() => {
  useNotificationPreferences.setState({ enabled: false, isLoaded: true });
});

describe.each<[AuthMethod, boolean, boolean, string]>([
  ['oauth', false, true, 'settings.authOAuth'],
  ['apiKey', false, false, 'intervals.icu · settings.authApiKey'],
  ['demo', true, false, 'settings.authDemo'],
  [null, false, false, 'intervals.icu · '],
  ['oauth', true, false, 'settings.authOAuth'],
])('%s, demo flag %s', (authMethod, isDemoMode, toggleEnabled, profileBadge) => {
  beforeEach(() => {
    useAuthStore.setState({ authMethod, isDemoMode, athleteId: 'i1' });
  });

  it('enables the notification switch only for a live OAuth session', async () => {
    const tree = await render(<NotificationSection />);
    const toggle = tree.getByTestId('settings-notifications-toggle');
    if (toggleEnabled) expect(toggle).toBeEnabled();
    else expect(toggle).toBeDisabled();
  });

  it('badges the profile with the source and the scheme', async () => {
    const tree = await render(<ProfileAccountSection athlete={{ name: 'Rider' }} />);
    expect(tree.getByText(profileBadge, exact)).toBeTruthy();
  });
});
