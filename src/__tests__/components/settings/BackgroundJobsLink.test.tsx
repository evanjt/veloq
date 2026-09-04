/**
 * Scenario: the per-job status lines stay on the screens that already carry
 * them, and each screen offers the way into the full list.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { initializeI18n, changeLanguage } from '@/i18n';
import { BackgroundJobsLink } from '@/features/settings/components/BackgroundJobsLink';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

describe('BackgroundJobsLink', () => {
  beforeAll(async () => {
    await initializeI18n('en-GB');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await changeLanguage('en-GB');
  });

  it('carries the catalogue label rather than a hard-coded one', () => {
    const tree = render(<BackgroundJobsLink />);

    expect(tree.getByText('Background jobs')).toBeTruthy();
  });

  it('opens the jobs screen', () => {
    const tree = render(<BackgroundJobsLink />);

    fireEvent.press(tree.getByTestId('background-jobs-link'));

    expect(router.push).toHaveBeenCalledWith('/background-jobs');
  });
});
