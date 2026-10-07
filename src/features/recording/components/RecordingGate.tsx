import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, typography } from '@/theme';

import { GrantAccessButton } from './GrantAccessButton';
import { pressable, pressRipple } from '@/shared/ui';

interface RecordingGateProps {
  /** Why recording is blocked. `ok` never reaches here. */
  reason: 'no_permission' | 'not_signed_in';
  onGrantAccess: () => void;
  /**
   * Record anyway, keeping the ride on the device. Missing scope only: absent
   * while the scope answer is still on its way, where there is nothing to warn
   * about yet.
   */
  onContinue?: (() => void) | undefined;
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
 *
 * Only the missing account is a refusal. A missing scope stops the upload, not
 * the ride, so it warns and lets the athlete through: the grant action is there
 * for when the network is, and continuing keeps the ride on the device.
 */
export function RecordingGate({
  reason,
  onGrantAccess,
  onContinue,
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
        color={isDark ? darkColors.warningAmber : colors.warningAmber}
      />
      <Text style={[styles.title, { color: textPrimary }]}>
        {signedOut
          ? t('recording.signInRequired')
          : t('recording.writePermissionRequired', 'Write permission required')}
      </Text>
      <Text style={[styles.description, { color: textSecondary }]}>
        {signedOut ? t('recording.signInDescription') : t('recording.writePermissionLocalOnly')}
      </Text>
      {signedOut ? (
        <Pressable
          testID="recording-gate-signin-action"
          onPress={() => navigateTo('/login')}
          accessibilityRole="button"
          style={pressable()}
          android_ripple={pressRipple}
        >
          <Text style={[styles.action, { color: isDark ? darkColors.linkTeal : colors.linkTeal }]}>
            {t('recording.signInAction')}
          </Text>
        </Pressable>
      ) : (
        <>
          <GrantAccessButton
            testID="record-grant-access"
            onPress={onGrantAccess}
            loading={isUpgrading === true}
          />
          {onContinue ? (
            <Pressable
              testID="recording-gate-continue"
              onPress={onContinue}
              accessibilityRole="button"
              style={pressable()}
              android_ripple={pressRipple}
            >
              <Text
                style={[styles.action, { color: isDark ? darkColors.linkTeal : colors.linkTeal }]}
              >
                {t('recording.recordAnyway')}
              </Text>
            </Pressable>
          ) : null}
        </>
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
    color: colors.errorDeep,
    textAlign: 'center',
  },
});
