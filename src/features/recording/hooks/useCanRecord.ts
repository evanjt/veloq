import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

type CanRecordResult = {
  canRecord: boolean;
  reason: 'ok' | 'no_permission' | 'not_signed_in' | 'checking';
};

/**
 * Determines whether the current user can record and upload activities.
 *
 * - No account at all: blocked, and said as a sign-in problem rather than a
 *   scope one. The two need different gates and used to share a reason.
 * - API key users: always allowed (personal API keys have all permissions)
 * - Demo users: always allowed
 * - OAuth users: `ok` only if their token includes ACTIVITY:WRITE scope. A scope
 *   known to be missing answers `no_permission`, which the screens read as a
 *   warning rather than a refusal: the ride goes ahead and stays on the device,
 *   because a missing upload scope stops the upload and not the riding.
 * - OAuth users whose store has not loaded yet: `checking`, not blocked. A cold
 *   start into a one-tap record surface can arrive first, and gating on an
 *   answer that has not come back reads as a refusal the athlete never earned.
 */
export function useCanRecord(): CanRecordResult {
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const isLoaded = useUploadPermissionStore((s) => s.isLoaded);

  // Nobody is signed in, so the ride has nowhere to go. Every one-tap surface
  // reaches the recording screen directly, so this is the case that matters.
  if (authMethod == null) {
    return { canRecord: false, reason: 'not_signed_in' };
  }

  // API key users always have full permissions - can't scope API keys
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

  // The answer has not arrived. Waiting is honest; gating is not.
  if (!isLoaded && hasWritePermission == null) {
    return { canRecord: false, reason: 'checking' };
  }

  // OAuth user whose token is known not to carry write - block recording
  return { canRecord: false, reason: 'no_permission' };
}
