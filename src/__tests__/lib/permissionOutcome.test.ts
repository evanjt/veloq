import { permissionOutcome } from '@/shared/app/permissions/outcome';

describe('permissionOutcome', () => {
  it('reads a grant as granted whatever the system would still ask', () => {
    expect(permissionOutcome({ status: 'granted', canAskAgain: false })).toBe('granted');
    expect(permissionOutcome({ status: 'granted', canAskAgain: true })).toBe('granted');
  });

  it('reads a refusal the system will still ask about as askable', () => {
    expect(permissionOutcome({ status: 'denied', canAskAgain: true })).toBe('askable');
    expect(permissionOutcome({ status: 'undetermined', canAskAgain: true })).toBe('askable');
  });

  it('reads a refusal the system will not ask about again as blocked', () => {
    expect(permissionOutcome({ status: 'denied', canAskAgain: false })).toBe('blocked');
  });

  it('reads a response with no canAskAgain as askable, so the dialog is never hidden', () => {
    expect(permissionOutcome({ status: 'denied' })).toBe('askable');
  });
});
