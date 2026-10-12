import { PermissionStatus, type LocationPermissionResponse } from 'expo-location';

import { locationGrant } from '@/shared/app/permissions/locationGrant';

function response(fields: Partial<LocationPermissionResponse>): LocationPermissionResponse {
  return {
    status: PermissionStatus.GRANTED,
    granted: true,
    canAskAgain: true,
    expires: 'never',
    ...fields,
  } as LocationPermissionResponse;
}

describe('the location grant', () => {
  it('reads coarse on Android as approximate', () => {
    expect(locationGrant(response({ android: { accuracy: 'coarse' } }))).toEqual({
      granted: true,
      precision: 'approximate',
    });
  });

  it('reads fine on Android as precise', () => {
    expect(locationGrant(response({ android: { accuracy: 'fine' } })).precision).toBe('precise');
  });

  it('reads reduced accuracy on iOS as approximate', () => {
    const grant = locationGrant(response({ ios: { scope: 'whenInUse', accuracy: 'reduced' } }));
    expect(grant.precision).toBe('approximate');
  });

  it('reads full accuracy on iOS as precise', () => {
    const grant = locationGrant(response({ ios: { scope: 'always', accuracy: 'full' } }));
    expect(grant.precision).toBe('precise');
  });

  it('reads a response with no platform detail as precise, as the OS did before the choice', () => {
    expect(locationGrant(response({})).precision).toBe('precise');
  });

  it('is not granted on a denial', () => {
    const denied = response({
      status: PermissionStatus.DENIED,
      granted: false,
      canAskAgain: false,
      android: { accuracy: 'none' },
    });
    expect(locationGrant(denied).granted).toBe(false);
  });
});
