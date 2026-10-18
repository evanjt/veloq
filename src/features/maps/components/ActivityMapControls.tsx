import { Animated, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, iconSize, raised } from '@/theme';
import { CompassArrow, IconButton, iconButtonSkin } from '@/shared/ui';
import { getStyleIcon, type MapStyleType } from './mapStyles';
import { activityMapControlCount, useMapControlColumn } from '../lib/mapControlColumnLayout';
import { styles } from './ActivityMapView.styles';
import { LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';

interface ActivityMapControlsProps {
  isDark: boolean;
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
  isDark,
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
      <IconButton
        testID="activity-map-style-toggle"
        accessibilityLabel={t('maps.toggleStyle')}
        style={[styles.controlButton, raised('modal', isDark), isDark && styles.controlButtonDark]}
        variant="secondary"
        onPress={onToggleStyle}
      >
        <IconButton.Glyph name={getStyleIcon(mapStyle)} size={iconSize.lg} />
      </IconButton>

      {/* Gradient coloring toggle - only shown when gradient data is available */}
      {hasGradientData ? (
        <IconButton
          testID="activity-map-gradient-toggle"
          accessibilityLabel={t('maps.colorByGradient')}
          style={[
            styles.controlButton,
            raised('modal', isDark),
            isDark && styles.controlButtonDark,
          ]}
          variant="secondary"
          selected={gradientActive}
          onPress={onToggleGradient}
        >
          <IconButton.Glyph name="slope-uphill" size={iconSize.lg} />
        </IconButton>
      ) : null}

      {/* 3D toggle */}
      {hasRoute ? (
        <IconButton
          testID="activity-map-3d-toggle"
          accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
          accessibilityState={{ busy: is3DLoading }}
          style={[
            styles.controlButton,
            raised('modal', isDark),
            isDark && styles.controlButtonDark,
          ]}
          variant="secondary"
          selected={is3DMode}
          onPress={onToggle3D}
          disabled={is3DLoading}
        >
          {is3DLoading ? (
            <IconButton.Spinner testID="activity-map-3d-busy" />
          ) : (
            <IconButton.Glyph name="terrain" size={iconSize.lg} />
          )}
        </IconButton>
      ) : null}

      {/* Compass */}
      <IconButton
        accessibilityLabel={t('maps.resetOrientation')}
        style={[styles.controlButton, raised('modal', isDark), isDark && styles.controlButtonDark]}
        variant="secondary"
        onPress={onResetOrientation}
      >
        <CompassArrow
          size={iconSize.lg}
          rotation={bearingAnim}
          northColor={colors.compassNorth}
          southColor={iconButtonSkin({ variant: 'secondary', isDark }).glyph}
        />
      </IconButton>

      {/* GPS location */}
      <IconButton
        testID="activity-map-location"
        accessibilityLabel={t('maps.goToLocation')}
        accessibilityState={{ busy: locationLoading }}
        style={[styles.controlButton, raised('modal', isDark), isDark && styles.controlButtonDark]}
        variant="secondary"
        selected={userLocationActive}
        onPress={onGetLocation}
        disabled={locationLoading}
      >
        {locationLoading ? (
          <IconButton.Spinner />
        ) : (
          <IconButton.Glyph name={LOCATE_GLYPH} size={iconSize.lg} />
        )}
      </IconButton>

      {/* Fullscreen expand */}
      {enableFullscreen ? (
        <IconButton
          testID="activity-map-fullscreen"
          accessibilityLabel={t('maps.openFullscreen')}
          style={[
            styles.controlButton,
            raised('modal', isDark),
            isDark && styles.controlButtonDark,
          ]}
          variant="secondary"
          onPress={onOpenFullscreen}
        >
          <IconButton.Glyph name="fullscreen" size={iconSize.lg} />
        </IconButton>
      ) : null}
    </View>
  );
}
