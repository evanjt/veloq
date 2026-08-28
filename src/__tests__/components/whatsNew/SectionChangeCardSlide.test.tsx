import React from 'react';
import { render } from '@testing-library/react-native';
import { SectionChangeCardSlide } from '@/features/settings/components/whatsNew/SectionChangeCardSlide';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { getSlidesSince } from '@/features/settings/components/whatsNew/slides';

jest.mock('@/shared/native/routeEngine', () => ({ getRouteEngine: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const ALL_BUT_DEVICE = {
  deterministic: true,
  sameResultDripOrBatch: true,
  ledger: true,
  revert: true,
  retired: true,
  pinnedSurvive: true,
  sameOnEveryDevice: false,
};

describe('SectionChangeCardSlide', () => {
  it('shows one row per supported claim and never the cross-device row', () => {
    (getRouteEngine as jest.Mock).mockReturnValue({ getChangeCardSupport: () => ALL_BUT_DEVICE });
    const { getByTestId, queryByTestId, getAllByText } = render(<SectionChangeCardSlide />);
    for (const flag of [
      'deterministic',
      'sameResultDripOrBatch',
      'ledger',
      'revert',
      'retired',
      'pinnedSurvive',
    ]) {
      expect(getByTestId(`change-card-row-${flag}`)).toBeTruthy();
    }
    expect(queryByTestId('change-card-row-sameOnEveryDevice')).toBeNull();
    expect(getAllByText(/whatsNew\.v040\.row/).length).toBe(6);
  });

  it('hides a row whose flag is false and the card when nothing is supported', () => {
    (getRouteEngine as jest.Mock).mockReturnValue({
      getChangeCardSupport: () => ({ ...ALL_BUT_DEVICE, deterministic: false, revert: false }),
    });
    const { queryByTestId } = render(<SectionChangeCardSlide />);
    expect(queryByTestId('change-card-row-deterministic')).toBeNull();
    expect(queryByTestId('change-card-row-revert')).toBeNull();
    expect(queryByTestId('change-card-row-ledger')).toBeTruthy();

    (getRouteEngine as jest.Mock).mockReturnValue({
      getChangeCardSupport: () => ({
        ...ALL_BUT_DEVICE,
        deterministic: false,
        sameResultDripOrBatch: false,
        ledger: false,
        revert: false,
        retired: false,
        pinnedSurvive: false,
      }),
    });
    expect(render(<SectionChangeCardSlide />).queryByTestId('change-card')).toBeNull();
    (getRouteEngine as jest.Mock).mockReturnValue(null);
    expect(render(<SectionChangeCardSlide />).queryByTestId('change-card')).toBeNull();
  });

  it('is registered as the 0.4.0 slide', () => {
    const since038 = getSlidesSince('0.3.8');
    expect(since038.some((s) => s.titleKey === 'whatsNew.v040.sectionsTitle')).toBe(true);
    expect(getSlidesSince('0.4.0').some((s) => s.titleKey === 'whatsNew.v040.sectionsTitle')).toBe(
      false
    );
  });
});
