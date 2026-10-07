import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import { spacing, colors, darkColors, colorWithOpacity, layout, typography } from '@/theme';
import { GrantAccessButton } from './GrantAccessButton';
import { pressable, pressRipple } from '@/shared/ui';

const AMBER_BG = colorWithOpacity(colors.warning, 0.12);
const AMBER_BG_DARK = colorWithOpacity(colors.warning, 0.18);
const AMBER_TEXT = colors.amberIcon;
const AMBER_ACCENT = colors.warningAmber;
const AMBER_ACCENT_DARK = darkColors.warningAmber;

function PermissionUpgradeBannerInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const bannerDismissed = useUploadPermissionStore((s) => s.bannerDismissed);
  const dismissBanner = useUploadPermissionStore((s) => s.dismissBanner);
  const { upgradePermissions, isUpgrading, error } = usePermissionUpgrade();

  // Only show for OAuth users without confirmed write permission, and not dismissed
  if (authMethod !== 'oauth' || hasWritePermission === true || bannerDismissed) return null;

  return (
    <View
      testID="permission-upgrade-banner"
      style={[styles.container, { backgroundColor: isDark ? AMBER_BG_DARK : AMBER_BG }]}
    >
      <View style={styles.content}>
        <View style={styles.row}>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={18}
            color={isDark ? AMBER_ACCENT_DARK : AMBER_ACCENT}
          />
          <Text style={[styles.text, { color: AMBER_TEXT }]} numberOfLines={2}>
            {t('recording.permissionNeeded', 'Permission needed to upload activities')}
          </Text>
          <GrantAccessButton onPress={upgradePermissions} loading={isUpgrading} small />
          <Pressable
            testID="permission-banner-dismiss"
            onPress={dismissBanner}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={pressable()}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="close" size={18} color={AMBER_TEXT} />
          </Pressable>
        </View>
        {error ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const PermissionUpgradeBanner = React.memo(PermissionUpgradeBannerInner);

const PERMISSION_ICON_WIDTH = 18;

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '500',
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    color: colors.errorDeep,
    marginLeft: PERMISSION_ICON_WIDTH + spacing.sm,
  },
});
