export {
  useAuthStore,
  getStoredCredentials,
  DEMO_ATHLETE_ID,
  type AuthMethod,
  type SessionExpiredReason,
} from '@/shared/app/AuthStore';

export { OAUTH } from './constants';

export {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getOAuthClientId,
  buildAuthorizationUrl,
  parseCallbackUrl,
  validateState,
  getAppRedirectUri,
  getProxyRedirectUri,
  INTERVALS_URLS,
  type OAuthTokenResponse,
  type OAuthError,
} from './lib/oauth';

export {
  confirmAccountChange,
  getCachedAthleteId,
  type AccountChangeKind,
} from './lib/accountChange';

export { useApiKeyLogin, useOAuthLogin, useBackupRestore, type DetectedBackup } from './hooks';

export { LanguagePicker, OAuthLoginForm, ApiKeyLoginForm, BackupRestoreBanner } from './components';
