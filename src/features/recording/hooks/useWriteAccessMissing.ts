import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

/**
 * True when an OAuth athlete's token carries no confirmed write scope, so a save
 * stays on the device. Undecided until the stored permission has loaded, so a
 * prompt never flashes for a token that turns out to carry it. API-key sign-ins
 * carry every permission, and a demo athlete never uploads.
 */
export function useWriteAccessMissing(): boolean {
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const isLoaded = useUploadPermissionStore((s) => s.isLoaded);
  return isLoaded && authMethod === 'oauth' && hasWritePermission !== true;
}
