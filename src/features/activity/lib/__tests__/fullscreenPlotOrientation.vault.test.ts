/**
 * Scenario: a phone is turned into landscape for the full-screen plot, but a window that is
 * already wide and tall enough for the regular-width layouts is never rotated for it. A tablet
 * window, a foldable's inner display or a resized window lays the modal out in the frame it has,
 * and a landscape lock left behind on close strands the activity screen in a landscape window.
 *
 * Expected behaviour: a compact window keeps the landscape-only plot and hands portrait back on
 * close; a regular window takes whatever orientation it is held in and requests no lock on open
 * or on close. The choice follows the window, not the device idiom.
 */
import { OrientationLock } from 'expo-screen-orientation';
import { fullscreenPlotOrientation } from '../fullscreenPlotOrientation';

const PHONE_PORTRAIT = { width: 393, height: 852 };
const PHONE_LANDSCAPE = { width: 852, height: 393 };
const FOLDED_PORTRAIT = { width: 466, height: 678 };
const FOLDED_TURNED = { width: 678, height: 466 };
const OPEN_BOOK = { width: 951, height: 669 };
const OPEN_PORTRAIT = { width: 669, height: 951 };
const TABLET = { width: 820, height: 1180 };

const PHONE_PLOT = {
  supportedOrientations: ['landscape-left', 'landscape-right'],
  lockOnOpen: OrientationLock.LANDSCAPE,
  lockOnClose: OrientationLock.PORTRAIT_UP,
};

describe('fullscreenPlotOrientation', () => {
  it('holds an iPhone in landscape while open and hands back portrait on close', () => {
    expect(fullscreenPlotOrientation({ os: 'ios', window: PHONE_PORTRAIT })).toEqual(PHONE_PLOT);
  });

  it('holds an Android phone in landscape while open and hands back portrait on close', () => {
    expect(fullscreenPlotOrientation({ os: 'android', window: PHONE_PORTRAIT })).toEqual(
      PHONE_PLOT
    );
  });

  it('keeps a phone on its side as a phone, since its height is compact', () => {
    expect(fullscreenPlotOrientation({ os: 'ios', window: PHONE_LANDSCAPE })).toEqual(PHONE_PLOT);
  });

  it('keeps a foldable folded display as a phone in both poses', () => {
    expect(fullscreenPlotOrientation({ os: 'ios', window: FOLDED_PORTRAIT })).toEqual(PHONE_PLOT);
    expect(fullscreenPlotOrientation({ os: 'ios', window: FOLDED_TURNED })).toEqual(PHONE_PLOT);
  });

  it.each([
    ['a tablet window', TABLET],
    ['an unfolded display held like a book', OPEN_BOOK],
    ['an unfolded display held upright', OPEN_PORTRAIT],
  ])('lets %s keep the orientation it is held in and requests no lock', (_name, window) => {
    const orientation = fullscreenPlotOrientation({ os: 'ios', window });
    expect(orientation.supportedOrientations).toEqual([
      'portrait',
      'portrait-upside-down',
      'landscape-left',
      'landscape-right',
    ]);
    expect(orientation.lockOnOpen).toBeNull();
    expect(orientation.lockOnClose).toBeNull();
  });
});
