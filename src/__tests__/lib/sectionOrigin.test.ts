/**
 * Scenario: an insight opens a section's page. The page opens on All time when it was opened from
 * the insights page, and on the default window from anywhere else.
 *
 * Expected behaviour: a section path from an insight carries the insights origin, a route path is
 * returned unchanged since a route already opens on All time, and the origin alone selects All.
 */

import { fromInsightsPath, sectionOpenRange } from '@/shared/app/sectionOrigin';

describe('fromInsightsPath', () => {
  it('marks a section path with the origin', () => {
    expect(fromInsightsPath('/section/s1')).toBe('/section/s1?origin=insights');
  });

  it('adds the origin to a section path that already has a query', () => {
    expect(fromInsightsPath('/section/s1?activityId=a1')).toBe(
      '/section/s1?activityId=a1&origin=insights'
    );
  });

  it('leaves a route path as it is', () => {
    expect(fromInsightsPath('/route/r1')).toBe('/route/r1');
  });
});

describe('sectionOpenRange', () => {
  it('opens on All time from the insights origin', () => {
    expect(sectionOpenRange('insights')).toBe('all');
  });

  it('opens on the default window from any other origin or none', () => {
    expect(sectionOpenRange(undefined)).toBe('6m');
    expect(sectionOpenRange('sections')).toBe('6m');
  });
});
