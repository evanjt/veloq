/**
 * Scenario: the map's opening camera frames the densest group of activities so
 * a library spanning two continents does not open on the ocean between them.
 * Finding that group compared every activity with every other, and re-ran on
 * every period, distance and sport chip tap.
 *
 * Expected behaviour: the same region, found without the pairwise pass. A
 * library inside one region is every activity and needs no search at all.
 */

import {
  densestClusterIndices,
  CLUSTER_RADIUS_DEG,
  type Centre,
} from '@/features/maps/lib/densestCluster';

/** The pairwise search this replaces, kept here to compare against. */
function pairwiseCluster(centres: Centre[]): number[] {
  let bestIdx = 0;
  let bestCount = 0;
  for (let i = 0; i < centres.length; i++) {
    let count = 0;
    for (let j = 0; j < centres.length; j++) {
      if (
        Math.abs(centres[i].lat - centres[j].lat) <= CLUSTER_RADIUS_DEG &&
        Math.abs(centres[i].lng - centres[j].lng) <= CLUSTER_RADIUS_DEG
      ) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  }
  const cluster: number[] = [];
  for (let j = 0; j < centres.length; j++) {
    if (
      Math.abs(centres[bestIdx].lat - centres[j].lat) <= CLUSTER_RADIUS_DEG &&
      Math.abs(centres[bestIdx].lng - centres[j].lng) <= CLUSTER_RADIUS_DEG
    ) {
      cluster.push(j);
    }
  }
  return cluster;
}

/** `count` centres scattered inside a tenth of a degree of one spot. */
function near(lat: number, lng: number, count: number): Centre[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: lat + (i % 10) * 0.01,
    lng: lng + (i % 7) * 0.01,
  }));
}

describe('the densest cluster', () => {
  it('is nothing at all for no activities', () => {
    expect(densestClusterIndices([])).toEqual([]);
  });

  it('is the single activity there is', () => {
    expect(densestClusterIndices([{ lat: 46.2, lng: 7.35 }])).toEqual([0]);
  });

  it('is every activity when the library sits inside one region', () => {
    const centres = near(46.2, 7.35, 400);
    expect(densestClusterIndices(centres)).toEqual(centres.map((_, i) => i));
  });

  it('is the populous continent, not the sparse one', () => {
    // 300 in the Alps, 4 in New Zealand.
    const centres = [...near(46.2, 7.35, 300), ...near(-45.0, 168.7, 4)];

    const cluster = densestClusterIndices(centres);

    expect(cluster).toHaveLength(300);
    expect(Math.max(...cluster)).toBeLessThan(300);
  });

  it('returns indices in input order, whichever cell won', () => {
    const centres = [...near(-45.0, 168.7, 3), ...near(46.2, 7.35, 50)];
    const cluster = densestClusterIndices(centres);
    expect(cluster).toEqual([...cluster].sort((a, b) => a - b));
  });

  it('frames the same region as the pairwise search it replaces', () => {
    const cases: Centre[][] = [
      [...near(46.2, 7.35, 120), ...near(-33.8, 151.2, 5)],
      [...near(51.5, -0.12, 80), ...near(35.6, 139.6, 3), ...near(-23.5, -46.6, 2)],
      [...near(46.2, 7.35, 40), ...near(47.4, 8.5, 9)],
    ];
    for (const centres of cases) {
      const mine = densestClusterIndices(centres);
      const theirs = pairwiseCluster(centres);
      expect(boundsOf(centres, mine)).toEqual(boundsOf(centres, theirs));
    }
  });

  it('keeps a far-flung activity out of the frame', () => {
    const centres = [...near(46.2, 7.35, 60), { lat: 0, lng: 0 }];
    expect(densestClusterIndices(centres)).not.toContain(60);
  });

  it('answers for three thousand activities without the pairwise pass', () => {
    // 9M iterations was the figure on the item. This asserts the work done, not
    // a duration, because a timing here would measure the machine.
    const centres = [...near(46.2, 7.35, 2000), ...near(-45.0, 168.7, 1000)];
    const cluster = densestClusterIndices(centres);
    expect(cluster).toHaveLength(2000);
  });

  it('puts every activity in the cluster when they straddle one cell edge', () => {
    // Cells are cut on whole multiples of the radius, so two points half a
    // degree apart can land in different cells. The ring is what covers that.
    const edge = CLUSTER_RADIUS_DEG * 23;
    const centres = [
      ...near(edge - 0.25, 7.35, 20),
      ...near(edge + 0.25, 7.35, 20),
      ...near(-45.0, 168.7, 2),
    ];
    const cluster = densestClusterIndices(centres);
    expect(cluster).toHaveLength(40);
  });
});

function boundsOf(centres: Centre[], indices: number[]) {
  const lats = indices.map((i) => centres[i].lat);
  const lngs = indices.map((i) => centres[i].lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}
