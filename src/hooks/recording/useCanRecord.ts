import { useAuthStore, useUploadPermissionStore } from '@/providers';

type CanRecordResult = {
  canRecord: boolean;
  reason: 'ok' | 'no_permission' | 'checking';
};

/**
 * Determines whether the current user can record and upload activities.
 *
 * - API key users: always allowed (personal API keys have all permissions)
 * - Demo users: always allowed
 * - OAuth users: allowed only if their token includes ACTIVITY:WRITE scope.
 *   If scope is unknown (null), recording is blocked — better to ask for
 *   permission upfront than let the user record and fail on upload.
 */
export function useCanRecord(): CanRecordResult {
  const authMethod = useAuthStore((s) => s.authMethod);
  const needsUpgrade = useUploadPermissionStore((s) => s.needsUpgrade);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);

  // API key users always have full permissions — can't scope API keys
  if (authMethod === 'apiKey') {
    return { canRecord: true, reason: 'ok' };
  }

  // Demo users can always record
  if (authMethod === 'demo') {
    return { canRecord: true, reason: 'ok' };
  }

  // OAuth user: must have confirmed ACTIVITY:WRITE scope
  if (hasWritePermission === true) {
    return { canRecord: true, reason: 'ok' };
  }

  // OAuth user with unknown or denied permission — block recording
  return { canRecord: false, reason: 'no_permission' };
}
