/**
 * Scenario: `icu_form_as_percent` decides what the form number on every screen
 * means. `getFormZone` applied the -30/-10/+5/+25 thresholds to absolute TSB
 * and took no other argument, so an athlete who reads form as a share of
 * fitness saw bands that did not match their own setting.
 *
 * Expected behaviour: the same thresholds, applied to whichever number the
 * athlete reads, and the absolute band whenever there is no fitness to be a
 * percentage of.
 */
import { getFormZone, formChartSeries } from '@/features/fitness/lib/fitness';
import type { WellnessData } from '@/types';
import { formAsPercent, useFormPreference } from '@/shared/app/FormPreferenceStore';

describe('absolute form, the default', () => {
  it('bands on TSB itself', () => {
    expect(getFormZone(-40)).toBe('highRisk');
    expect(getFormZone(-20)).toBe('optimal');
    expect(getFormZone(0)).toBe('greyZone');
    expect(getFormZone(10)).toBe('fresh');
    expect(getFormZone(30)).toBe('transition');
  });

  it('takes each boundary into the band above it', () => {
    expect(getFormZone(-30)).toBe('optimal');
    expect(getFormZone(-10)).toBe('greyZone');
    expect(getFormZone(5)).toBe('fresh');
    expect(getFormZone(25)).toBe('transition');
  });

  it('ignores fitness while the flag is off', () => {
    expect(getFormZone(-20, 80, false)).toBe('optimal');
    expect(getFormZone(-20, 80)).toBe('optimal');
  });
});

describe('form as a percentage of fitness', () => {
  it('bands on the share, so the same TSB reads differently at different fitness', () => {
    // -20 against 80 CTL is -25%: still optimal.
    expect(getFormZone(-20, 80, true)).toBe('optimal');
    // The same -20 against 30 CTL is -66%: high risk.
    expect(getFormZone(-20, 30, true)).toBe('highRisk');
    // And against 300 CTL it is -6.7%, which is the grey zone.
    expect(getFormZone(-20, 300, true)).toBe('greyZone');
  });

  it('puts a rested athlete in transition on the share, not the absolute', () => {
    expect(getFormZone(20, 50, true)).toBe('transition');
    expect(getFormZone(20, 50, false)).toBe('fresh');
  });
});

describe('no fitness to be a percentage of', () => {
  it.each([
    ['zero', 0],
    ['missing', undefined],
    ['null', null],
  ])('has no zone under the percentage setting when fitness is %s', (_label, fitness) => {
    expect(getFormZone(-20, fitness as number | null | undefined, true)).toBeNull();
    expect(getFormZone(-40, fitness as number | null | undefined, true)).toBeNull();
  });

  it('still bands on absolute TSB when the setting is off', () => {
    expect(getFormZone(-20, 0, false)).toBe('optimal');
    expect(getFormZone(-40, null)).toBe('highRisk');
  });
});

describe('the chart series', () => {
  const day = (id: string, ctl: number | null, atl: number | null) =>
    ({ id, ctl, atl }) as WellnessData;

  it('plots absolute TSB, one point per day, when the setting is off', () => {
    const series = formChartSeries([day('2026-01-02', 50, 70), day('2026-01-01', 40, 40)], false);
    expect(series.map((p) => [p.date, p.form])).toEqual([
      ['2026-01-01', 0],
      ['2026-01-02', -20],
    ]);
  });

  it('plots each day as a share of that same day fitness under the percentage setting', () => {
    const series = formChartSeries([day('2026-01-01', 50, 70), day('2026-01-02', 200, 220)], true);
    expect(series.map((p) => p.form)).toEqual([-40, -10]);
    expect(series.map((p) => getFormZone(p.form as number))).toEqual(['highRisk', 'greyZone']);
  });

  it('keeps the plotted percentage at full precision so rounding cannot move a zone', () => {
    const series = formChartSeries([day('2026-01-01', 96, 125)], true);
    const point = series[0];
    expect(point.form as number).toBeLessThan(-30);
    expect(getFormZone(point.tsb, point.fitness, true)).toBe('highRisk');
    expect(getFormZone(point.form as number)).toBe('highRisk');
  });

  it('zones the plotted percentage like the card on both sides of every boundary', () => {
    const cases: [number, number][] = [
      [96, 125],
      [100, 130],
      [100, 110],
      [100, 90],
      [100, 105],
      [100, 75],
      [96, 70],
    ];
    for (const [ctl, atl] of cases) {
      const p = formChartSeries([day('2026-01-01', ctl, atl)], true)[0];
      expect(getFormZone(p.form as number)).toBe(getFormZone(p.tsb, p.fitness, true));
    }
  });

  it('keeps a no-fitness day as a gap in its slot under the percentage setting', () => {
    const series = formChartSeries(
      [day('2026-01-01', 50, 60), day('2026-01-02', 0, 10), day('2026-01-03', null, null)],
      true
    );
    expect(series.map((p) => p.x)).toEqual([0, 1, 2]);
    expect(series.map((p) => p.form)).toEqual([-20, null, null]);
  });

  it('keeps the absolute number for a no-fitness day when the setting is off', () => {
    const series = formChartSeries([day('2026-01-01', 0, 10)], false);
    expect(series[0].form).toBe(-10);
  });
});

describe('the preference a non-React caller reads', () => {
  afterEach(() => useFormPreference.setState({ formAsPercent: null }));

  it('reads absolute until an athlete profile has been seen', () => {
    expect(formAsPercent()).toBe(false);
  });

  it('follows the flag once the profile is read', () => {
    useFormPreference.getState().setFormAsPercent(true);
    expect(formAsPercent()).toBe(true);

    useFormPreference.getState().setFormAsPercent(false);
    expect(formAsPercent()).toBe(false);
  });
});
