import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useUploadPermissionStore } from '@/providers';
import { usePermissionUpgrade } from '@/hooks/recording/usePermissionUpgrade';
import { spacing } from '@/theme';

const AMBER_BG = 'rgba(245, 158, 11, 0.12)';
const AMBER_BG_DARK = 'rgba(245, 158, 11, 0.18)';
const AMBER_TEXT = '#D97706';
const AMBER_ACCENT = '#F59E0B';

function PermissionUpgradeBannerInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const needsUpgrade = useUploadPermissionStore((s) => s.needsUpgrade);
  const { upgradePermissions, isUpgrading } = usePermissionUpgrade();

  if (!needsUpgrade) return null;

  return (
    <View
      testID="permission-upgrade-banner"
      style={[styles.container, { backgroundColor: isDark ? AMBER_BG_DARK : AMBER_BG }]}
    >
      <MaterialCommunityIcons name="shield-lock-outline" size={18} color={AMBER_ACCENT} />
      <Text style={[styles.text, { color: AMBER_TEXT }]} numberOfLines={2}>
        {t('recording.permissionNeeded', 'Permission needed to upload activities')}
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={upgradePermissions}
        disabled={isUpgrading}
        activeOpacity={0.7}
      >
        {isUpgrading ? (
          <ActivityIndicator size="small" color={AMBER_ACCENT} />
        ) : (
          <Text style={styles.buttonText}>{t('recording.grantAccess', 'Grant Access')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export const PermissionUpgradeBanner = React.memo(PermissionUpgradeBannerInner);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: AMBER_ACCENT,
    minWidth: 80,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
