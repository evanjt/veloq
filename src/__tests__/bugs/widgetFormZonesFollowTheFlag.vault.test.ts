/**
 * Scenario: the native widget colours its form sparkline from zones stored in
 * the snapshot, which the engine bands on the athlete's form setting. A change
 * to that setting has to rebuild the snapshot, or the widget keeps the old bands.
 *
 * Expected behaviour: the store says when the setting moved, which is what
 * drives the rebuild, and says nothing when it did not.
 */
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

describe('the flag that drives the rebuild', () => {
  afterEach(() => useFormPreference.setState({ formAsPercent: null }));

  it('says when the value moved, and when it did not', () => {
    expect(useFormPreference.getState().setFormAsPercent(true)).toBe(true);
    expect(useFormPreference.getState().setFormAsPercent(true)).toBe(false);
    expect(useFormPreference.getState().setFormAsPercent(false)).toBe(true);
  });
});
