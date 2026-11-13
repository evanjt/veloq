/**
 * Scenario: About named the project and its licence but not the terms the
 * sign-in and notification service runs on, so an athlete could not tell from
 * the app that purchases fund development or that the service is best effort.
 *
 * Expected behaviour: About carries a terms section whose text comes from the
 * translation keys, below the disclaimer, and a link that opens the website's
 * terms page through the one terms URL.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import AboutScreen from '@/app/about';
import { openExternal } from '@/shared/app/openExternal';
import { VELOQ_TERMS_URL } from '@/shared/app/supportLinks';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/openExternal', () => ({ openExternal: jest.fn() }));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

describe('the About terms section', () => {
  it('renders the terms text from its translation key under a terms heading', async () => {
    const { getByText } = await render(<AboutScreen />);
    expect(getByText('about.termsTitle')).toBeTruthy();
    expect(getByText('about.terms')).toBeTruthy();
  });

  it('opens the website terms page through the one terms URL', async () => {
    const { getByTestId } = await render(<AboutScreen />);
    fireEvent.press(getByTestId('about-link-veloq-terms'));
    expect(openExternal).toHaveBeenCalledWith(VELOQ_TERMS_URL);
  });
});
