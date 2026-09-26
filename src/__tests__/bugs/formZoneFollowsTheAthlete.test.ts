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
import { getFormZone } from '@/features/fitness/lib/fitness';
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
  ])('falls back to the absolute band when fitness is %s', (_label, fitness) => {
    expect(getFormZone(-20, fitness as number | null | undefined, true)).toBe('optimal');
    expect(getFormZone(-40, fitness as number | null | undefined, true)).toBe('highRisk');
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
