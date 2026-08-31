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
  buildAuthorizationUrl,
  parseCallbackUrl,
  validateState,
  getAppRedirectUri,
  getProxyRedirectUri,
  INTERVALS_URLS,
  type OAuthTokenResponse,
} from './lib/oauth';

export {
  accountChangeAction,
  confirmAccountChange,
  getCachedAthleteId,
  type AccountChangeKind,
} from './lib/accountChange';

export {
  useApiKeyLogin,
  useOAuthLogin,
  useBackupRestore,
  useSessionExpiryNotice,
  type DetectedBackup,
  type SessionExpiryNotice,
} from './hooks';

export {
  LanguagePicker,
  OAuthLoginForm,
  ApiKeyLoginForm,
  BackupRestoreBanner,
  SessionExpiredNotice,
} from './components';
