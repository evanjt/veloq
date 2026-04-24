import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, layout, typography, brand } from '@/theme';

export interface SaveErrorBannerProps {
  /** Error text to display. If falsy, the banner renders nothing. */
  errorMessage: string | null | undefined;
  /** When true, show the "Grant Access" OAuth upgrade button */
  showPermissionFix: boolean;
  /** Spinner state for the upgrade button */
  isOAuthLoading: boolean;
  /** Invoked when the user taps "Grant Access" */
  onUpgradePermissions: () => void;
}

/**
 * Error banner shown when saving/uploading an activity fails.
 *
 * For 403 (permission) errors, the recorder sets `showPermissionFix` to true
 * and a secondary "Grant Access" button is shown that initiates an OAuth
 * upgrade flow via {@link SaveErrorBannerProps.onUpgradePermissions}.
 */
export function SaveErrorBanner({
  errorMessage,
  showPermissionFix,
  isOAuthLoading,
  onUpgradePermissions,
}: SaveErrorBannerProps) {
  const { t } = useTranslation();

  if (!errorMessage) return null;

  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{errorMessage}</Text>
      {showPermissionFix && (
        <TouchableOpacity
          style={[styles.oauthUpgradeBtn, { backgroundColor: brand.teal }]}
          onPress={onUpgradePermissions}
          disabled={isOAuthLoading}
          activeOpacity={0.8}
        >
          {isOAuthLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <MaterialCommunityIcons name="shield-lock-outline" size={16} color="#FFFFFF" />
              <Text style={styles.oauthUpgradeBtnText}>
                {t('recording.grantAccess', 'Grant Access')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorBannerText: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
  },
  oauthUpgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    minHeight: layout.minTapTarget,
  },
  oauthUpgradeBtnText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
    fontSize: 14,
  },
});
