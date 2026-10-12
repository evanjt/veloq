/**
 * Scenario: the regional map draws each activity cluster as a teal disc with
 * its count inside, over a light, dark or satellite basemap.
 *
 * Expected behaviour: the count reaches 4.5:1 against the disc as it actually
 * shows, the fill at its opacity over whatever ground lies beneath it.
 */
import {
  buildRegionalLayers,
  CLUSTER_CIRCLE_LAYER_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { composite, contrastRatio } from '../../__shared__/contrast';

// The light basemap's paper, plain white, and black standing in for the
// darkest a dark or satellite basemap gets.
const GROUNDS = ['#FFFFFF', '#F2EFE9', '#000000'];

function clusterLayers(mapStyle: 'light' | 'dark' | 'satellite', isDark: boolean) {
  const layers = buildRegionalLayers({
    isDark,
    mapStyle,
    showActivities: true,
    showSections: false,
    showRoutes: false,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#000000',
  });
  const circle = layers.find((l) => l.id === CLUSTER_CIRCLE_LAYER_ID)!;
  const count = layers.find((l) => l.id === 'cluster-count')!;
  return {
    fill: circle.paint!['circle-color'] as string,
    alpha: circle.paint!['circle-opacity'] as number,
    ink: count.paint!['text-color'] as string,
  };
}

describe.each([
  ['light', false],
  ['dark', true],
  ['satellite', false],
] as const)('the cluster count on the %s basemap', (mapStyle, isDark) => {
  it.each(GROUNDS)('reaches 4.5:1 against the disc over %s', (ground) => {
    const { fill, alpha, ink } = clusterLayers(mapStyle, isDark);
    expect(contrastRatio(ink, composite(fill, ground, alpha))).toBeGreaterThanOrEqual(4.5);
  });
});
