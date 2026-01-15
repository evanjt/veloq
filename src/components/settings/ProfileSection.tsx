import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { colors, darkColors, spacing } from '@/theme';
import { getAthleteId } from '@/api';
import { useAthlete } from '@/hooks';

interface Athlete {
  name?: string;
  profile?: string;
  profile_medium?: string;
}

interface ProfileSectionProps {
  athlete?: Athlete;
}

export function ProfileSection({ athlete }: ProfileSectionProps) {
  const { isDark } = useTheme();
  const [profileImageError, setProfileImageError] = useState(false);

  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl =
    profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  return (
    <TouchableOpacity
      style={[styles.section, isDark && styles.sectionDark]}
      onPress={() =>
        WebBrowser.openBrowserAsync(`https://intervals.icu/athlete/${getAthleteId()}/activities`)
      }
      activeOpacity={0.7}
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
          <Text style={[styles.profileEmail, isDark && styles.textMuted]}>intervals.icu</Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={isDark ? darkColors.textMuted : colors.textSecondary}
        />
      </View>
    </TouchableOpacity>
  );
}

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
