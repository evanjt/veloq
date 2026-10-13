import type { ModalProps } from 'react-native';
import { OrientationLock } from 'expo-screen-orientation';

export interface FullscreenPlotOrientation {
  /** The orientations the full-screen modal's own controller accepts. */
  supportedOrientations: NonNullable<ModalProps['supportedOrientations']>;
  /** The lock requested while the plot is open, or null to request none. */
  lockOnOpen: OrientationLock | null;
  /** The lock requested when the plot closes or unmounts, or null to request none. */
  lockOnClose: OrientationLock | null;
}

/**
 * The orientation the app runs in everywhere but the full-screen plot, as
 * `app.json` pins it. The way back from the plot is this lock, not
 * `unlockAsync`: on Android that requests an unspecified orientation, which
 * outranks the manifest's portrait and leaves every screen free to rotate.
 */
const APP_ORIENTATION_LOCK = OrientationLock.PORTRAIT_UP;

/**
 * The orientation of the full-screen plot. A phone is turned into landscape for
 * it and handed back the app's portrait lock on close. An iPad running the app
 * full screen is never rotated for an app, so a landscape request there is not
 * honoured: the modal would be laid out in a landscape frame inside the portrait
 * window, and the lock left behind on close strands the activity screen in a
 * landscape window. On an iPad the plot takes the orientation it is held in and
 * requests no lock.
 */
export function fullscreenPlotOrientation({
  os,
  isPad,
}: {
  os: string;
  isPad: boolean;
}): FullscreenPlotOrientation {
  if (os === 'ios' && isPad) {
    return {
      supportedOrientations: [
        'portrait',
        'portrait-upside-down',
        'landscape-left',
        'landscape-right',
      ],
      lockOnOpen: null,
      lockOnClose: null,
    };
  }
  return {
    supportedOrientations: ['landscape-left', 'landscape-right'],
    lockOnOpen: OrientationLock.LANDSCAPE,
    lockOnClose: APP_ORIENTATION_LOCK,
  };
}
