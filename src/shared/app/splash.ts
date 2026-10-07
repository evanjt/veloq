import * as SplashScreen from 'expo-splash-screen';

// The native splash stays up until the first screen is ready, so the athlete
// sees one launch screen rather than the splash followed by a spinner.
void SplashScreen.preventAutoHideAsync().catch(() => {});

let released = false;

/** Hides the native splash once; later calls and a rejected hide do nothing. */
export function releaseSplash(): void {
  if (released) return;
  released = true;
  void SplashScreen.hideAsync().catch(() => {});
}
