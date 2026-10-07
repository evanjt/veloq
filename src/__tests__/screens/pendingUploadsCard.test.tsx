/**
 * Scenario: the only unuploaded ride on the phone is another athlete's held
 * ride, and the signed-in athlete opens the home screen.
 * Expected behaviour: the card reads the visible count and hides when it is
 * zero, so it never points at rides the athlete cannot open.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

import { PendingUploadsCard } from '@/features/recording/components/PendingUploadsCard';
import { getVisibleUnuploadedCount } from '@/features/recording/lib/storage/recordingLibrary';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (_key: string, _default: string, options?: { count: number }) =>
      `${options?.count} not uploaded`,
  }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: (effect: () => void | (() => void)) => {
    require('react').useEffect(effect, [effect]);
  },
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  getVisibleUnuploadedCount: jest.fn(),
}));

const mockCount = getVisibleUnuploadedCount as jest.Mock;

it("hides when the only unuploaded ride is another athlete's", async () => {
  mockCount.mockResolvedValue(0);
  render(<PendingUploadsCard />);
  await waitFor(() => expect(mockCount).toHaveBeenCalled());
  expect(screen.queryByTestId('pending-uploads-card')).toBeNull();
});

it("shows the signed-in athlete's own count", async () => {
  mockCount.mockResolvedValue(2);
  render(<PendingUploadsCard />);
  expect(await screen.findByText('2 not uploaded')).toBeTruthy();
});
