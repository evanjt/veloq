/**
 * Scenario: each row in the recordings list carries a status chip whose words
 * and mark take the status colour over a tint of it. The local-only, queued
 * and failed tones kept the light palette's value in the dark theme.
 *
 * Expected behaviour: with the dark theme active, every status chip's words
 * clear 4.5:1 on the tint over the card, and its mark 3:1.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import RecordingsLibraryScreen from '@/app/recordings/index';
import { darkColors } from '@/theme';
import type { RecordingLibraryEntry, RecordingUploadStatus } from '@/types';

import { over, textCount, themed, underBar } from '../__shared__/drawnContrast';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/ui', () => {
  const { View, Text } = require('react-native');
  return {
    ScreenSafeAreaView: View,
    useBottomClearance: () => 0,
    useScrollEndInset: () => 0,
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
  };
});
jest.mock('@/features/recording/components/PermissionUpgradeBanner', () => ({
  PermissionUpgradeBanner: () => null,
}));

const STATUSES: RecordingUploadStatus[] = [
  'localOnly',
  'pending',
  'uploading',
  'uploaded',
  'failed',
  'permissionBlocked',
];

jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  useRecordingLibrary: () => ({
    entries: ['localOnly', 'pending', 'uploading', 'uploaded', 'failed', 'permissionBlocked'].map(
      (uploadStatus, i) => ({
        id: `r${i}`,
        name: `Harbour ride ${i}`,
        activityType: 'Ride',
        startTime: Date.UTC(2026, 8, 12, 6, 0, 0),
        durationSeconds: 3600,
        distanceMeters: 30000,
        createdAt: Date.UTC(2026, 8, 12, 7, 0, 0),
        uploadStatus,
        retryCount: 0,
      })
    ) as unknown as RecordingLibraryEntry[],
    isLoading: false,
    uploadingId: null,
    uploadNow: jest.fn(),
    remove: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe('the recording status chips in the dark theme', () => {
  it.each(STATUSES)('draws the %s chip clear of its bars on its tint', async (status) => {
    await render(themed(<RecordingsLibraryScreen />, true));
    const chip = screen.getByTestId(`recording-status-${status}`);
    const tint = StyleSheet.flatten(chip.props.style).backgroundColor as string;
    const ground = over(tint, darkColors.surface);

    expect(textCount(chip)).toBeGreaterThan(0);
    expect(underBar(ground, chip)).toEqual([]);
  });
});
