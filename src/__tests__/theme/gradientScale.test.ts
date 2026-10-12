/**
 * Scenario: the activity line coloured by gradient, read by an athlete who
 * cannot tell the hues apart, or on a screen with the colour washed out.
 *
 * Expected behaviour: the scale diverges around flat ground. The 0 % stop is
 * the lightest, and every stop is darker than the one nearer to 0 % on its
 * side, so the order of steepness reads in lightness alone. Each side keeps
 * one hue family, so a descent is never read as a climb.
 */

import { gradientScale } from '@/theme';
import { gradientToColor } from '@/features/maps/lib/gradientLineColor';

function channels(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const flat = gradientScale.find((stop) => stop.percent === 0);
const descents = gradientScale.filter((stop) => stop.percent < 0).reverse();
const climbs = gradientScale.filter((stop) => stop.percent > 0);

describe('the gradient scale', () => {
  it('has a stop at flat ground and stops on both sides of it', () => {
    expect(flat).toBeDefined();
    expect(descents.length).toBeGreaterThan(1);
    expect(climbs.length).toBeGreaterThan(1);
  });

  it('runs in ascending order of percent', () => {
    const percents = gradientScale.map((stop) => stop.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it.each([
    ['descent', descents],
    ['climb', climbs],
  ])('darkens at every stop from flat outward on the %s side', (_side, stops) => {
    const luminances = [flat!, ...stops].map((stop) => relativeLuminance(stop.color));
    for (let i = 1; i < luminances.length; i++) {
      expect(luminances[i]).toBeLessThan(luminances[i - 1]);
    }
  });

  it('darkens between the stops too, at every whole percent', () => {
    const luminanceAt = (percent: number) => relativeLuminance(gradientToColor(percent));
    for (let percent = 1; percent <= 30; percent++) {
      expect(luminanceAt(percent)).toBeLessThan(luminanceAt(percent - 1));
      expect(luminanceAt(-percent)).toBeLessThan(luminanceAt(-(percent - 1)));
    }
  });

  it('keeps descents blue and climbs warm, so the sides never share a hue', () => {
    for (const stop of descents) {
      const [r, , b] = channels(stop.color);
      expect(b).toBeGreaterThan(r);
    }
    for (const stop of climbs) {
      const [r, , b] = channels(stop.color);
      expect(r).toBeGreaterThan(b);
    }
  });

  it('draws flat ground in the neutral, not in either side', () => {
    expect(gradientToColor(0)).toBe(flat!.color.toLowerCase());
  });
});
