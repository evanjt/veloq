import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { callbackUrlFromParams, holdInterruptedCallback, useAuthStore } from '@/features/auth';
import { goBack, replaceTo } from '@/shared/app/navigation';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/**
 * Where the OAuth redirect deep link lands.
 *
 * When this process opened the browser, the redirect is consumed by
 * openAuthSessionAsync inside the auth/upgrade hooks; on Android the singleTask
 * activity ALSO receives the same veloq://oauth/callback URL as a deep link,
 * which expo-router would otherwise render as Unmatched Route, so this screen
 * renders nothing and dismisses itself.
 *
 * When the process that opened the browser was killed while it was in front,
 * the redirect is what started this one. Signed out, it is held for the
 * sign-in screen, which completes the flow from the keychain or says it was
 * interrupted. The root layout mounts no route until the stored credential is
 * read, so the signed-in state is settled here.
 */
function OAuthCallbackScreenContent() {
  const params = useLocalSearchParams();
  // The link this screen was opened with, read once.
  const [url] = useState(() => callbackUrlFromParams(params));

  useEffect(() => {
    const held = !useAuthStore.getState().isAuthenticated && holdInterruptedCallback(url);
    if (held && !router.canGoBack()) {
      replaceTo('/login');
    } else {
      goBack();
    }
  }, [url]);

  return <View style={{ flex: 1 }} />;
}

export default withScreenBoundary(OAuthCallbackScreenContent, 'OAuthCallback');
