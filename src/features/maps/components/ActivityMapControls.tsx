import { Animated, View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, iconSize } from '@/theme';
import { CompassArrow, IconButton } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
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
        style={[styles.controlButton, isDark && styles.controlButtonDark]}
        variant="secondary"
        onPress={onToggleStyle}
      >
        <Icon
          name={getStyleIcon(mapStyle)}
          size={iconSize.lg}
          color={isDark ? colors.textOnFill : colors.textSecondary}
        />
      </IconButton>

      {/* Gradient coloring toggle - only shown when gradient data is available */}
      {hasGradientData ? (
        <IconButton
          testID="activity-map-gradient-toggle"
          accessibilityState={{ selected: gradientActive }}
          accessibilityLabel={t('maps.colorByGradient')}
          style={[styles.controlButton, isDark && !gradientActive && styles.controlButtonDark]}
          variant={gradientActive ? 'primary' : 'secondary'}
          onPress={onToggleGradient}
        >
          <Icon
            name="slope-uphill"
            size={iconSize.lg}
            color={
              gradientActive ? colors.textOnFill : isDark ? colors.textOnFill : colors.textSecondary
            }
          />
        </IconButton>
      ) : null}

      {/* 3D toggle */}
      {hasRoute ? (
        <IconButton
          testID="activity-map-3d-toggle"
          accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
          accessibilityState={{ selected: is3DMode, busy: is3DLoading }}
          style={[styles.controlButton, isDark && !is3DMode && styles.controlButtonDark]}
          variant={is3DMode ? 'primary' : 'secondary'}
          onPress={onToggle3D}
          disabled={is3DLoading}
        >
          {is3DLoading ? (
            <ActivityIndicator
              testID="activity-map-3d-busy"
              size="small"
              color={colors.textOnFill}
            />
          ) : (
            <Icon
              name="terrain"
              size={iconSize.lg}
              color={
                is3DMode ? colors.textOnFill : isDark ? colors.textOnFill : colors.textSecondary
              }
            />
          )}
        </IconButton>
      ) : null}

      {/* Compass */}
      <IconButton
        accessibilityLabel={t('maps.resetOrientation')}
        style={[styles.controlButton, isDark && styles.controlButtonDark]}
        variant="secondary"
        onPress={onResetOrientation}
      >
        <CompassArrow
          size={iconSize.lg}
          rotation={bearingAnim}
          northColor={colors.compassNorth}
          southColor={isDark ? colors.textOnFill : colors.textSecondary}
        />
      </IconButton>

      {/* GPS location */}
      <IconButton
        testID="activity-map-location"
        accessibilityLabel={t('maps.goToLocation')}
        accessibilityState={{
          disabled: locationLoading,
          busy: locationLoading,
          selected: userLocationActive,
        }}
        style={[styles.controlButton, isDark && !userLocationActive && styles.controlButtonDark]}
        variant={userLocationActive ? 'primary' : 'secondary'}
        onPress={onGetLocation}
        disabled={locationLoading}
      >
        {locationLoading ? (
          <ActivityIndicator
            size="small"
            color={isDark ? colors.textOnFill : colors.textSecondary}
          />
        ) : (
          <Icon
            name={LOCATE_GLYPH}
            size={iconSize.lg}
            color={
              userLocationActive
                ? colors.textOnFill
                : isDark
                  ? colors.textOnFill
                  : colors.textSecondary
            }
          />
        )}
      </IconButton>

      {/* Fullscreen expand */}
      {enableFullscreen ? (
        <IconButton
          testID="activity-map-fullscreen"
          accessibilityLabel={t('maps.openFullscreen')}
          style={[styles.controlButton, isDark && styles.controlButtonDark]}
          variant="secondary"
          onPress={onOpenFullscreen}
        >
          <Icon
            name="fullscreen"
            size={iconSize.lg}
            color={isDark ? colors.textOnFill : colors.textSecondary}
          />
        </IconButton>
      ) : null}
    </View>
  );
}
