/**
 * Scenario: the full-screen plot is the one surface held in landscape. There
 * the sensor housing sits on one side edge, the home indicator or a three-button
 * navigation bar on another, and which side depends on the rotation.
 *
 * Expected behaviour: every side is padded by at least its own inset, the close
 * button sits inside that padding, and the plot is sized from the room the
 * chrome leaves rather than from the window minus a constant.
 */
import { fullscreenPlotFrame } from '../fullscreenPlotFrame';

const MARGIN = 16;

const LANDSCAPE_LEFT = { top: 0, right: 0, bottom: 21, left: 59 };
const LANDSCAPE_RIGHT = { top: 0, right: 59, bottom: 21, left: 0 };
const NAV_BAR_ON_RIGHT = { top: 24, right: 48, bottom: 0, left: 0 };
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const FRAME_HEIGHT = 440;
const CHROME_HEIGHT = 44;

describe('fullscreenPlotFrame', () => {
  it('pads the cutout side by its inset in both landscape rotations', () => {
    const left = fullscreenPlotFrame(LANDSCAPE_LEFT, FRAME_HEIGHT, CHROME_HEIGHT);
    expect(left.padding.left).toBe(59);
    expect(left.padding.right).toBe(MARGIN);

    const right = fullscreenPlotFrame(LANDSCAPE_RIGHT, FRAME_HEIGHT, CHROME_HEIGHT);
    expect(right.padding.right).toBe(59);
    expect(right.padding.left).toBe(MARGIN);
  });

  it('keeps the plot clear of the home indicator', () => {
    expect(fullscreenPlotFrame(LANDSCAPE_LEFT, FRAME_HEIGHT, CHROME_HEIGHT).padding.bottom).toBe(
      21
    );
  });

  it('keeps the side navigation bar and the status bar clear', () => {
    const frame = fullscreenPlotFrame(NAV_BAR_ON_RIGHT, FRAME_HEIGHT, CHROME_HEIGHT);
    expect(frame.padding.right).toBe(48);
    expect(frame.padding.top).toBe(24);
  });

  it('keeps the margin where the edge has no inset', () => {
    expect(fullscreenPlotFrame(NO_INSETS, FRAME_HEIGHT, CHROME_HEIGHT).padding).toEqual({
      top: MARGIN,
      right: MARGIN,
      bottom: MARGIN,
      left: MARGIN,
    });
  });

  it('places the close button inside the leading inset, at a top that ignores it', () => {
    const left = fullscreenPlotFrame(LANDSCAPE_LEFT, FRAME_HEIGHT, CHROME_HEIGHT);
    const right = fullscreenPlotFrame(LANDSCAPE_RIGHT, FRAME_HEIGHT, CHROME_HEIGHT);

    expect(left.closeButton.left).toBe(59);
    expect(right.closeButton.left).toBe(MARGIN);
    expect(left.closeButton.top).toBe(right.closeButton.top);
    expect(left.closeButton.top).toBe(MARGIN);
  });

  it('sizes the plot to the room left under the chrome and above the bottom inset', () => {
    for (const insets of [LANDSCAPE_LEFT, LANDSCAPE_RIGHT, NAV_BAR_ON_RIGHT, NO_INSETS]) {
      const frame = fullscreenPlotFrame(insets, FRAME_HEIGHT, CHROME_HEIGHT);
      expect(frame.plotHeight).toBe(
        FRAME_HEIGHT - frame.padding.top - CHROME_HEIGHT - frame.padding.bottom
      );
      expect(frame.plotHeight).toBeLessThanOrEqual(
        FRAME_HEIGHT - CHROME_HEIGHT - insets.bottom - insets.top
      );
    }
  });

  it('gives a wrapped chip row its height back from the plot', () => {
    const oneRow = fullscreenPlotFrame(LANDSCAPE_LEFT, FRAME_HEIGHT, CHROME_HEIGHT);
    const twoRows = fullscreenPlotFrame(LANDSCAPE_LEFT, FRAME_HEIGHT, CHROME_HEIGHT * 2);
    expect(oneRow.plotHeight - twoRows.plotHeight).toBe(CHROME_HEIGHT);
  });

  it('never returns a negative plot height on a window too short for the chrome', () => {
    expect(fullscreenPlotFrame(LANDSCAPE_LEFT, 60, CHROME_HEIGHT).plotHeight).toBe(0);
  });
});
