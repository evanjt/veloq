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
  launchIdentityAction,
  completeLaunchIdentity,
  type LaunchIdentityAction,
} from './lib/launchIdentity';

export {
  accountChangeAction,
  confirmAccountChange,
  promptAccountMismatch,
  UNNAMED_LIBRARY,
  getCachedAthleteId,
  type AccountChangeKind,
} from './lib/accountChange';

export { demoEntryAction, resolveStoredActivityCount } from './lib/storedActivityCount';

export {
  useApiKeyLogin,
  useOAuthLogin,
  useBackupRestore,
  useApiKeyPrefill,
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
