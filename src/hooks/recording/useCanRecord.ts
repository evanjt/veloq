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
 * - OAuth users: allowed only if their token includes ACTIVITY:WRITE scope
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

  // OAuth user explicitly denied or flagged as needing upgrade
  if (needsUpgrade || hasWritePermission === false) {
    return { canRecord: false, reason: 'no_permission' };
  }

  // OAuth user — scope not yet checked (e.g., token restored from storage without scope info)
  // Allow optimistically until a 403 confirms otherwise
  if (hasWritePermission === null) {
    return { canRecord: true, reason: 'checking' };
  }

  return { canRecord: true, reason: 'ok' };
}
