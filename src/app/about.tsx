import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { ScreenSafeAreaView } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import { useTheme } from '@/hooks';
import { INTERVALS_URLS } from '@/services/oauth';

const VELOQ_URLS = {
  github: 'https://github.com/evanjt/veloq',
  license: 'https://github.com/evanjt/veloq/blob/main/LICENSE',
  privacy: 'https://veloq.fit/privacy',
  tracematch: 'https://github.com/evanjt/tracematch',
};

interface LinkRowProps {
  icon: string;
  label: string;
  url: string;
  isDark: boolean;
}

function LinkRow({ icon, label, url, isDark }: LinkRowProps) {
  const handlePress = () => {
    Linking.openURL(url);
  };

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <TouchableOpacity style={styles.linkRow} onPress={handlePress} activeOpacity={0.7}>
      <MaterialCommunityIcons name={icon as any} size={22} color={colors.primary} />
      <Text style={[styles.linkText, { color: textColor }]}>{label}</Text>
      <MaterialCommunityIcons name="open-in-new" size={18} color={mutedColor} />
    </TouchableOpacity>
  );
}

interface NavRowProps {
  icon: string;
  label: string;
  route: string;
  isDark: boolean;
}

function NavRow({ icon, label, route, isDark }: NavRowProps) {
  const handlePress = () => {
    router.push(route as any);
  };

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <TouchableOpacity style={styles.linkRow} onPress={handlePress} activeOpacity={0.7}>
      <MaterialCommunityIcons name={icon as any} size={22} color={colors.primary} />
      <Text style={[styles.linkText, { color: textColor }]}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color={mutedColor} />
    </TouchableOpacity>
  );
}

export default function AboutScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);

  return (
    <ScreenSafeAreaView testID="about-screen" style={shared.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header with back button */}
        <View style={shared.header}>
          <TouchableOpacity
            testID="nav-back-button"
            onPress={() => router.back()}
            style={shared.backButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={themeColors.text} />
          </TouchableOpacity>
          <Text style={shared.headerTitle}>{t('about.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* App Info */}
        <View style={styles.section(isDark)}>
          <View style={styles.appInfo}>
            <View style={styles.appIcon(isDark)}>
              <MaterialCommunityIcons name="bike-fast" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.appName, shared.text]}>Veloq</Text>
            <Text style={[styles.appVersion, shared.textSecondary]}>
              {t('about.version')} {Constants.expoConfig?.version ?? '0.0.1'}
            </Text>
            <Text style={[styles.appDescription, shared.textSecondary]}>
              {t('about.description')}
            </Text>
          </View>
        </View>

        {/* Disclaimer */}
        <Text style={[styles.sectionLabel, shared.textSecondary]}>
          {t('about.disclaimerTitle').toUpperCase()}
        </Text>
        <View style={styles.section(isDark)}>
          <Text style={[styles.disclaimerText, shared.textSecondary]}>{t('about.disclaimer')}</Text>
        </View>

        {/* intervals.icu Links */}
        <Text style={[styles.sectionLabel, shared.textSecondary]}>INTERVALS.ICU</Text>
        <View style={styles.section(isDark)}>
          <LinkRow
            icon="shield-account"
            label={t('about.intervalsPrivacy')}
            url={INTERVALS_URLS.privacyPolicy}
            isDark={isDark}
          />
          <View style={styles.linkDivider(isDark)} />
          <LinkRow
            icon="file-document"
            label={t('about.intervalsTerms')}
            url={INTERVALS_URLS.termsOfService}
            isDark={isDark}
          />
          <View style={styles.linkDivider(isDark)} />
          <LinkRow
            icon="api"
            label={t('about.intervalsApiTerms')}
            url={INTERVALS_URLS.apiTerms}
            isDark={isDark}
          />
        </View>

        {/* Veloq Links */}
        <Text style={[styles.sectionLabel, shared.textSecondary]}>VELOQ</Text>
        <View style={styles.section(isDark)}>
          <LinkRow
            icon="shield-lock"
            label={t('about.veloqPrivacy')}
            url={VELOQ_URLS.privacy}
            isDark={isDark}
          />
          <View style={styles.linkDivider(isDark)} />
          <LinkRow
            icon="license"
            label={t('about.openSource')}
            url={VELOQ_URLS.license}
            isDark={isDark}
          />
          <View style={styles.linkDivider(isDark)} />
          <NavRow
            icon="file-document-multiple"
            label={t('about.thirdPartyLicenses')}
            route="/licenses"
            isDark={isDark}
          />
          <View style={styles.linkDivider(isDark)} />
          <LinkRow
            icon="github"
            label={t('about.sourceCode')}
            url={VELOQ_URLS.github}
            isDark={isDark}
          />
          <View style={styles.linkDivider(isDark)} />
          <LinkRow
            icon="code-braces"
            label={t('about.tracematchSource')}
            url={VELOQ_URLS.tracematch}
            isDark={isDark}
          />
        </View>

        {/* Data Attribution */}
        <Text style={[styles.sectionLabel, shared.textSecondary]}>
          {t('about.dataAttribution').toUpperCase()}
        </Text>
        <View style={styles.section(isDark)}>
          <Text style={[styles.attributionText, shared.textSecondary]}>
            {t('about.garminNote')}
          </Text>
          <View style={styles.attributionLogos}>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons name="watch" size={20} color={themeColors.textSecondary} />
              <Text style={[styles.attributionName, shared.text]}>Garmin</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons name="run" size={20} color={themeColors.textSecondary} />
              <Text style={[styles.attributionName, shared.text]}>Strava</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons name="watch" size={20} color={themeColors.textSecondary} />
              <Text style={[styles.attributionName, shared.text]}>Polar</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons name="watch" size={20} color={themeColors.textSecondary} />
              <Text style={[styles.attributionName, shared.text]}>Wahoo</Text>
            </View>
          </View>
          <Text style={[styles.trademarkText, shared.textMuted]}>
            {t('attribution.garminTrademark')}
          </Text>
        </View>

        {/* Map Data */}
        <Text style={[styles.sectionLabel, shared.textSecondary]}>
          {t('about.mapData').toUpperCase()}
        </Text>
        <View style={styles.section(isDark)}>
          <Text style={[styles.attributionText, shared.textSecondary]}>
            {t('about.mapAttribution')}
          </Text>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

// Theme-aware section style helper
const getSectionStyle = (isDark: boolean) => ({
  backgroundColor: isDark ? darkColors.surface : colors.surface,
  marginHorizontal: layout.screenPadding,
  borderRadius: layout.borderRadius,
  overflow: 'hidden' as const,
});

// Theme-aware app icon style helper
const getAppIconStyle = (isDark: boolean) => ({
  width: 80,
  height: 80,
  borderRadius: 20,
  backgroundColor: isDark ? 'rgba(20, 184, 166, 0.15)' : 'rgba(20, 184, 166, 0.1)',
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  marginBottom: spacing.md,
});

// Theme-aware link divider style helper
const getLinkDividerStyle = (isDark: boolean) => ({
  height: 1,
  backgroundColor: isDark ? darkColors.border : colors.border,
  marginLeft: spacing.md + 22 + spacing.sm,
});

const styles = {
  // Static styles
  content: {
    paddingBottom: spacing.xl,
  },
  headerSpacer: {
    width: 32,
  },
  sectionLabel: {
    ...typography.caption,
    fontWeight: '600' as const,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  appInfo: {
    alignItems: 'center' as const,
    padding: spacing.lg,
  },
  appName: {
    ...typography.sectionTitle,
    marginBottom: spacing.xs,
  },
  appVersion: {
    ...typography.bodySmall,
    marginBottom: spacing.sm,
  },
  appDescription: {
    ...typography.bodySmall,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  disclaimerText: {
    ...typography.bodySmall,
    lineHeight: 22,
    padding: spacing.md,
  },
  linkRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  linkText: {
    flex: 1,
    ...typography.body,
  },
  attributionText: {
    ...typography.bodySmall,
    lineHeight: 20,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  attributionLogos: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  attributionItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
  },
  attributionName: {
    ...typography.bodyCompact,
    fontWeight: '500' as const,
  },
  trademarkText: {
    ...typography.micro,
    opacity: 0.7,
    lineHeight: 14,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  // Theme-aware helpers
  section: getSectionStyle,
  appIcon: getAppIconStyle,
  linkDivider: getLinkDividerStyle,
};
