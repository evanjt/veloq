import { useUploadPermissionStore } from '@/features/recording';

/**
 * The one writer of the scope an OAuth grant returned. Only the scope the
 * server sent counts: a missing string means write was not confirmed, whatever
 * the request asked for.
 */
export function recordGrantedScope(scope: string | undefined): boolean {
  useUploadPermissionStore.getState().setFromOAuthScope(scope ?? '');
  return useUploadPermissionStore.getState().hasWritePermission === true;
}
