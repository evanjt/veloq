import React, { useState, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { colors, darkColors, spacing } from '@/theme';
import { getAthleteId } from '@/api';
import { useAuthStore } from '@/providers';

interface Athlete {
  name?: string;
  profile?: string;
  profile_medium?: string;
}

interface ProfileSectionProps {
  athlete?: Athlete;
}

function ProfileSectionComponent({ athlete }: ProfileSectionProps) {
  const { isDark } = useTheme();
  const [profileImageError, setProfileImageError] = useState(false);
  const authMethod = useAuthStore((state) => state.authMethod);

  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl =
    profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  // Get auth method badge text
  const getAuthBadge = (): string => {
    switch (authMethod) {
      case 'oauth':
        return 'OAuth';
      case 'apiKey':
        return 'API key';
      case 'demo':
        return 'Demo mode';
      default:
        return '';
    }
  };

  const isDemo = authMethod === 'demo';

  return (
    <TouchableOpacity
      style={[styles.section, isDark && styles.sectionDark]}
      onPress={
        isDemo
          ? undefined
          : () =>
              WebBrowser.openBrowserAsync(
                `https://intervals.icu/athlete/${getAthleteId()}/activities`
              )
      }
      activeOpacity={isDemo ? 1 : 0.7}
      disabled={isDemo}
    >
      <View style={styles.profileRow}>
        <View style={[styles.profilePhoto, isDark && styles.profilePhotoDark]}>
          {hasValidProfileUrl && !profileImageError ? (
            <Image
              source={{ uri: profileUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setProfileImageError(true)}
            />
          ) : (
            <MaterialCommunityIcons name="account" size={32} color={isDark ? '#AAA' : '#666'} />
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, isDark && styles.textLight]}>
            {athlete?.name || 'Athlete'}
          </Text>
          <Text style={[styles.profileEmail, isDark && styles.textMuted]}>
            {authMethod === 'demo' ? getAuthBadge() : `intervals.icu · ${getAuthBadge()}`}
          </Text>
        </View>
        {!isDemo && (
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

// Memoize to prevent re-renders when parent re-renders
export const ProfileSection = memo(ProfileSectionComponent);

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surface,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  profilePhoto: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profilePhotoDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: colors.textSecondary,
  },
});
