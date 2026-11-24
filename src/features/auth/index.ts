export { useAuthStore } from '@/shared/app/AuthStore';

export { OAUTH } from './constants';

export {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
  INTERVALS_URLS,
  oauthFailureKey,
  holdInterruptedCallback,
  callbackUrlFromParams,
} from './lib/oauth';

export { launchIdentityAction, completeLaunchIdentity } from './lib/launchIdentity';

export {
  confirmAccountChange,
  promptAccountMismatch,
  UNNAMED_LIBRARY,
  getCachedAthleteId,
  nameLibrary,
} from './lib/accountChange';

export { recordGrantedScope } from './lib/grantedScope';

export { demoEntryAction } from './lib/storedActivityCount';

export {
  useApiKeyLogin,
  useGarminLogin,
  useOAuthLogin,
  useApiKeyPrefill,
  useSessionExpiryNotice,
} from './hooks';

export {
  LanguagePicker,
  OAuthLoginForm,
  ApiKeyLoginForm,
  GarminLoginForm,
  SessionExpiredNotice,
} from './components';
