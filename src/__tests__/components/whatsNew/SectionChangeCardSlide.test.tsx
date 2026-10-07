import React from 'react';
import { render } from '@testing-library/react-native';
import { SectionChangeCardSlide } from '@/features/settings/components/whatsNew/SectionChangeCardSlide';
import { getEngine } from '@/shared/native/engine';
import { getSlidesSince } from '@/features/settings/components/whatsNew/slides';

import { routesStatus } from '../../__shared__/routesStatusStub';
import { resolvedLocale } from '../../i18n/resolvedLocale';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

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
  it('draws no claim rows and no elevation line, whatever the engine supports', () => {
    (getEngine as jest.Mock).mockReturnValue({
      subscribe: () => () => {},
      getChangeCardSupport: () => ALL_BUT_DEVICE,
    });
    const { getByTestId, queryByTestId, queryByText } = render(<SectionChangeCardSlide />);
    expect(getByTestId('change-card')).toBeTruthy();
    expect(queryByTestId('change-card-row-ledger')).toBeNull();
    expect(queryByTestId('change-card-elevation')).toBeNull();
    expect(queryByText(/whatsNew\.v040\.row/)).toBeNull();
  });

  it('shows no engine-support rows even when the engine is not open', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    expect(render(<SectionChangeCardSlide />).queryByTestId('change-card-row-ledger')).toBeNull();
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
      (getEngine as jest.Mock).mockReturnValue({
        subscribe: () => () => {},
        getChangeCardSupport: () => ALL_BUT_DEVICE,
        getCutoverProgress: () => progress,
        getRoutesStatusData: () =>
          routesStatus({ cutover: progress as { phase: string; running: boolean } }),
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
        {
          counts: {
            ...COUNTS,
            proposed: 40,
            unchanged: 40,
            changed: 0,
            new: 0,
            gone: 0,
          },
        }
      );
      const line = render(<SectionChangeCardSlide />).getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/diffUnchanged/);
      expect(line).toHaveTextContent(/"sections":40/);
    });

    it('shows neither progress nor counts when there is no stored diff', () => {
      engineWith({ phase: 'idle', running: false }, null);
      const { queryByTestId } = render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    it('shows neither when the engine has no cutover calls at all', () => {
      (getEngine as jest.Mock).mockReturnValue({
        subscribe: () => () => {},
      });
      const { queryByTestId } = render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    it('says the re-cut failed, and shows no counts from the run before it', () => {
      engineWith({ phase: 'failed', running: false }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = render(<SectionChangeCardSlide />);
      expect(getByTestId('change-card-failed')).toHaveTextContent(/recutFailed/);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    it('says the sections were replaced when the run failed after the apply', () => {
      engineWith({ phase: 'failed_after_apply', running: false }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = render(<SectionChangeCardSlide />);
      expect(getByTestId('change-card-failed')).toHaveTextContent(/recutFailedAfterApply/);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    const RESET = {
      previous: {
        proximityThreshold: 100,
        minSectionLength: 50,
        maxSectionLength: 200000,
        minActivities: 3,
        divergenceThreshold: 0.1,
      },
      current: {
        proximityThreshold: 200,
        minSectionLength: 150,
        maxSectionLength: 200000,
        minActivities: 2,
        divergenceThreshold: 0.15,
      },
    };

    it('names each setting the flip moved, and only those', () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS, settingsReset: RESET });
      const row = render(<SectionChangeCardSlide />).getByTestId('change-card-settings-reset');
      expect(row).toHaveTextContent(/settingsReset/);
      expect(row).toHaveTextContent(/settingsResetProximity/);
      expect(row).toHaveTextContent(/from\\":\\"100 m\\",\\"to\\":\\"200 m/);
      expect(row).toHaveTextContent(/settingsResetMinLength/);
      expect(row).toHaveTextContent(/from\\":\\"50 m\\",\\"to\\":\\"150 m/);
      expect(row).toHaveTextContent(/settingsResetMinActivities/);
      expect(row).toHaveTextContent(/from\\":\\"3\\",\\"to\\":\\"2/);
      expect(row).toHaveTextContent(/settingsResetDivergence/);
      expect(row).toHaveTextContent(/from\\":\\"10%\\",\\"to\\":\\"15%/);
      expect(row).not.toHaveTextContent(/settingsResetMaxLength/);
    });

    it('draws no reset row when the flip moved nothing', () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS, settingsReset: null });
      expect(
        render(<SectionChangeCardSlide />).queryByTestId('change-card-settings-reset')
      ).toBeNull();
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS });
      expect(
        render(<SectionChangeCardSlide />).queryByTestId('change-card-settings-reset')
      ).toBeNull();
    });

    it('withholds the reset row while a run is in flight and after a failure', () => {
      engineWith({ phase: 'detecting', running: true }, { counts: COUNTS, settingsReset: RESET });
      expect(
        render(<SectionChangeCardSlide />).queryByTestId('change-card-settings-reset')
      ).toBeNull();
      engineWith({ phase: 'failed', running: false }, { counts: COUNTS, settingsReset: RESET });
      expect(
        render(<SectionChangeCardSlide />).queryByTestId('change-card-settings-reset')
      ).toBeNull();
    });

    it('reads draining and archiving as the one preparing line', () => {
      for (const phase of ['draining', 'archiving']) {
        engineWith({ phase, running: true }, null);
        const line = render(<SectionChangeCardSlide />).getByTestId('change-card-progress');
        expect(line).toHaveTextContent(/phasePreparing/);
        expect(line).not.toHaveTextContent(new RegExp(phase, 'i'));
      }
    });
  });
});

describe('v040 sections body', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.join(__dirname, '../../../i18n/locales');

  it.each(fs.readdirSync(dir))('states a rule and not a result of the run, in %s', (file) => {
    const locale = resolvedLocale(file.replace('.json', ''));
    const body: string = locale.whatsNew.v040.sectionsBody;
    // The first-person-plural "now cut by" form is a claim about the run that a
    // failed re-analysis falsifies; the body states the detector's property.
    expect(body.split(/[.。]/).filter((s) => s.trim()).length).toBe(1);
    expect(body).not.toMatch(/\b(now|jetzt|maintenant|ahora|agora|ora)\b/i);
  });
});
