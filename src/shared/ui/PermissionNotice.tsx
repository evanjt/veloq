/**
 * The one notice for a capability the athlete has not allowed: an icon, one
 * line saying what is off, and one action. While the system will still ask,
 * the action raises its dialog; once it has stopped asking, the action opens
 * Veloq's page in system settings, the only place left that can change it.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app/useTheme';
import { openAppSettings } from '@/shared/app/permissions';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { Button } from './Button';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';

/** The action that takes the athlete to Veloq's page in system settings. */
export function OpenSettingsButton({ testID }: { testID: string }) {
  const { t } = useTranslation();
  return (
    <Button
      testID={testID}
      label={t('common.openSettings')}
      onPress={openAppSettings}
      variant="ghost"
      size="sm"
    />
  );
}

interface PermissionNoticeProps {
  outcome: 'askable' | 'blocked';
  /** One line naming what is off. */
  reason: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Raises the system dialog; used while the outcome is askable. */
  onAllow: () => void;
  testID: string;
}

export function PermissionNotice({
  outcome,
  reason,
  icon,
  onAllow,
  testID,
}: PermissionNoticeProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  useAnnounceOnAppear(reason);

  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        { backgroundColor: isDark ? darkColors.surfaceElevated : colors.surface },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={iconSize.md} color={palette.warningAmber} />
      <Text style={[styles.reason, { color: palette.textPrimary }]}>{reason}</Text>
      {outcome === 'blocked' ? (
        <OpenSettingsButton testID={`${testID}-settings`} />
      ) : (
        <Button
          testID={`${testID}-allow`}
          label={t('common.allow')}
          onPress={onAllow}
          variant="ghost"
          size="sm"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusMd,
  },
  reason: {
    ...typography.bodySmall,
    flex: 1,
  },
});
