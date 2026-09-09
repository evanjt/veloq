import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, typography } from '@/theme';

import { GrantAccessButton } from './GrantAccessButton';

interface RecordingGateProps {
  /** Why recording is blocked. `ok` never reaches here. */
  reason: 'no_permission' | 'not_signed_in';
  onGrantAccess: () => void;
  isUpgrading?: boolean;
  error?: string | null;
}

/**
 * Why a ride cannot start, and the one thing that would fix it.
 *
 * Lives in the feature rather than on the picker because every one-tap surface
 * deep-links to the recording screen, so both screens have to answer this and
 * they have to answer it the same way. A missing account and a missing scope are
 * different problems with different fixes, which is why they are different
 * reasons rather than one.
 */
export function RecordingGate({
  reason,
  onGrantAccess,
  isUpgrading,
  error,
}: RecordingGateProps): React.JSX.Element {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const signedOut = reason === 'not_signed_in';

  return (
    <View style={styles.gate} testID={signedOut ? 'recording-gate-signin' : 'recording-gate-scope'}>
      <MaterialCommunityIcons
        name={signedOut ? 'account-lock-outline' : 'shield-lock-outline'}
        size={48}
        color={colors.warning}
      />
      <Text style={[styles.title, { color: textPrimary }]}>
        {signedOut
          ? t('recording.signInRequired')
          : t('recording.writePermissionRequired', 'Write permission required')}
      </Text>
      <Text style={[styles.description, { color: textSecondary }]}>
        {signedOut
          ? t('recording.signInDescription')
          : t(
              'recording.writePermissionDescription',
              'Recording requires write permission. Tap below to grant access.'
            )}
      </Text>
      {signedOut ? (
        <TouchableOpacity
          testID="recording-gate-signin-action"
          onPress={() => navigateTo('/login')}
          accessibilityRole="button"
        >
          <Text style={[styles.action, { color: colors.primary }]}>
            {t('recording.signInAction')}
          </Text>
        </TouchableOpacity>
      ) : (
        <GrantAccessButton
          testID="record-grant-access"
          onPress={onGrantAccess}
          loading={isUpgrading === true}
        />
      )}
      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  description: {
    fontSize: typography.bodyMedium.fontSize,
    textAlign: 'center',
    lineHeight: 22,
  },
  action: {
    ...typography.body,
    fontWeight: '600',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  error: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.errorDark,
    textAlign: 'center',
  },
});
