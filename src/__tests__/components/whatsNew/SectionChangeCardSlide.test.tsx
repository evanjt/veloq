import React from 'react';
import { render } from '@testing-library/react-native';
import { SectionChangeCardSlide } from '@/features/settings/components/whatsNew/SectionChangeCardSlide';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { getSlidesSince } from '@/features/settings/components/whatsNew/slides';

jest.mock('@/shared/native/routeEngine', () => ({ getRouteEngine: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
  }),
}));

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

  describe('the cutover outcome', () => {
    const COUNTS = {
      current: 40,
      proposed: 42,
      unchanged: 35,
      changed: 3,
      new: 4,
      gone: 2,
    };

    function engineWith(progress: unknown, diff: unknown) {
      (getRouteEngine as jest.Mock).mockReturnValue({
        getChangeCardSupport: () => ALL_BUT_DEVICE,
        getCutoverProgress: () => progress,
        getCutoverDiff: () => diff,
      });
    }

    it('names the phase while the re-cut runs and shows no counts', () => {
      engineWith({ phase: 'detecting', running: true }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = render(<SectionChangeCardSlide />);
      expect(getByTestId('change-card-progress')).toHaveTextContent(/phaseDetecting/);
      expect(queryByTestId('change-card-counts')).toBeNull();
    });

    it('reports the totals and the breakdown once the run has settled', () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-progress')).toBeNull();
      const line = getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/"current":40/);
      expect(line).toHaveTextContent(/"proposed":42/);
      expect(line).toHaveTextContent(/"new":4/);
      expect(line).toHaveTextContent(/"changed":3/);
      expect(line).toHaveTextContent(/"gone":2/);
    });

    it('reads a catalogue that came through untouched as unchanged', () => {
      engineWith(
        { phase: 'complete', running: false },
        { counts: { ...COUNTS, proposed: 40, unchanged: 40, changed: 0, new: 0, gone: 0 } }
      );
      const line = render(<SectionChangeCardSlide />).getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/diffUnchanged/);
      expect(line).toHaveTextContent(/"sections":40/);
    });

    it('falls back to the claim rows when there is no stored diff', () => {
      engineWith({ phase: 'idle', running: false }, null);
      const { getByTestId, queryByTestId } = render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
      expect(getByTestId('change-card-row-ledger')).toBeTruthy();
    });

    it('keeps the claim rows when the engine has no cutover calls at all', () => {
      (getRouteEngine as jest.Mock).mockReturnValue({
        getChangeCardSupport: () => ALL_BUT_DEVICE,
      });
      const { getByTestId, queryByTestId } = render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(getByTestId('change-card-row-ledger')).toBeTruthy();
    });

    it('shows nothing at all when no claim is supported, run or not', () => {
      (getRouteEngine as jest.Mock).mockReturnValue({
        getChangeCardSupport: () => ({
          deterministic: false,
          sameResultDripOrBatch: false,
          ledger: false,
          revert: false,
          retired: false,
          pinnedSurvive: false,
          sameOnEveryDevice: false,
        }),
        getCutoverProgress: () => ({ phase: 'detecting', running: true }),
        getCutoverDiff: () => ({ counts: COUNTS }),
      });
      expect(render(<SectionChangeCardSlide />).queryByTestId('change-card')).toBeNull();
    });
  });
});
