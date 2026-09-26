/**
 * Scenario: the native widget colours its form sparkline from zones stored in
 * the snapshot and never bands anything itself. Those zones were computed on
 * absolute TSB, so an athlete who reads form as a share of fitness saw the
 * widget disagree with the summary card beside it on the same home screen.
 *
 * Expected behaviour: each stored zone is banded on the fitness of its own day,
 * and the arrays are paired by index rather than by luck.
 */
import { composeSnapshot, type RawWidgetData } from '@/features/home/lib/widgetSnapshot';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const NOW = 1_760_000_000;

/**
 * Fitness rises across the window while form holds at -20. On the absolute
 * band that is `optimal` every day; as a share it starts at -66 per cent and
 * ends at -6.7, so the zones have to move even though form never does.
 */
const FORM = [-20, -20, -20, -20];
const FITNESS = [30, 60, 150, 300];

function raw(formAsPercent?: boolean): RawWidgetData {
  return {
    sparklines: {
      form: [...FORM],
      fitness: [...FITNESS],
      fatigue: [50, 80, 170, 320],
      hrv: [],
      rhr: [],
    } as unknown as RawWidgetData['sparklines'],
    summary: null,
    latest: null,
    locale: 'en-AU',
    isMetric: true,
    formAsPercent,
    nowSeconds: NOW,
    nowWallSeconds: NOW,
  };
}

it('bands each stored zone on absolute TSB while the flag is off', () => {
  const snapshot = composeSnapshot(raw(false));

  expect(snapshot.sparklines.formZones).toEqual(['optimal', 'optimal', 'optimal', 'optimal']);
});

it('bands each stored zone on the fitness of its own day when the flag is on', () => {
  const snapshot = composeSnapshot(raw(true));

  // -20/30 = -66%, -20/60 = -33%, -20/150 = -13%, -20/300 = -6.7%.
  expect(snapshot.sparklines.formZones).toEqual(['highRisk', 'highRisk', 'optimal', 'greyZone']);
});

it('pairs the arrays by index, so a shifted fitness series is a different answer', () => {
  const shifted = raw(true);
  shifted.sparklines!.fitness = [300, 150, 60, 30];

  expect(composeSnapshot(shifted).sparklines.formZones).toEqual([
    'greyZone',
    'optimal',
    'highRisk',
    'highRisk',
  ]);
});

it('takes an absent flag as absolute', () => {
  expect(composeSnapshot(raw(undefined)).sparklines.formZones).toEqual(
    composeSnapshot(raw(false)).sparklines.formZones
  );
});

it("bands the headline form metric on today's fitness", () => {
  expect(composeSnapshot(raw(true)).metrics.form.zone).toBe('greyZone');
  expect(composeSnapshot(raw(false)).metrics.form.zone).toBe('optimal');
});

describe('the flag that drives the rebuild', () => {
  afterEach(() => useFormPreference.setState({ formAsPercent: null }));

  it('says when the value moved, and when it did not', () => {
    expect(useFormPreference.getState().setFormAsPercent(true)).toBe(true);
    expect(useFormPreference.getState().setFormAsPercent(true)).toBe(false);
    expect(useFormPreference.getState().setFormAsPercent(false)).toBe(true);
  });
});
