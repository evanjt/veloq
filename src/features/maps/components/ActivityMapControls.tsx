import { Animated, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getStyleIcon, type MapStyleType } from './mapStyles';
import { MapControlButton } from './MapControlButton';
import { activityMapControlCount, useMapControlColumn } from '../lib/mapControlColumnLayout';
import { styles } from './ActivityMapView.styles';
import { LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';

interface ActivityMapControlsProps {
  mapStyle: MapStyleType;
  onToggleStyle: () => void;
  hasGradientData: boolean;
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
}

export function ActivityMapControls({
  mapStyle,
  onToggleStyle,
  hasGradientData,
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
}: ActivityMapControlsProps) {
  const { t } = useTranslation();
  const { top, maxHeight, width } = useMapControlColumn(
    mapHeight,
    activityMapControlCount({ shown: true, hasGradientData, hasRoute, enableFullscreen })
  );

  return (
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
        <MapControlButton.Glyph name={getStyleIcon(mapStyle)} />
      </MapControlButton>

      {/* Gradient coloring toggle - only shown when gradient data is available */}
      {hasGradientData ? (
        <MapControlButton
          testID="activity-map-gradient-toggle"
          accessibilityLabel={t('maps.colorByGradient')}
          selected={gradientActive}
          onPress={onToggleGradient}
        >
          <MapControlButton.Glyph name="slope-uphill" />
        </MapControlButton>
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
  );
}
