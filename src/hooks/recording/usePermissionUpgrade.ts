import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useUploadPermissionStore } from '@/providers';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
} from '@/services/oauth';
import { clearPermissionBlocked } from '@/lib/storage/uploadQueue';
import { debug } from '@/lib/utils/debug';

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
      const result = await startOAuthFlow();

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

        // Clear permission-blocked entries so they retry
        await clearPermissionBlocked();

        // Update permission state from the new OAuth scope
        if (tokenResponse.scope) {
          useUploadPermissionStore.getState().setFromOAuthScope(tokenResponse.scope);
        } else {
          // No scope info — assume write permission was granted since the upgrade flow
          // requests ACTIVITY:WRITE
          useUploadPermissionStore.getState().setHasWritePermission(true);
        }

        log.log('Successfully upgraded to OAuth');
        return true;
      }

      // User cancelled — preserve API key auth
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
