/**
 * Scenario: the first-run tour opens on three slides of its own, the first load, the feed and an
 * activity, which were added with text alone and showed a large empty field under it.
 *
 * Expected behaviour: each of the three draws its picture, and the demo track and elevation it is
 * drawn from stay inside the panel they are drawn in.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { getTutorialSlides } from '@/features/settings/components/whatsNew/slides';
import {
  DEMO_TRACK_COUNT,
  demoElevationPath,
  demoTrackPath,
} from '@/features/settings/lib/tourActivityDemo';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

function slideOf(titleKey: string) {
  const slide = getTutorialSlides().find((s) => s.titleKey === titleKey);
  if (!slide) throw new Error(`no tour slide titled ${titleKey}`);
  return slide;
}

/** Every x,y pair a path's commands name. */
function points(path: string): { x: number; y: number }[] {
  return [...path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

describe('the first-run tour pictures', () => {
  it.each([
    ['whatsNew.tutorial.firstLoadTitle', 'tour-first-load-picture'],
    ['whatsNew.tutorial.feedTitle', 'tour-feed-picture'],
    ['whatsNew.tutorial.activityTitle', 'tour-activity-picture'],
  ])('%s draws its picture', (titleKey, testID) => {
    const { Component } = slideOf(titleKey);
    render(<Component />);
    expect(screen.getByTestId(testID)).toBeTruthy();
  });
});

describe('the demo activity the pictures draw', () => {
  it.each(Array.from({ length: DEMO_TRACK_COUNT }, (_, i) => i))(
    'fits track %i inside its square, clear of the padding',
    (index) => {
      const size = 56;
      const pad = 8;
      const track = points(demoTrackPath(index, size, pad));
      expect(track.length).toBeGreaterThan(2);
      for (const { x, y } of track) {
        expect(x).toBeGreaterThanOrEqual(pad - 1e-9);
        expect(x).toBeLessThanOrEqual(size - pad + 1e-9);
        expect(y).toBeGreaterThanOrEqual(pad - 1e-9);
        expect(y).toBeLessThanOrEqual(size - pad + 1e-9);
      }
    }
  );

  it('draws the elevation across the panel, top to bottom of the clear area', () => {
    const line = points(demoElevationPath(140, 96, 10, false));
    const xs = line.map((p) => p.x);
    const ys = line.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...xs)).toBeCloseTo(130);
    expect(Math.min(...ys)).toBeCloseTo(10);
    expect(Math.max(...ys)).toBeCloseTo(86);
  });

  it('closes the filled elevation along the bottom edge', () => {
    expect(demoElevationPath(140, 96, 10, true)).toMatch(/L130,86 L10,86 Z$/);
  });
});
