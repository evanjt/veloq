import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SectionChangeCardSlide } from '@/features/settings/components/whatsNew/SectionChangeCardSlide';
import { getEngine } from '@/shared/native/engine';

import { routesStatus } from '../../__shared__/routesStatusStub';
import { resolvedLocale } from '../../i18n/resolvedLocale';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides(
    require('../../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

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
  it('draws no claim rows and no elevation line, whatever the engine supports', async () => {
    (getEngine as jest.Mock).mockReturnValue({
      subscribe: () => () => {},
      getChangeCardSupport: () => ALL_BUT_DEVICE,
    });
    const { getByTestId, queryByTestId, queryByText } = await render(<SectionChangeCardSlide />);
    expect(getByTestId('change-card')).toBeTruthy();
    expect(queryByTestId('change-card-row-ledger')).toBeNull();
    expect(queryByTestId('change-card-elevation')).toBeNull();
    expect(queryByText(/whatsNew\.v040\.row/)).toBeNull();
  });

  it('shows no engine-support rows even when the engine is not open', async () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    expect(
      await (await render(<SectionChangeCardSlide />)).queryByTestId('change-card-row-ledger')
    ).toBeNull();
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

    function engineWith(progress: unknown, diff: unknown, retired = 0) {
      (getEngine as jest.Mock).mockReturnValue({
        subscribe: () => () => {},
        getChangeCardSupport: () => ALL_BUT_DEVICE,
        getRoutesStatusData: () =>
          routesStatus({ cutover: progress as { phase: string; running: boolean } }),
        getCutoverDiff: () => diff,
        getRoutesScreenData: () => ({ ledgerRetiredCount: retired }),
      });
    }

    it('names the phase while the re-cut runs and shows no counts', async () => {
      engineWith({ phase: 'detecting', running: true }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = await render(<SectionChangeCardSlide />);
      expect(getByTestId('change-card-progress')).toHaveTextContent(/phaseNames.detecting/);
      expect(queryByTestId('change-card-counts')).toBeNull();
    });

    it('reports the totals and the breakdown once the run has settled', async () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = await render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-progress')).toBeNull();
      const line = getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/"current\\?":40\b/);
      expect(line).toHaveTextContent(/"proposed\\?":42\b/);
      expect(line).toHaveTextContent(/"new\\?":4\b/);
      expect(line).toHaveTextContent(/"changed\\?":3\b/);
      expect(line).toHaveTextContent(/"gone\\?":2\b/);
    });

    it('reads a catalogue that came through untouched as unchanged', async () => {
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
      const line = await (
        await render(<SectionChangeCardSlide />)
      ).getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/diffUnchanged/);
      expect(line).toHaveTextContent(/"count":40/);
    });

    it('says the detector kept none of the library and offers the retired list', async () => {
      engineWith(
        { phase: 'complete', running: false },
        {
          counts: { current: 60, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 60 },
        },
        60
      );
      const { getByTestId } = await render(<SectionChangeCardSlide />);
      const line = getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/diffNoneKept/);
      expect(line).toHaveTextContent(/"count":60/);
      expect(line).not.toHaveTextContent(/diffTotals/);
      expect(line).not.toHaveTextContent(/diffBreakdown/);
      expect(getByTestId('change-card-retired-link')).toBeTruthy();
    });

    it('reports the totals when the re-cut kept some sections', async () => {
      engineWith(
        { phase: 'complete', running: false },
        {
          counts: { current: 60, proposed: 9, unchanged: 5, changed: 2, new: 2, gone: 55 },
        }
      );
      const line = await (
        await render(<SectionChangeCardSlide />)
      ).getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/diffTotals/);
      expect(line).toHaveTextContent(/diffBreakdown/);
      expect(line).not.toHaveTextContent(/diffNoneKept/);
    });

    it('reads an empty library with nothing to re-cut as unchanged, not as kept none', async () => {
      engineWith(
        { phase: 'complete', running: false },
        { counts: { current: 0, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 0 } }
      );
      const line = await (
        await render(<SectionChangeCardSlide />)
      ).getByTestId('change-card-counts');
      expect(line).toHaveTextContent(/diffUnchanged/);
      expect(line).not.toHaveTextContent(/diffNoneKept/);
    });

    it('shows neither progress nor counts when there is no stored diff', async () => {
      engineWith({ phase: 'idle', running: false }, null);
      const { queryByTestId } = await render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    it('shows neither when the engine has no cutover calls at all', async () => {
      (getEngine as jest.Mock).mockReturnValue({
        subscribe: () => () => {},
      });
      const { queryByTestId } = await render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    it('says the re-cut failed, and shows no counts from the run before it', async () => {
      engineWith({ phase: 'failed', running: false }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = await render(<SectionChangeCardSlide />);
      expect(getByTestId('change-card-failed')).toHaveTextContent(/recutFailed/);
      expect(queryByTestId('change-card-counts')).toBeNull();
      expect(queryByTestId('change-card-progress')).toBeNull();
    });

    it('offers no link to the retired sections while the library retired nothing', async () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS }, 0);
      const { queryByTestId } = await render(<SectionChangeCardSlide />);
      expect(queryByTestId('change-card-retired-link')).toBeNull();
    });

    it('opens the retired sections from a link once some retired', async () => {
      (router.push as jest.Mock).mockClear();
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS }, 2);
      const { getByTestId } = await render(<SectionChangeCardSlide />);
      await fireEvent.press(getByTestId('change-card-retired-link'));
      expect(router.push).toHaveBeenCalledWith('/section-retired');
    });

    it('says the sections were replaced when the run failed after the apply', async () => {
      engineWith({ phase: 'failed_after_apply', running: false }, { counts: COUNTS });
      const { getByTestId, queryByTestId } = await render(<SectionChangeCardSlide />);
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

    it('names each setting the flip moved, and only those', async () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS, settingsReset: RESET });
      const row = await (
        await render(<SectionChangeCardSlide />)
      ).getByTestId('change-card-settings-reset');
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

    it('draws no reset row when the flip moved nothing', async () => {
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS, settingsReset: null });
      expect(
        await (await render(<SectionChangeCardSlide />)).queryByTestId('change-card-settings-reset')
      ).toBeNull();
      engineWith({ phase: 'complete', running: false }, { counts: COUNTS });
      expect(
        await (await render(<SectionChangeCardSlide />)).queryByTestId('change-card-settings-reset')
      ).toBeNull();
    });

    it('withholds the reset row while a run is in flight and after a failure', async () => {
      engineWith({ phase: 'detecting', running: true }, { counts: COUNTS, settingsReset: RESET });
      expect(
        await (await render(<SectionChangeCardSlide />)).queryByTestId('change-card-settings-reset')
      ).toBeNull();
      engineWith({ phase: 'failed', running: false }, { counts: COUNTS, settingsReset: RESET });
      expect(
        await (await render(<SectionChangeCardSlide />)).queryByTestId('change-card-settings-reset')
      ).toBeNull();
    });

    it('names the draining and archiving steps', async () => {
      for (const phase of ['draining', 'archiving']) {
        engineWith({ phase, running: true }, null);
        const line = await (
          await render(<SectionChangeCardSlide />)
        ).getByTestId('change-card-progress');
        expect(line).toHaveTextContent(new RegExp(`phaseNames\\.${phase}`));
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
    const body: string = locale.whatsNew.v040.rebuiltBody;
    // The first-person-plural "now cut by" form is a claim about the run that a
    // failed re-analysis falsifies; the body states the detector's property.
    expect(body.split(/[.。]/).filter((s) => s.trim()).length).toBe(1);
    expect(body).not.toMatch(/\b(now|jetzt|maintenant|ahora|agora|ora)\b/i);
  });
});
