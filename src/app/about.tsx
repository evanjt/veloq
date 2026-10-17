import React from 'react';
import { View, Text } from 'react-native';
import {
  ExternalLinkRow,
  ListSectionHeader,
  Row,
  ScreenSafeAreaView,
  ScreenScrollView,
} from '@/shared/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
} from '@/theme';
import { createSharedStyles } from '@/styles';
import { useTheme } from '@/shared/app';
import { INTERVALS_URLS } from '@/features/auth';
import { DIVIDER_INSET, settingsStyles } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { tapTo } from '@/shared/app/navigation';
import {
  LICENCE_URL,
  REPOSITORY_URL,
  TRACEMATCH_URL,
  VELOQ_PRIVACY_URL,
} from '@/shared/app/supportLinks';
import { buildCommit, formatVersionLine } from '@/shared/format/buildStamp';

function AboutScreenContent() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);

  return (
    <ScreenSafeAreaView testID="about-screen" style={shared.container}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        {/* App Info */}
        <View
          testID="about-app-info"
          style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}
        >
          <View style={styles.appInfo}>
            <View style={styles.appIcon(isDark)}>
              <MaterialCommunityIcons name="bike-fast" size={iconSize.xxl} color={colors.primary} />
            </View>
            <Text style={[styles.appName, shared.text]}>Veloq</Text>
            <Text style={[styles.appVersion, shared.textSecondary]}>
              {t('about.version')}{' '}
              {formatVersionLine(Constants.expoConfig?.version ?? '0.0.1', buildCommit())}
            </Text>
            <Text style={[styles.appDescription, shared.textSecondary]}>
              {t('about.description')}
            </Text>
          </View>
        </View>

        {/* Disclaimer */}
        <ListSectionHeader>{t('about.disclaimerTitle')}</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <Text style={[styles.disclaimerText, shared.textSecondary]}>{t('about.disclaimer')}</Text>
        </View>

        {/* intervals.icu Links */}
        <ListSectionHeader>intervals.icu</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <ExternalLinkRow
            testID="about-link-privacy"
            icon="shield-account"
            label={t('about.intervalsPrivacy')}
            url={INTERVALS_URLS.privacyPolicy}
          />
          <View style={styles.linkDivider(isDark)} />
          <ExternalLinkRow
            testID="about-link-terms"
            icon="file-document"
            label={t('about.intervalsTerms')}
            url={INTERVALS_URLS.termsOfService}
          />
          <View style={styles.linkDivider(isDark)} />
          <ExternalLinkRow
            testID="about-link-api-terms"
            icon="api"
            label={t('about.intervalsApiTerms')}
            url={INTERVALS_URLS.apiTerms}
          />
        </View>

        {/* Veloq Links */}
        <ListSectionHeader>Veloq</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <ExternalLinkRow
            testID="about-link-veloq-privacy"
            icon="shield-lock"
            label={t('about.veloqPrivacy')}
            url={VELOQ_PRIVACY_URL}
          />
          <View style={styles.linkDivider(isDark)} />
          <ExternalLinkRow
            testID="about-link-license"
            icon="license"
            label={t('about.openSource')}
            url={LICENCE_URL}
          />
          <View style={styles.linkDivider(isDark)} />
          <Row
            testID="about-link-licenses"
            behaviour="navigate"
            accessibilityLabel={t('about.thirdPartyLicenses')}
            onPress={() => tapTo('/licenses')}
          >
            <MaterialCommunityIcons
              name="file-document-multiple"
              size={iconSize.lg}
              color={colors.primary}
            />
            <Text style={[styles.linkText, shared.text]}>{t('about.thirdPartyLicenses')}</Text>
          </Row>
          <View style={styles.linkDivider(isDark)} />
          <ExternalLinkRow
            testID="about-link-source"
            icon="github"
            label={t('about.sourceCode')}
            url={REPOSITORY_URL}
          />
          <View style={styles.linkDivider(isDark)} />
          <ExternalLinkRow
            testID="about-link-tracematch"
            icon="code-braces"
            label={t('about.tracematchSource')}
            url={TRACEMATCH_URL}
          />
        </View>

        {/* Data Attribution */}
        <ListSectionHeader>{t('about.dataAttribution')}</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <Text style={[styles.attributionText, shared.textSecondary]}>
            {t('about.garminNote')}
          </Text>
          <View style={styles.attributionLogos}>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="watch"
                size={iconSize.sm}
                color={themeColors.textSecondary}
              />
              <Text style={[styles.attributionName, shared.text]}>Garmin</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="run"
                size={iconSize.sm}
                color={themeColors.textSecondary}
              />
              <Text style={[styles.attributionName, shared.text]}>Strava</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="watch"
                size={iconSize.sm}
                color={themeColors.textSecondary}
              />
              <Text style={[styles.attributionName, shared.text]}>Polar</Text>
            </View>
            <View style={styles.attributionItem}>
              <MaterialCommunityIcons
                name="watch"
                size={iconSize.sm}
                color={themeColors.textSecondary}
              />
              <Text style={[styles.attributionName, shared.text]}>Wahoo</Text>
            </View>
          </View>
          <Text style={[styles.trademarkText, shared.textSecondary]}>
            {t('attribution.garminTrademark')}
          </Text>
        </View>

        {/* Map Data */}
        <ListSectionHeader>{t('about.mapData')}</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <Text style={[styles.attributionText, shared.textSecondary]}>
            {t('about.mapAttribution')}
          </Text>
        </View>
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

// Theme-aware app icon style helper
const getAppIconStyle = (isDark: boolean) => ({
  width: 80,
  height: 80,
  borderRadius: layout.borderRadiusXl,
  backgroundColor: colorWithOpacity(brand.teal, isDark ? 0.15 : 0.1),
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  marginBottom: spacing.md,
});

// Theme-aware link divider style helper
const getLinkDividerStyle = (isDark: boolean) => ({
  height: 1,
  backgroundColor: isDark ? darkColors.border : colors.border,
  marginLeft: DIVIDER_INSET,
});

const styles = {
  // Static styles
  content: {
    paddingBottom: spacing.xl,
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
    ...typography.bodyCompactBold,
  },
  trademarkText: {
    ...typography.micro,
    lineHeight: 14,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  // Theme-aware helpers
  appIcon: getAppIconStyle,
  linkDivider: getLinkDividerStyle,
};

export default withScreenBoundary(AboutScreenContent, 'About');
