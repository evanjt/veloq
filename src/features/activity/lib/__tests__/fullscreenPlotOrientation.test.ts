/**
 * Scenario: a phone is turned into landscape for the full-screen plot, but an
 * iPad running the app full screen is never rotated for it. There a modal that
 * claims landscape is laid out in a landscape frame inside the portrait window,
 * and a landscape lock left behind on close leaves the activity screen clipped.
 *
 * Expected behaviour: phones keep the landscape-only plot and hand portrait
 * back on close; an iPad takes whatever orientation it is held in and requests
 * no lock on open or on close.
 */
import { OrientationLock } from 'expo-screen-orientation';
import { fullscreenPlotOrientation } from '../fullscreenPlotOrientation';

describe('fullscreenPlotOrientation', () => {
  it('holds an iPhone in landscape while open and hands back portrait on close', () => {
    expect(fullscreenPlotOrientation({ os: 'ios', isPad: false })).toEqual({
      supportedOrientations: ['landscape-left', 'landscape-right'],
      lockOnOpen: OrientationLock.LANDSCAPE,
      lockOnClose: OrientationLock.PORTRAIT_UP,
    });
  });

  it('holds an Android phone in landscape while open and hands back portrait on close', () => {
    expect(fullscreenPlotOrientation({ os: 'android', isPad: false })).toEqual({
      supportedOrientations: ['landscape-left', 'landscape-right'],
      lockOnOpen: OrientationLock.LANDSCAPE,
      lockOnClose: OrientationLock.PORTRAIT_UP,
    });
  });

  it('lets an iPad keep the orientation it is held in and requests no lock', () => {
    const orientation = fullscreenPlotOrientation({ os: 'ios', isPad: true });
    expect(orientation.supportedOrientations).toEqual([
      'portrait',
      'portrait-upside-down',
      'landscape-left',
      'landscape-right',
    ]);
    expect(orientation.lockOnOpen).toBeNull();
    expect(orientation.lockOnClose).toBeNull();
  });

  it('reads isPad only on iOS', () => {
    expect(fullscreenPlotOrientation({ os: 'android', isPad: true }).lockOnOpen).toBe(
      OrientationLock.LANDSCAPE
    );
  });
});
