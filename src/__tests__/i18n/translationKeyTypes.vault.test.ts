import type { TFunction } from 'i18next';

// Scenario: the key type is derived from the root bundle, so a key only the old
// hand-kept interface declared is a type error and a key only the bundle holds is accepted.
// The assertions are checked by `tsc`; the runtime body only keeps the suite non-empty.
describe('translation key types follow the root bundle', () => {
  it('rejects a key no bundle holds and accepts one only the bundle holds', () => {
    const typed = (t: TFunction) => {
      // @ts-expect-error declared by the old interface, present in no bundle
      t('insights.formAdvice.fresh');
      t('backup.heldUntilSignIn');
    };
    expect(typeof typed).toBe('function');
  });
});
