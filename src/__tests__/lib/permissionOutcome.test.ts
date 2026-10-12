import { askPermission, permissionOutcome } from '@/shared/app/permissions';

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

describe('askPermission', () => {
  const reading = (status: string, canAskAgain: boolean) => async () => ({ status, canAskAgain });

  it('does not request a permission already granted', async () => {
    const request = jest.fn();
    await expect(askPermission(reading('granted', true), request)).resolves.toEqual({
      outcome: 'granted',
      prompted: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not request a blocked permission, and says no dialog was raised', async () => {
    const request = jest.fn();
    await expect(askPermission(reading('denied', false), request)).resolves.toEqual({
      outcome: 'blocked',
      prompted: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('requests an askable permission and reports what the athlete answered', async () => {
    await expect(
      askPermission(reading('undetermined', true), reading('granted', true))
    ).resolves.toEqual({ outcome: 'granted', prompted: true });
    await expect(askPermission(reading('denied', true), reading('denied', false))).resolves.toEqual(
      { outcome: 'blocked', prompted: true }
    );
  });
});
