import React from 'react';
import { Image, View, Text } from 'react-native';
import {
  ExternalLinkRow,
  ListSectionHeader,
  Row,
  RowGroup,
  ScreenSafeAreaView,
  ScreenScrollView,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { iconSize, layout, spacing, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import { useTheme } from '@/shared/app';
import { INTERVALS_URLS } from '@/features/auth';
import { DataAttribution, settingsStyles } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { navigateTo } from '@/shared/app/navigation';
import {
  LICENCE_URL,
  REPOSITORY_URL,
  TRACEMATCH_URL,
  VELOQ_PRIVACY_URL,
} from '@/shared/app/supportLinks';
import { buildCommit, formatVersionLine } from '@/shared/format/buildStamp';
import appIcon from '@/assets/icon.png';

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
            <Image
              source={appIcon}
              style={styles.appIcon}
              accessibilityIgnoresInvertColors
              accessible={false}
            />
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
          <RowGroup>
            <ExternalLinkRow
              testID="about-link-privacy"
              icon="shield-account"
              label={t('about.intervalsPrivacy')}
              url={INTERVALS_URLS.privacyPolicy}
            />
            <ExternalLinkRow
              testID="about-link-terms"
              icon="file-document"
              label={t('about.intervalsTerms')}
              url={INTERVALS_URLS.termsOfService}
            />
            <ExternalLinkRow
              testID="about-link-api-terms"
              icon="api"
              label={t('about.intervalsApiTerms')}
              url={INTERVALS_URLS.apiTerms}
            />
          </RowGroup>
        </View>

        {/* Veloq Links */}
        <ListSectionHeader>Veloq</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            <ExternalLinkRow
              testID="about-link-veloq-privacy"
              icon="shield-lock"
              label={t('about.veloqPrivacy')}
              url={VELOQ_PRIVACY_URL}
            />
            <ExternalLinkRow
              testID="about-link-license"
              icon="license"
              label={t('about.openSource')}
              url={LICENCE_URL}
            />
            <Row
              testID="about-link-licenses"
              behaviour="navigate"
              accessibilityLabel={t('about.thirdPartyLicenses')}
              onPress={() => navigateTo('/licenses')}
            >
              <Icon name="file-document-multiple" size={iconSize.lg} color={themeColors.primary} />
              <Text style={[styles.linkText, shared.text]}>{t('about.thirdPartyLicenses')}</Text>
            </Row>
            <ExternalLinkRow
              testID="about-link-source"
              icon="github"
              label={t('about.sourceCode')}
              url={REPOSITORY_URL}
            />
            <ExternalLinkRow
              testID="about-link-tracematch"
              icon="code-braces"
              label={t('about.tracematchSource')}
              url={TRACEMATCH_URL}
            />
          </RowGroup>
        </View>

        {/* Data Attribution */}
        <ListSectionHeader>{t('about.dataAttribution')}</ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <DataAttribution />
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
  appIcon: {
    width: layout.appIconSize,
    height: layout.appIconSize,
    borderRadius: layout.borderRadiusAppIcon,
    borderCurve: 'continuous' as const,
    marginBottom: spacing.md,
  },
};

export default withScreenBoundary(AboutScreenContent, 'About');
