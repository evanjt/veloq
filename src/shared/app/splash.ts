import * as SplashScreen from 'expo-splash-screen';

// The native splash stays up until the first screen is ready, so the athlete
// sees one launch screen rather than the splash followed by a spinner.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// The hand-off cross-fades into the first screen. iOS cuts without `fade`, and
// Android takes the same `duration` for its exit, so one value serves both.
try {
  SplashScreen.setOptions({ fade: true, duration: 300 });
} catch {
  // Without the native module the splash keeps its default hand-off.
}

let released = false;

/** Hides the native splash once; later calls and a rejected hide do nothing. */
export function releaseSplash(): void {
  if (released) return;
  released = true;
  void SplashScreen.hideAsync().catch(() => {});
}
