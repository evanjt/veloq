import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/shared/app/AuthStore';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
  recordGrantedScope,
  oauthFailureKey,
  OAUTH,
} from '@/features/auth';
import { useIsOnline } from '@/shared/app/NetworkContext';
import { clearPermissionBlocked } from '@/features/recording/lib/storage/recordingLibrary';
import { debug } from '@/shared/debug/debug';

const log = debug.create('PermissionUpgrade');

/** How one upgrade ended: `error` is null when it was granted or cancelled. */
export interface PermissionUpgradeResult {
  granted: boolean;
  error: string | null;
}

export interface UsePermissionUpgrade {
  upgradePermissions: () => Promise<PermissionUpgradeResult>;
  isUpgrading: boolean;
  error: string | null;
}

export function usePermissionUpgrade(): UsePermissionUpgrade {
  const { t } = useTranslation();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOnline = useIsOnline();

  const upgradePermissions = useCallback(async (): Promise<PermissionUpgradeResult> => {
    const fail = (message: string): PermissionUpgradeResult => {
      setError(message);
      return { granted: false, error: message };
    };

    if (!isOAuthConfigured()) {
      return fail(t('login.oauthNotConfigured', { defaultValue: 'OAuth is not configured' }));
    }

    // The flow registers with the proxy before the browser opens, so offline
    // it can only fail, and what it fails with is the platform's English.
    if (!isOnline) {
      return fail(t('login.oauthUnreachable'));
    }

    setIsUpgrading(true);
    setError(null);

    try {
      const result = await startOAuthFlow(OAUTH.UPGRADE_SCOPES);

      if (result.outcome === 'success') {
        const expectedPrefix = getAppRedirectUri();
        if (!result.url.startsWith(expectedPrefix)) {
          return fail(t('login.oauthInvalidCallback', { defaultValue: 'Invalid OAuth callback' }));
        }

        const tokenResponse = await handleOAuthCallback(result.url);
        const currentAthleteId = useAuthStore.getState().athleteId;
        const consentedAthleteId = String(tokenResponse.athlete_id);
        if (consentedAthleteId !== currentAthleteId) {
          return fail(`${t('alerts.accountChangeTitle')} (${consentedAthleteId})`);
        }
        await useAuthStore
          .getState()
          .setOAuthCredentials(
            tokenResponse.access_token,
            tokenResponse.athlete_id,
            tokenResponse.athlete_name
          );

        // Trust only the scope the server actually returned - a missing scope
        // string means write was NOT confirmed, regardless of what we asked for.
        const granted = recordGrantedScope(tokenResponse.scope);

        if (!granted) {
          return fail(
            t('recording.writeScopeNotGranted', {
              defaultValue: 'Write permission was not granted',
            })
          );
        }
        // Requeue this athlete's permission-blocked entries, and nobody
        // else's; the queue processor re-drains when needsUpgrade flips false.
        await clearPermissionBlocked(consentedAthleteId);
        log.log('Successfully upgraded to write scope');
        return { granted: true, error: null };
      }

      if (result.outcome === 'failed') {
        return fail(t('login.oauthFailed'));
      }
      // The athlete cancelled, so the API key session stays as it was.
      return { granted: false, error: null };
    } catch (err) {
      log.warn(`Permission upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
      return fail(t(oauthFailureKey(err)));
    } finally {
      setIsUpgrading(false);
    }
  }, [t, isOnline]);

  return { upgradePermissions, isUpgrading, error };
}
