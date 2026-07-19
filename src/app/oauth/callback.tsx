import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

/**
 * Absorber for the OAuth redirect deep link. The token in the callback URL is
 * consumed by openAuthSessionAsync inside the auth/upgrade hooks; on Android
 * the singleTask activity ALSO receives the same veloq://oauth/callback URL as
 * a deep link, which expo-router would otherwise render as Unmatched Route.
 * This screen renders nothing and immediately dismisses itself.
 */
export default function OAuthCallbackScreen() {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, []);

  return <View />;
}
