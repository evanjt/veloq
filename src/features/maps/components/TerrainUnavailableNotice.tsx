import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { pressable, pressRipple } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';

export const TERRAIN_UNAVAILABLE_TEST_ID = 'terrain-unavailable-notice';

/** Where the notice sits: at the foot of an embedded map, or in the screen's bottom pill stack. */
export type TerrainNoticePlacement = 'mapFoot' | 'pillStack';

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
 * At `mapFoot` it floats at the foot of the map it explains. In `pillStack` it lays out in the
 * bottom pill stack's slot, which places it.
 */
export function TerrainUnavailableNotice({
  onDismiss,
  placement = 'mapFoot',
}: {
  onDismiss: () => void;
  placement?: TerrainNoticePlacement;
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
      style={pressable(placement === 'mapFoot' ? styles.mapFoot : styles.pillStack)}
      android_ripple={pressRipple}
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={message}
      accessibilityHint={t('common.close')}
      accessibilityLiveRegion="polite"
      testID={TERRAIN_UNAVAILABLE_TEST_ID}
    >
      <View style={styles.pill}>
        <Icon name="terrain" size={iconSize.md} color={darkColors.textSecondary} />
        <Text style={styles.text}>{message}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mapFoot: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  pillStack: {
    marginHorizontal: spacing.md,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: darkColors.surfaceRaised,
  },
  text: {
    ...typography.bodySmall,
    color: darkColors.textPrimary,
    flexShrink: 1,
  },
});
