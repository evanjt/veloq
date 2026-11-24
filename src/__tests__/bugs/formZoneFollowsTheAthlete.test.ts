/**
 * Scenario: `icu_form_as_percent` decides what the form number on every screen
 * means, and the engine states each day's form, zone and text in the athlete's
 * unit. A chart that re-derived any of them from the loads drew bands and
 * readings that did not match the athlete's own setting.
 *
 * Expected behaviour: the chart series carries exactly what the engine stated
 * for each day, a day with no stated form is a gap in its slot, and the bands
 * sit at the edges the engine sent.
 */
import { formChartSeries, formZoneBands } from '@/features/fitness/lib/fitness';
import type { WellnessData } from '@/types';
import { formAsPercent, useFormPreference } from '@/shared/app/FormPreferenceStore';

const day = (id: string, over: Partial<WellnessData>) => ({ id, ...over }) as WellnessData;

describe('the chart series', () => {
  it('carries each day the form, zone and text the engine stated, oldest first', () => {
    const series = formChartSeries([
      day('2026-01-02', { ctl: 50, atl: 70, form: -40, formZone: 'highRisk', formText: '-40%' }),
      day('2026-01-01', { ctl: 40, atl: 40, form: 0, formZone: 'greyZone', formText: '0%' }),
    ]);
    expect(series.map((p) => [p.date, p.form, p.zone, p.text])).toEqual([
      ['2026-01-01', 0, 'greyZone', '0%'],
      ['2026-01-02', -40, 'highRisk', '-40%'],
    ]);
  });

  it('keeps the rounded loads beside the form for the readings that print them', () => {
    const [point] = formChartSeries([day('2026-01-01', { ctl: 50.4, atl: 39.6 })]);
    expect([point.fitness, point.fatigue]).toEqual([50, 40]);
  });

  it('keeps a day with no stated form as a gap in its slot', () => {
    const series = formChartSeries([
      day('2026-01-01', { ctl: 50, atl: 60, form: -20, formZone: 'optimal', formText: '-20%' }),
      day('2026-01-02', { ctl: 0, atl: 10 }),
      day('2026-01-03', {}),
    ]);
    expect(series.map((p) => p.x)).toEqual([0, 1, 2]);
    expect(series.map((p) => [p.form, p.zone, p.text])).toEqual([
      [-20, 'optimal', '-20%'],
      [null, null, null],
      [null, null, null],
    ]);
  });
});

describe('the zone bands', () => {
  it('meet at the edges the engine sent, lowest first', () => {
    const bands = formZoneBands([-8, -4, 2, 9]);
    expect(bands.optimal).toEqual({ min: -8, max: -4 });
    expect(bands.greyZone).toEqual({ min: -4, max: 2 });
    expect(bands.fresh).toEqual({ min: 2, max: 9 });
    expect(bands.highRisk?.max).toBe(-8);
    expect(bands.transition?.min).toBe(9);
  });

  it('draw nothing before the engine has sent its edges', () => {
    expect(formZoneBands([])).toEqual({});
    expect(formZoneBands([-8, -4])).toEqual({});
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
