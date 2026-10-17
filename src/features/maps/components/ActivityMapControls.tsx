import { Animated, View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, iconSize } from '@/theme';
import { CompassArrow, IconButton } from '@/shared/ui';
import { getStyleIcon, type MapStyleType } from './mapStyles';
import { activityMapControlCount, useMapControlColumn } from '../lib/mapControlColumnLayout';
import { styles } from './ActivityMapView.styles';

interface ActivityMapControlsProps {
  isDark: boolean;
  mapStyle: MapStyleType;
  onToggleStyle: () => void;
  hasGradientData: boolean;
  gradientActive: boolean;
  onToggleGradient: () => void;
  is3DMode: boolean;
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
        <MaterialCommunityIcons
          name={getStyleIcon(mapStyle)}
          size={iconSize.lg}
          color={isDark ? colors.textOnDark : colors.textSecondary}
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
          <MaterialCommunityIcons
            name="slope-uphill"
            size={iconSize.lg}
            color={
              gradientActive
                ? colors.textOnPrimary
                : isDark
                  ? colors.textOnDark
                  : colors.textSecondary
            }
          />
        </IconButton>
      ) : null}

      {/* 3D toggle */}
      {hasRoute ? (
        <IconButton
          testID="activity-map-3d-toggle"
          accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
          style={[styles.controlButton, isDark && !is3DMode && styles.controlButtonDark]}
          variant={is3DMode ? 'primary' : 'secondary'}
          onPress={onToggle3D}
        >
          <MaterialCommunityIcons
            name="terrain"
            size={iconSize.lg}
            color={
              is3DMode ? colors.textOnPrimary : isDark ? colors.textOnDark : colors.textSecondary
            }
          />
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
          northColor={colors.error}
          southColor={isDark ? colors.textOnDark : colors.textSecondary}
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
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        ) : (
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={iconSize.lg}
            color={
              userLocationActive
                ? colors.textOnPrimary
                : isDark
                  ? colors.textOnDark
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
          <MaterialCommunityIcons
            name="fullscreen"
            size={iconSize.lg}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </IconButton>
      ) : null}
    </View>
  );
}
