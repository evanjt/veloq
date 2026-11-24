/**
 * Scenario: a percent athlete opens the app onto Home and no screen that
 * reads the athlete profile has mounted.
 * Expected behaviour: the launch hook alone moves the form preference off the
 * engine's profile, so the card and the widget snapshot read percent.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { useFormPreferenceAtLaunch } from '@/shared/app/useFormPreferenceAtLaunch';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/home/lib/widgetBridge', () => ({ scheduleWidgetSnapshot: jest.fn() }));

const engine = { getAthleteProfile: jest.fn(), subscribe: jest.fn(() => () => {}) };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
  useFormPreference.getState().reset();
  useAuthStore.setState({ isAuthenticated: true });
});

it('lifts form-as-percent into the store without a screen reading the athlete', async () => {
  engine.getAthleteProfile.mockReturnValue({ id: 'i1', formAsPercent: true });
  renderHook(() => useFormPreferenceAtLaunch(), { wrapper });
  await waitFor(() => expect(useFormPreference.getState().formAsPercent).toBe(true));
});
