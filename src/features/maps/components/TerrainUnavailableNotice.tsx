import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { pressable, pressRipple } from '@/shared/ui';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';

export const TERRAIN_UNAVAILABLE_TEST_ID = 'terrain-unavailable-notice';

const DISMISS_AFTER_MS = 6000;

/**
 * Says why a 3D view dropped back to the flat map. The renderer ships in the
 * app but the DEM tiles do not, so an offline 3D open used to leave a flat map
 * that read as broken 3D.
 *
 * It clears itself, because the athlete cannot act on it while offline and a
 * pill that has to be dismissed is worse than the silence it replaced. So it
 * speaks as it appears, since a screen reader may not reach it before it goes.
 *
 * `bottom` lifts it clear of whatever the host draws over the foot of its map.
 */
export function TerrainUnavailableNotice({
  onDismiss,
  bottom,
}: {
  onDismiss: () => void;
  bottom?: number | undefined;
}) {
  const { t } = useTranslation();
  const message = t('maps.threeDUnavailable');
  useAnnounceOnAppear(message);

  // Callers pass a fresh arrow each render, so keying the timer on it would restart the clock.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Pressable
      style={pressable([styles.wrapper, bottom !== undefined && { bottom }])}
      android_ripple={pressRipple}
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={message}
      accessibilityHint={t('common.close')}
      accessibilityLiveRegion="polite"
      testID={TERRAIN_UNAVAILABLE_TEST_ID}
    >
      <View style={styles.pill}>
        <MaterialCommunityIcons
          name="terrain"
          size={iconSize.md}
          color={darkColors.textSecondary}
        />
        <Text style={styles.text}>{message}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: darkColors.surfaceElevated,
  },
  text: {
    ...typography.bodySmall,
    color: darkColors.textPrimary,
    flexShrink: 1,
  },
});
