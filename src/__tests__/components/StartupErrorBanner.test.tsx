/**
 * Scenario: an initialiser rejects at launch and the banner names the part that failed.
 *
 * Expected behaviour: the copy comes from the locale files, nothing spins, each
 * failed area is named, and the athlete can dismiss it.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { StartupErrorBanner } from '@/shared/ui/StartupErrorBanner';
import de from '@/i18n/locales/de-DE.json';

const mockT = jest.fn((key: string, options?: { defaultValue?: string; areas?: string }) =>
  key === 'emptyState.startupError.detail' ? `detail:${options?.areas}` : `t:${key}`
);

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: mockT }),
}));

describe('StartupErrorBanner', () => {
  it('takes every line from the translator and names each failed area', () => {
    const { getByText } = render(
      <StartupErrorBanner areas={['heartRateZones', 'maps']} onDismiss={() => {}} />
    );
    expect(getByText('t:emptyState.startupError.title')).toBeTruthy();
    expect(
      getByText(
        'detail:t:emptyState.startupError.area.heartRateZones, t:emptyState.startupError.area.maps'
      )
    ).toBeTruthy();
  });

  it('renders no spinner', () => {
    const { queryByRole } = render(<StartupErrorBanner areas={['other']} onDismiss={() => {}} />);
    expect(queryByRole('progressbar')).toBeNull();
  });

  it('calls onDismiss from the dismiss button', () => {
    const onDismiss = jest.fn();
    const { getByText } = render(<StartupErrorBanner areas={['other']} onDismiss={onDismiss} />);
    fireEvent.press(getByText('t:emptyState.startupError.dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has a German line for every area it can name', () => {
    expect(Object.keys(de.emptyState.startupError.area).sort()).toEqual(
      [
        'heartRateZones',
        'insights',
        'language',
        'maps',
        'notifications',
        'other',
        'preferences',
        'recording',
        'routes',
      ].sort()
    );
  });
});
