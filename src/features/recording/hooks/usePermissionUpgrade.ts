import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
  OAUTH,
} from '@/features/auth';
import { clearPermissionBlocked } from '@/features/recording/lib/storage/recordingLibrary';
import { debug } from '@/shared/debug/debug';

const log = debug.create('PermissionUpgrade');

export interface UsePermissionUpgrade {
  upgradePermissions: () => Promise<boolean>;
  isUpgrading: boolean;
  error: string | null;
}

export function usePermissionUpgrade(): UsePermissionUpgrade {
  const { t } = useTranslation();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upgradePermissions = useCallback(async (): Promise<boolean> => {
    if (!isOAuthConfigured()) {
      setError(t('login.oauthNotConfigured', { defaultValue: 'OAuth is not configured' }));
      return false;
    }

    setIsUpgrading(true);
    setError(null);

    try {
      const result = await startOAuthFlow(OAUTH.UPGRADE_SCOPES);

      if (result.type === 'success' && result.url) {
        const expectedPrefix = getAppRedirectUri();
        if (!result.url.startsWith(expectedPrefix)) {
          setError(t('login.oauthInvalidCallback', { defaultValue: 'Invalid OAuth callback' }));
          return false;
        }

        const tokenResponse = handleOAuthCallback(result.url);
        await useAuthStore
          .getState()
          .setOAuthCredentials(
            tokenResponse.access_token,
            tokenResponse.athlete_id,
            tokenResponse.athlete_name
          );

        // Trust only the scope the server actually returned - a missing scope
        // string means write was NOT confirmed, regardless of what we asked for.
        useUploadPermissionStore.getState().setFromOAuthScope(tokenResponse.scope ?? '');
        const granted = useUploadPermissionStore.getState().hasWritePermission === true;

        if (granted) {
          // Requeue permission-blocked entries; the queue processor re-drains
          // when needsUpgrade flips false.
          await clearPermissionBlocked();
          log.log('Successfully upgraded to write scope');
        } else {
          setError(
            t('recording.writeScopeNotGranted', {
              defaultValue: 'Write permission was not granted',
            })
          );
        }
        return granted;
      }

      // User cancelled - preserve API key auth
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OAuth failed';
      setError(msg);
      log.warn(`Permission upgrade failed: ${msg}`);
      return false;
    } finally {
      setIsUpgrading(false);
    }
  }, [t]);

  return { upgradePermissions, isUpgrading, error };
}
