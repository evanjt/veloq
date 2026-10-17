import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import {
  colors,
  colorWithOpacity,
  iconSize,
  layout,
  opacity,
  spacing,
  themePalette,
  typography,
} from '@/theme';
import { GrantAccessButton } from './GrantAccessButton';
import { IconButton } from '@/shared/ui/IconButton';

const AMBER_BG = colorWithOpacity(colors.warning, opacity.tint2);
const AMBER_BG_DARK = colorWithOpacity(colors.warning, opacity.tint3);

function PermissionUpgradeBannerInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const bannerDismissed = useUploadPermissionStore((s) => s.bannerDismissed);
  const dismissBanner = useUploadPermissionStore((s) => s.dismissBanner);
  const { upgradePermissions, isUpgrading, error } = usePermissionUpgrade();

  // Only show for OAuth users without confirmed write permission, and not dismissed
  if (!sourceFor({ authMethod })?.can.scoped || hasWritePermission === true || bannerDismissed)
    return null;

  return (
    <View
      testID="permission-upgrade-banner"
      style={[styles.container, { backgroundColor: isDark ? AMBER_BG_DARK : AMBER_BG }]}
    >
      <View style={styles.content}>
        <View style={styles.row}>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={iconSize.md}
            color={palette.warningAmber}
          />
          <Text style={[styles.text, { color: palette.amberIcon }]} numberOfLines={2}>
            {t('recording.permissionNeeded', 'Permission needed to upload activities')}
          </Text>
          <GrantAccessButton onPress={upgradePermissions} loading={isUpgrading} small />
          <IconButton
            testID="permission-banner-dismiss"
            onPress={dismissBanner}
            accessibilityLabel={t('common.close', 'Close')}
          >
            <MaterialCommunityIcons name="close" size={iconSize.md} color={palette.amberIcon} />
          </IconButton>
        </View>
        {error ? (
          <Text style={[styles.errorText, { color: palette.errorDeep }]} numberOfLines={2}>
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
    ...typography.bodyCompact,
    flex: 1,
  },
  errorText: {
    ...typography.caption,
    marginLeft: PERMISSION_ICON_WIDTH + spacing.sm,
  },
});
