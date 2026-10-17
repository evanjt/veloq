import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import { spacing } from '@/theme';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { GrantAccessButton } from './GrantAccessButton';

function PermissionUpgradeBannerInner() {
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const bannerDismissed = useUploadPermissionStore((s) => s.bannerDismissed);
  const dismissBanner = useUploadPermissionStore((s) => s.dismissBanner);
  const { upgradePermissions, isUpgrading, error } = usePermissionUpgrade();

  // Only show for OAuth users without confirmed write permission, and not dismissed
  if (!sourceFor({ authMethod })?.can.scoped || hasWritePermission === true || bannerDismissed)
    return null;

  return (
    <InlineNotice
      testID="permission-upgrade-banner"
      tone="warning"
      icon="shield-lock-outline"
      title={t('recording.permissionNeeded', 'Permission needed to upload activities')}
      detail={error}
      action={<GrantAccessButton onPress={upgradePermissions} loading={isUpgrading} small />}
      onDismiss={dismissBanner}
      style={styles.container}
    />
  );
}

export const PermissionUpgradeBanner = React.memo(PermissionUpgradeBannerInner);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
