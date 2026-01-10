import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useColorScheme,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { colors, spacing, layout } from '@/theme';
import { INTERVALS_URLS } from '@/services/oauth';

const VELOQ_URLS = {
  github: 'https://github.com/evanjt/veloq',
  license: 'https://github.com/evanjt/veloq/blob/main/LICENSE',
  privacy: 'https://github.com/evanjt/veloq#privacy-policy',
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

  return (
    <TouchableOpacity style={styles.linkRow} onPress={handlePress} activeOpacity={0.7}>
      <MaterialCommunityIcons name={icon as any} size={22} color={colors.primary} />
      <Text style={[styles.linkText, isDark && styles.textLight]}>{label}</Text>
      <MaterialCommunityIcons
        name="open-in-new"
        size={18}
        color={isDark ? '#666' : colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

export default function AboutScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <SafeAreaView testID="about-screen" style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header with back button */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="nav-back-button"
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? '#FFF' : colors.textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>{t('about.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* App Info */}
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.appInfo}>
            <View style={[styles.appIcon, isDark && styles.appIconDark]}>
              <MaterialCommunityIcons name="bike-fast" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.appName, isDark && styles.textLight]}>Veloq</Text>
            <Text style={[styles.appVersion, isDark && styles.textMuted]}>
              {t('about.version')} {Constants.expoConfig?.version ?? '0.0.1'}
            </Text>
            <Text style={[styles.appDescription, isDark && styles.textMuted]}>
              {t('about.description')}
            </Text>
          </View>
        </View>

        {/* Disclaimer */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('about.disclaimerTitle').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <Text style={[styles.disclaimerText, isDark && styles.textMuted]}>
            {t('about.disclaimer')}
          </Text>
        </View>

        {/* intervals.icu Links */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>INTERVALS.ICU</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <LinkRow
            icon="shield-account"
            label={t('about.intervalsPrivacy')}
            url={INTERVALS_URLS.privacyPolicy}
            isDark={isDark}
          />
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <LinkRow
            icon="file-document"
            label={t('about.intervalsTerms')}
            url={INTERVALS_URLS.termsOfService}
            isDark={isDark}
          />
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <LinkRow
            icon="api"
            label={t('about.intervalsApiTerms')}
            url={INTERVALS_URLS.apiTerms}
            isDark={isDark}
          />
        </View>

        {/* Veloq Links */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>VELOQ</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <LinkRow
            icon="shield-lock"
            label={t('about.veloqPrivacy')}
            url={VELOQ_URLS.privacy}
            isDark={isDark}
          />
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <LinkRow
            icon="license"
            label={t('about.openSource')}
            url={VELOQ_URLS.license}
            isDark={isDark}
          />
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <LinkRow
            icon="github"
            label={t('about.sourceCode')}
            url={VELOQ_URLS.github}
            isDark={isDark}
          />
        </View>

        {/* Data Attribution */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('about.dataAttribution').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <Text style={[styles.attributionText, isDark && styles.textMuted]}>
            {t('about.garminNote')}
          </Text>
          <View style={styles.attributionLogos}>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="watch"
                size={20}
                color={isDark ? '#888' : colors.textSecondary}
              />
              <Text style={[styles.attributionName, isDark && styles.textLight]}>Garmin</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="run"
                size={20}
                color={isDark ? '#888' : colors.textSecondary}
              />
              <Text style={[styles.attributionName, isDark && styles.textLight]}>Strava</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="watch"
                size={20}
                color={isDark ? '#888' : colors.textSecondary}
              />
              <Text style={[styles.attributionName, isDark && styles.textLight]}>Polar</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="watch"
                size={20}
                color={isDark ? '#888' : colors.textSecondary}
              />
              <Text style={[styles.attributionName, isDark && styles.textLight]}>Wahoo</Text>
            </View>
          </View>
          <Text style={[styles.trademarkText, isDark && styles.textMuted]}>
            {t('attribution.garminTrademark')}
          </Text>
        </View>

        {/* Map Data */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('about.mapData').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <Text style={[styles.attributionText, isDark && styles.textMuted]}>
            {t('about.mapAttribution')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  content: {
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: '#1E1E1E',
  },
  appInfo: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  appIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  appIconDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.15)',
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  appVersion: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  appDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  disclaimerText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    padding: spacing.md,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  linkText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm,
  },
  dividerDark: {
    backgroundColor: '#333',
  },
  attributionText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  attributionLogos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  attributionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  attributionName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  trademarkText: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.7,
    lineHeight: 14,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  textLight: {
    color: '#FFF',
  },
  textMuted: {
    color: '#888',
  },
});
