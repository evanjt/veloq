/**
 * Scenario: the calendar page reads the wellness of the day selected on the grid.
 *
 * Expected behaviour: the line names the date, fitness, fatigue, form and each
 * value logged, says so when none was, and selecting several days of one window
 * reads the engine once.
 */

import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage } from 'veloqrs';

import { CalendarDayReadout } from '@/features/fitness/components/CalendarDayReadout';
import { initialiseI18n } from '@/i18n';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
jest.mock('@/shared/native/useEngineChannel', () => ({ useEngineChannel: () => undefined }));

const mockGetWellnessDays = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => ({ getWellnessDays: mockGetWellnessDays }),
}));

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  useFormPreference.getState().reset();
  mockGetWellnessDays.mockReset().mockReturnValue({
    days: [
      { date: '2026-06-01', ctl: 50.4, atl: 60.2, hrv: 62, restingHr: 48, sportLoad: [] },
      { date: '2026-06-02', ctl: 51, atl: 55, sportLoad: [] },
    ],
    coverage: RangeCoverage.Loaded,
    // The engine states each day's form once, from the rounded loads.
    form: [-10, -4],
    formZone: ['greyZone', 'greyZone'],
    formText: ['-10', '-4'],
    tsbText: ['-10', '-4'],
    formAsPercent: false,
    formZoneEdges: [-30, -10, 5, 25],
  });
});

async function show(date: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (d: string | null) => (
    <QueryClientProvider client={client}>
      <CalendarDayReadout date={d} firstDay="2026-05-01" lastDay="2026-06-10" />
    </QueryClientProvider>
  );
  const view = await render(element(date));
  return { view, show: (d: string | null) => view.rerender(element(d)) };
}

const line = () => {
  const text = screen.getByTestId('calendar-day-readout').props.children;
  return Array.isArray(text) ? text.join('') : text;
};

describe('CalendarDayReadout', () => {
  it('names the load figures and the logged values of the selected day', async () => {
    await show('2026-06-01');

    expect(await screen.findByText(/Fitness 50/)).toBeTruthy();
    expect(line()).toMatch(/Fatigue 60 · Form -10 · HRV 62 · Resting HR 48$/);
  });

  it('prints the form text the engine stated under the percentage setting', async () => {
    mockGetWellnessDays.mockReturnValue({
      days: [{ date: '2026-06-01', ctl: 50.4, atl: 39.6, sportLoad: [] }],
      coverage: RangeCoverage.Loaded,
      form: [10],
      formZone: ['greyZone'],
      formText: ['+20%'],
      tsbText: ['+20%'],
      formAsPercent: false,
      formZoneEdges: [-30, -10, 5, 25],
    });
    useFormPreference.getState().setFormAsPercent(true);
    await show('2026-06-01');

    expect(await screen.findByText(/Fitness 50/)).toBeTruthy();
    expect(line()).toMatch(/Form \+20% · /);
  });

  it('prints the signed form text the engine stated otherwise', async () => {
    mockGetWellnessDays.mockReturnValue({
      days: [{ date: '2026-06-01', ctl: 50.4, atl: 39.6, sportLoad: [] }],
      coverage: RangeCoverage.Loaded,
      form: [10],
      formZone: ['greyZone'],
      formText: ['+10'],
      tsbText: ['+10'],
      formAsPercent: false,
      formZoneEdges: [-30, -10, 5, 25],
    });
    await show('2026-06-01');

    expect(await screen.findByText(/Fitness 50/)).toBeTruthy();
    expect(line()).toMatch(/Form \+10 · /);
  });

  it('says when a day has no wellness logged', async () => {
    await show('2026-06-02');

    expect(screen.queryByText(/No wellness logged/)).toBeNull();
    expect(await screen.findByText(/No wellness logged/)).toBeTruthy();
    expect(line()).toContain('Fitness 51');
  });

  it('reads the window once across several selected days', async () => {
    const { show: reselect } = await show('2026-06-01');
    await screen.findByText(/Fitness 50/);
    await reselect('2026-06-02');
    await reselect('2026-06-03');

    expect(await screen.findByText(/No wellness logged/)).toBeTruthy();
    expect(mockGetWellnessDays).toHaveBeenCalledTimes(1);
  });

  vaultIt('states nothing while no day is selected', async () => {
    await show(null);

    expect(mockGetWellnessDays).not.toHaveBeenCalledTimes(0);
    expect(screen.queryByText(/Fitness/)).toBeNull();
  });
});
