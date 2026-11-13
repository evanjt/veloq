/**
 * Scenario: the strength body diagram shades each trained muscle by one of five
 * volume steps and draws every other muscle in an untrained fill. In the light
 * theme the untrained fill was the darkest thing on the figure, so a muscle with
 * no work outranked one with a little.
 *
 * Expected behaviour: untrained sits closer to the page than every volume step
 * and carries its own outline, the steps stay apart from each other, and the
 * selected muscle is outlined in the primary text colour, in both themes.
 */

import { bodyDiagram, colourTokens, colors, darkColors, sequentialRamp } from '@/theme';

import { contrastRatio } from '../__shared__/contrast';

const THEMES = ['light', 'dark'] as const;

describe.each(THEMES)('the body diagram in the %s theme', (theme) => {
  const roles = bodyDiagram[theme];
  const token = colourTokens[theme];
  const page = (theme === 'dark' ? darkColors : colors).surfacePage;

  it('draws untrained in the neutral fill, outlined in the track colour', () => {
    expect(roles.untrained).toBe(token['fill-neutral']);
    expect(roles.untrainedStroke).toBe(token.track);
  });

  it('shades volume through the five sequential steps', () => {
    expect(roles.steps).toEqual(sequentialRamp[theme]);
  });

  it('never draws untrained further from the page than the lightest volume', () => {
    const untrained = contrastRatio(roles.untrained, page);
    for (const step of roles.steps) {
      expect(contrastRatio(step, page)).toBeGreaterThan(untrained);
    }
  });

  it('keeps each step distinct from the one beside it', () => {
    for (let i = 1; i < roles.steps.length; i++) {
      expect(contrastRatio(roles.steps[i - 1]!, roles.steps[i]!)).toBeGreaterThan(1.1);
    }
  });

  it('outlines untrained at the mark bar against the page', () => {
    expect(contrastRatio(roles.untrainedStroke, page)).toBeGreaterThanOrEqual(3);
  });

  it('outlines the selected muscle in the primary text colour', () => {
    expect(roles.selectedStroke).toBe(token['text-primary']);
  });
});
