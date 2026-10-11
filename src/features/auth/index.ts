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
  oauthFailureKey,
  type OAuthFlowResult,
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

export { recordGrantedScope } from './lib/grantedScope';

export { demoEntryAction, resolveStoredActivityCount } from './lib/storedActivityCount';

export {
  useApiKeyLogin,
  useOAuthLogin,
  useApiKeyPrefill,
  useSessionExpiryNotice,
  type SessionExpiryNotice,
} from './hooks';

export {
  LanguagePicker,
  OAuthLoginForm,
  ApiKeyLoginForm,
  SessionExpiredNotice,
} from './components';
