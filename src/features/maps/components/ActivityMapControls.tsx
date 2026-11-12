import { Animated, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getStyleIcon, type MapStyleType } from './mapStyles';
import { MapControlButton } from './MapControlButton';
import { activityMapControlCount, useMapControlColumn } from '../lib/mapControlColumnLayout';
import { styles } from './ActivityMapView.styles';
import { LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';
import { layout, type MapPalette } from '@/theme';
import { DivergingKeyScale } from './DivergingKeyScale';
import {
  MapLayersButton,
  MapLayersMenu,
  layersMenuPlacement,
  useLayersMenu,
  type MapLayerRow,
} from './MapLayersMenu';

/** Buttons above the layers button in the column: the style toggle. */
const CONTROLS_ABOVE_LAYERS = 1;
const NO_ROWS: MapLayerRow[] = [];

interface ActivityMapControlsProps {
  /** The style a tap of the style toggle draws, which its glyph names. */
  nextStyle: MapStyleType;
  onToggleStyle: () => void;
  hasGradientData: boolean;
  /** The rows of the layers menu for the heatmap, sections and routes, none when there are none to offer. */
  contextRows?: MapLayerRow[];
  gradientActive: boolean;
  onToggleGradient: () => void;
  is3DMode: boolean;
  /** Terrain is loading: the 3D control is busy and ignores presses until it ends. */
  is3DLoading: boolean;
  hasRoute: boolean;
  onToggle3D: () => void;
  bearingAnim: Animated.Value;
  onResetOrientation: () => void;
  locationLoading: boolean;
  /** Whether a location dot is drawn, so the button shows its active style. */
  userLocationActive: boolean;
  onGetLocation: () => void;
  enableFullscreen: boolean;
  onOpenFullscreen: () => void;
  /** Height of the map the column sits in; bounds it so no button leaves the map. */
  mapHeight: number;
  isDark: boolean;
  /** The base map the line is drawn over, whose ramp the gradient key repeats. */
  basePalette: MapPalette;
}

export function ActivityMapControls({
  nextStyle,
  onToggleStyle,
  hasGradientData,
  contextRows = NO_ROWS,
  gradientActive,
  onToggleGradient,
  is3DMode,
  is3DLoading,
  hasRoute,
  onToggle3D,
  bearingAnim,
  onResetOrientation,
  locationLoading,
  userLocationActive,
  onGetLocation,
  enableFullscreen,
  onOpenFullscreen,
  mapHeight,
  isDark,
  basePalette,
}: ActivityMapControlsProps) {
  const { t } = useTranslation();
  const { top, maxHeight, width } = useMapControlColumn(
    mapHeight,
    activityMapControlCount({
      shown: true,
      hasGradientData,
      hasContextRows: contextRows.length > 0,
      hasRoute,
      enableFullscreen,
    })
  );

  const hasLayers = hasGradientData || contextRows.length > 0;
  const layers = useLayersMenu(hasLayers);
  const gradientRows: MapLayerRow[] = hasGradientData
    ? [
        {
          testID: 'activity-map-layer-gradient',
          icon: 'slope-uphill',
          label: t('maps.colorByGradient'),
          checked: gradientActive,
          onPress: () => {
            layers.close();
            onToggleGradient();
          },
          layerKey: gradientActive ? (
            <DivergingKeyScale kind="grade" palette={basePalette} isDark={isDark} />
          ) : undefined,
        },
      ]
    : [];
  const rows = [...gradientRows, ...contextRows];

  return (
    <>
      <View
        testID="activity-map-controls"
        style={[styles.controlsContainer, { top, maxHeight, width }]}
      >
        {/* Style toggle */}
        <MapControlButton
          testID="activity-map-style-toggle"
          accessibilityLabel={t('maps.toggleStyle')}
          onPress={onToggleStyle}
        >
          <MapControlButton.Glyph name={getStyleIcon(nextStyle)} />
        </MapControlButton>

        {/* Layers - only shown when there is a layer to toggle */}
        {hasLayers ? (
          <MapLayersButton
            testID="activity-map-layers"
            open={layers.open}
            onPress={layers.toggle}
          />
        ) : null}

        {/* 3D toggle */}
        {hasRoute ? (
          <MapControlButton
            testID="activity-map-3d-toggle"
            accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
            accessibilityState={{ busy: is3DLoading }}
            selected={is3DMode}
            onPress={onToggle3D}
            disabled={is3DLoading}
          >
            {is3DLoading ? (
              <MapControlButton.Spinner testID="activity-map-3d-busy" />
            ) : (
              <MapControlButton.Glyph name="terrain" />
            )}
          </MapControlButton>
        ) : null}

        {/* Compass */}
        <MapControlButton
          accessibilityLabel={t('maps.resetOrientation')}
          onPress={onResetOrientation}
        >
          <MapControlButton.Compass rotation={bearingAnim} />
        </MapControlButton>

        {/* GPS location */}
        <MapControlButton
          testID="activity-map-location"
          accessibilityLabel={t('maps.goToLocation')}
          accessibilityState={{ busy: locationLoading }}
          selected={userLocationActive}
          onPress={onGetLocation}
          disabled={locationLoading}
        >
          {locationLoading ? (
            <MapControlButton.Spinner />
          ) : (
            <MapControlButton.Glyph name={LOCATE_GLYPH} />
          )}
        </MapControlButton>

        {/* Fullscreen expand */}
        {enableFullscreen ? (
          <MapControlButton
            testID="activity-map-fullscreen"
            accessibilityLabel={t('maps.openFullscreen')}
            onPress={onOpenFullscreen}
          >
            <MapControlButton.Glyph name="fullscreen" />
          </MapControlButton>
        ) : null}
      </View>
      {layers.open ? (
        <MapLayersMenu
          testID="activity-map-layers-menu"
          backdropTestID="activity-map-layers-backdrop"
          rows={rows}
          isDark={isDark}
          onClose={layers.close}
          {...layersMenuPlacement(top, CONTROLS_ABOVE_LAYERS, layout.cardMargin)}
        />
      ) : null}
    </>
  );
}
