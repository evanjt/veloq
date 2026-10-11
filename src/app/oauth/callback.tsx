import { useEffect } from 'react';
import { View } from 'react-native';
import { goBack } from '@/shared/app/navigation';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/**
 * Absorber for the OAuth redirect deep link. The token in the callback URL is
 * consumed by openAuthSessionAsync inside the auth/upgrade hooks; on Android
 * the singleTask activity ALSO receives the same veloq://oauth/callback URL as
 * a deep link, which expo-router would otherwise render as Unmatched Route.
 * This screen renders nothing and immediately dismisses itself.
 */
function OAuthCallbackScreenContent() {
  useEffect(() => {
    goBack();
  }, []);

  return <View />;
}

export default withScreenBoundary(OAuthCallbackScreenContent, 'OAuthCallback');
