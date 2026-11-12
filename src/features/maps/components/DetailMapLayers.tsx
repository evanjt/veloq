/**
 * What the activity, section and route maps share in their layers menu: the heatmap, sections and
 * routes rows, with the Map tab's keys, and the one hook that reads the athlete's choice for a kind
 * of map and builds the context the map's specs are merged with.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { maps } from 'veloqrs';

import { mapPalette } from '@/theme';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { MapKeyRamp, MapKeySwatch } from './MapKey';
import type { MapLayerRow } from './MapLayersMenu';
import type { MapStyleType } from './mapStyles';
import { heatmapKeyColours } from '../lib/heatmapPaint';
import { useHeatmapGeneration } from '../lib/heatmapGeneration';
import { SECTION_LINE_DASH } from '../lib/mapLineWidths';
import { NO_CONTEXT_LAYER_DATA, sharedContextLayerHold } from '../lib/contextLayerHold';
import type { ContextLayerInput } from '../lib/contextLayerSpecs';
import { useHeatmapPreference, type DetailMapKind } from '../stores/HeatmapPreferenceStore';

const LINE_KEY_COLOURS = 3;

/** What a detail map draws beside its subject. */
export interface DetailLayersOptions {
  /** The id of the section the map's subject is, left out of the library's sections. */
  sectionId?: string | null | undefined;
  /** The id of the route the map's subject is, left out of the library's routes. */
  routeId?: string | null | undefined;
  /** The map is tilted over terrain, so the library lines are drawn at the Map tab's 3D widths. */
  terrain?: boolean | undefined;
}

export interface DetailLayers {
  /** The context layers to merge under the subject, with what the athlete turned on. */
  context: ContextLayerInput;
  /** The layers-menu rows, none when there is nothing to offer. */
  rows: MapLayerRow[];
}

/**
 * The heatmap, the library's sections and its routes on one kind of detail map: each off until
 * turned on, remembered per kind. The heatmap row is absent while settings has the heatmap off.
 */
export function useDetailLayers(
  kind: DetailMapKind,
  mapStyle: MapStyleType,
  isDark: boolean,
  { sectionId = null, routeId = null, terrain = false }: DetailLayersOptions = {}
): DetailLayers {
  const { t } = useTranslation();
  const available = useHeatmapPreference((state) => state.enabled);
  const heatOn = useHeatmapPreference((state) => state.detailHeatmap[kind]);
  const sectionsOn = useHeatmapPreference((state) => state.detailContext.sections[kind]);
  const routesOn = useHeatmapPreference((state) => state.detailContext.routes[kind]);
  const setDetailHeatmap = useHeatmapPreference((state) => state.setDetailHeatmap);
  const setDetailContext = useHeatmapPreference((state) => state.setDetailContext);
  const generation = useHeatmapGeneration();
  const heatDrawn = available && heatOn;

  // Read only while a library layer is on; the reader's identity moves when sections or groups do.
  const readEngine = useEngineRead(['groups', 'sections']);
  const wanted = sectionsOn || routesOn;
  const library = useMemo(
    () =>
      wanted
        ? (readEngine(() =>
            sharedContextLayerHold.read((heldSections, heldRoutes) =>
              maps.getMapContextLayers(heldSections, heldRoutes)
            )
          ) ?? NO_CONTEXT_LAYER_DATA)
        : NO_CONTEXT_LAYER_DATA,
    [wanted, readEngine]
  );
  const palette = useMemo(() => mapPalette(mapStyle), [mapStyle]);

  const context = useMemo<ContextLayerInput>(
    () => ({
      heatmap: heatDrawn ? { base: mapStyle, generation } : null,
      sections: sectionsOn
        ? { collection: library.sections, omitId: sectionId, palette, terrain }
        : null,
      routes:
        routesOn && library.routeGeneration !== undefined
          ? { generation: library.routeGeneration, omitId: routeId, palette, terrain }
          : null,
    }),
    [
      heatDrawn,
      mapStyle,
      generation,
      sectionsOn,
      routesOn,
      library,
      sectionId,
      routeId,
      palette,
      terrain,
    ]
  );

  const rows: MapLayerRow[] = [];
  if (available) {
    const ends = [t('maps.keyFewerPasses'), t('maps.keyMorePasses')] as const;
    rows.push({
      testID: `${kind}-map-layer-heatmap`,
      icon: 'fire',
      label: t('maps.layerHeatmap'),
      checked: heatOn,
      onPress: () => setDetailHeatmap(kind, !heatOn),
      layerKey: heatOn ? (
        <MapKeyRamp
          testID={`${kind}-map-key-heat`}
          ramp={heatmapKeyColours(mapStyle)}
          label={t('maps.keyHeatAxis')}
          ends={ends}
          stretch
          isDark={isDark}
        />
      ) : undefined,
      keyHint: ends.join(', '),
    });
  }
  rows.push(
    {
      testID: `${kind}-map-layer-sections`,
      icon: 'road-variant',
      label: t('maps.layerSections'),
      checked: sectionsOn,
      onPress: () => setDetailContext('sections', kind, !sectionsOn),
      layerKey: sectionsOn ? (
        <MapKeySwatch
          testID={`${kind}-map-key-sections`}
          stretch
          swatch={palette.layer.sections.slice(0, LINE_KEY_COLOURS)}
          dash={SECTION_LINE_DASH}
          edge={palette.edge}
        />
      ) : undefined,
    },
    {
      testID: `${kind}-map-layer-routes`,
      icon: 'map-marker-path',
      label: t('maps.layerRoutes'),
      checked: routesOn,
      onPress: () => setDetailContext('routes', kind, !routesOn),
      layerKey: routesOn ? (
        <MapKeySwatch
          testID={`${kind}-map-key-routes`}
          stretch
          swatch={palette.layer.routes.slice(0, LINE_KEY_COLOURS)}
          edge={palette.edge}
        />
      ) : undefined,
    }
  );
  return { context, rows };
}
