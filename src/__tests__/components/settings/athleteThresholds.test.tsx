/**
 * Scenario: the athlete opens the thresholds screen, sets a figure, clears it
 * and types one the engine would refuse.
 *
 * Expected behaviour: each figure shows its source, a typed number goes to the
 * engine for that sport and field, an emptied field clears the athlete's own
 * figure, a non-positive entry never reaches the engine, and the zone defaults
 * are labelled as Veloq's.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AthleteThresholds } from '@/features/settings/components/AthleteThresholds';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({ settings: {} }));

const { ThresholdField, ThresholdSource } = jest.requireActual('../../__shared__/veloqrsStub');

const mockSettings = jest.requireMock('veloqrs').settings as {
  getThresholdsScreenData: jest.Mock;
  setThresholdOverride: jest.Mock;
};

const figure = (field: number, value: number | null, source: number | null) => ({
  field,
  value,
  source,
});

function screen(ftp: ReturnType<typeof figure>) {
  return {
    sports: [
      {
        sport: 'Ride',
        figures: [
          ftp,
          figure(ThresholdField.ThresholdHr, null, null),
          figure(ThresholdField.MaxHr, null, null),
          figure(ThresholdField.RestingHr, null, null),
          figure(ThresholdField.WeightKg, null, null),
        ],
      },
    ],
    hrZoneDefaultPercents: [60, 70, 80, 90, 100],
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthleteThresholds />
    </QueryClientProvider>
  );
}

describe('AthleteThresholds', () => {
  beforeEach(() => {
    mockSettings.getThresholdsScreenData = jest.fn(() =>
      screen(figure(ThresholdField.Ftp, 240, ThresholdSource.File))
    );
    mockSettings.setThresholdOverride = jest.fn();
  });

  it('names the source of a figure and labels the zone bounds as the defaults', async () => {
    const { findByText, getByTestId } = renderScreen();
    await findByText('thresholds.source.file');
    expect(getByTestId('threshold-zone-defaults')).toBeTruthy();
  });

  it('sends a typed figure to the engine for the sport and field', async () => {
    const { findByTestId } = renderScreen();
    const input = await findByTestId('threshold-Ride-Ftp');
    fireEvent.changeText(input, '265');
    fireEvent(input, 'blur');
    await waitFor(() =>
      expect(mockSettings.setThresholdOverride).toHaveBeenCalledWith(
        'Ride',
        ThresholdField.Ftp,
        265
      )
    );
  });

  it('clears the figure the athlete set when the field is emptied', async () => {
    mockSettings.getThresholdsScreenData = jest.fn(() =>
      screen(figure(ThresholdField.Ftp, 265, ThresholdSource.Athlete))
    );
    const { findByTestId } = renderScreen();
    const input = await findByTestId('threshold-Ride-Ftp');
    fireEvent.changeText(input, '');
    fireEvent(input, 'blur');
    await waitFor(() =>
      expect(mockSettings.setThresholdOverride).toHaveBeenCalledWith(
        'Ride',
        ThresholdField.Ftp,
        null
      )
    );
  });

  it('refuses a non-positive figure without calling the engine', async () => {
    const { findByTestId, findByText } = renderScreen();
    const input = await findByTestId('threshold-Ride-Ftp');
    fireEvent.changeText(input, '0');
    fireEvent(input, 'blur');
    await findByText('thresholds.invalid');
    expect(mockSettings.setThresholdOverride).not.toHaveBeenCalled();
  });
});
