/**
 * Scenario: the regional map built a LineString per activity and handed the
 * whole set to the page on every mount and every `activities` event, at world
 * zoom, where the trace layer draws nothing. About 0.7 MB of JSON at 490
 * activities, stringified, injected and tiled for no pixels.
 *
 * Expected behaviour: nothing is sent below the zoom the layer starts at, and
 * above it only what the camera holds, at every library size.
 */

import { traceSubjects } from '@/features/maps/lib/traceBudget';

const THRESHOLD = 11;

interface Activity {
  id: string;
}

function library(count: number): Activity[] {
  return Array.from({ length: count }, (_, i) => ({ id: `a${i}` }));
}

function subjects(
  activities: Activity[],
  zoom: number | null,
  visibleIds: Set<string> | null = null
): Activity[] {
  return traceSubjects({
    activities,
    visibleIds,
    zoom,
    threshold: THRESHOLD,
    id: (a) => a.id,
  });
}

describe('which traces reach the page', () => {
  it('is nothing at world zoom, where the layer draws none', () => {
    expect(subjects(library(490), 3)).toEqual([]);
  });

  it('is nothing one step below the threshold', () => {
    expect(subjects(library(490), THRESHOLD - 0.01)).toEqual([]);
  });

  it('is everything at the threshold itself, which is where the layer starts', () => {
    expect(subjects(library(5), THRESHOLD)).toHaveLength(5);
  });

  it('is nothing before the camera has reported a zoom, which is the opening frame', () => {
    expect(subjects(library(490), null)).toEqual([]);
  });

  it('is what the camera holds once it has reported', () => {
    const activities = library(100);
    const visible = new Set(['a3', 'a7', 'a11']);

    const sent = subjects(activities, 14, visible);

    expect(sent.map((a) => a.id)).toEqual(['a3', 'a7', 'a11']);
  });

  it('culls at a small library too, not only past the clustering threshold', () => {
    const activities = library(12);
    expect(subjects(activities, 14, new Set(['a1']))).toHaveLength(1);
  });

  it('is everything in view when the camera has reported no ids yet', () => {
    expect(subjects(library(8), 14, null)).toHaveLength(8);
  });

  it('is nothing when the camera holds nothing', () => {
    expect(subjects(library(8), 14, new Set())).toEqual([]);
  });

  it('keeps the input order, so the page patches the same sequence', () => {
    const activities = library(6);
    const sent = subjects(activities, 14, new Set(['a5', 'a0', 'a2']));
    expect(sent.map((a) => a.id)).toEqual(['a0', 'a2', 'a5']);
  });

  it('sends nothing for an empty library at any zoom', () => {
    expect(subjects([], 18)).toEqual([]);
    expect(subjects([], 1)).toEqual([]);
  });
});
