import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import * as WebBrowser from 'expo-web-browser';
import * as StoreReview from 'expo-store-review';
import { useTheme } from '@/hooks';
import { useSupportStore } from '@/providers';
import { useDonation } from '@/hooks/useDonation';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';
import { TipButtons } from '@/components/ui/TipButtons';

const FORUM_URL =
  'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283';
const GITHUB_ISSUES_URL = 'https://github.com/evanjt/veloq/issues/new';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/evanjt';

export function SupportCard() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const neverShowAgain = useSupportStore((s) => s.neverShowAgain);
  const remindLater = useSupportStore((s) => s.remindLater);
  const recordAction = useSupportStore((s) => s.recordAction);
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const shouldShow = useSupportStore((s) => s.shouldShow);
  const lastActionDate = useSupportStore((s) => s.lastActionDate);
  const permanentlyDismissed = useSupportStore((s) => s.permanentlyDismissed);
  const dismissCount = useSupportStore((s) => s.dismissCount);
  const isLoaded = useSupportStore((s) => s.isLoaded);
  const [visible, setVisible] = useState(false);
  const [tipsExpanded, setTipsExpanded] = useState(false);
  const tipHeight = useSharedValue(0);

  useEffect(() => {
    if (isLoaded && shouldShow()) {
      setVisible(true);
    }
  }, [lastActionDate, permanentlyDismissed, dismissCount, isLoaded, shouldShow]);

  const tipAnimStyle = useAnimatedStyle(() => ({
    height: tipHeight.value,
    opacity: tipHeight.value > 0 ? 1 : 0,
    overflow: 'hidden' as const,
  }));

  const toggleTips = useCallback(() => {
    const next = !tipsExpanded;
    setTipsExpanded(next);
    tipHeight.value = withTiming(next ? 56 : 0, { duration: 250 });
  }, [tipsExpanded, tipHeight]);

  const handleReview = useCallback(async () => {
    if (await StoreReview.hasAction()) {
      await StoreReview.requestReview();
    } else {
      WebBrowser.openBrowserAsync('https://github.com/evanjt/veloq');
    }
    recordAction();
  }, [recordAction]);

  const handleIdea = useCallback(() => {
    WebBrowser.openBrowserAsync(`${GITHUB_ISSUES_URL}?labels=enhancement`);
  }, []);

  const handleForum = useCallback(() => {
    WebBrowser.openBrowserAsync(FORUM_URL);
  }, []);

  const handleTip = useCallback(
    (productId: string) => {
      purchase(productId);
    },
    [purchase]
  );

  const handleSponsor = useCallback(() => {
    WebBrowser.openBrowserAsync(GITHUB_SPONSORS_URL);
    recordAction();
  }, [recordAction]);

  const handleRemindLater = useCallback(() => {
    remindLater();
    setVisible(false);
  }, [remindLater]);

  const handleNeverShow = useCallback(() => {
    neverShowAgain();
    setVisible(false);
  }, [neverShowAgain]);

  if (!visible) return null;
  if (purchaseSuccess) {
    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
        style={[styles.card, isDark && styles.cardDark]}
      >
        <View style={styles.header}>
          <MaterialCommunityIcons name="heart" size={22} color={colors.primary} />
          <Text style={[styles.title, isDark && styles.titleDark]}>{t('support.thankYou')}</Text>
        </View>
      </Animated.View>
    );
  }

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={[styles.card, isDark && styles.cardDark]}
    >
      <View style={styles.header}>
        <MaterialCommunityIcons name="star-outline" size={22} color={textColor} />
        <Text style={[styles.title, isDark && styles.titleDark]}>{t('support.enjoyingTitle')}</Text>
      </View>
      <Text style={[styles.description, isDark && styles.descriptionDark]}>
        {t('support.feedbackDescription')}
      </Text>

      <View style={styles.actionRow}>
        <ActionButton
          icon="star"
          label={t('support.review')}
          onPress={handleReview}
          isDark={isDark}
        />
        <ActionButton
          icon="lightbulb-outline"
          label={t('support.idea')}
          onPress={handleIdea}
          isDark={isDark}
        />
        <ActionButton
          icon="forum-outline"
          label={t('support.forum')}
          onPress={handleForum}
          isDark={isDark}
        />
      </View>

      <Pressable onPress={toggleTips} style={styles.tipToggle} hitSlop={4}>
        <MaterialCommunityIcons name="wrench-outline" size={18} color={mutedColor} />
        <Text style={[styles.tipToggleText, { color: mutedColor }]}>
          {t('support.supportDevelopment')}
        </Text>
        <MaterialCommunityIcons
          name={tipsExpanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={mutedColor}
        />
      </Pressable>

      <Animated.View style={tipAnimStyle}>
        {isAvailable ? (
          <TipButtons
            products={products}
            isPurchasing={isPurchasing}
            onTip={handleTip}
            isDark={isDark}
          />
        ) : (
          <Pressable
            onPress={handleSponsor}
            style={[styles.sponsorButton, isDark && styles.sponsorButtonDark]}
          >
            <MaterialCommunityIcons name="github" size={18} color={textColor} />
            <Text style={[styles.sponsorText, isDark && styles.sponsorTextDark]}>
              {t('support.sponsorGitHub')}
            </Text>
          </Pressable>
        )}
      </Animated.View>

      <View style={styles.dismissRow}>
        <Pressable onPress={handleRemindLater} hitSlop={8}>
          <Text style={[styles.dismissText, isDark && styles.dismissTextDark]}>
            {t('support.remindLater')}
          </Text>
        </Pressable>
        <Text style={[styles.dismissSeparator, isDark && styles.dismissTextDark]}>·</Text>
        <Pressable onPress={handleNeverShow} hitSlop={8}>
          <Text style={[styles.dismissText, isDark && styles.dismissTextDark]}>
            {t('support.neverShow')}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  isDark,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.actionButton, isDark && styles.actionButtonDark]}>
      <MaterialCommunityIcons
        name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
        size={20}
        color={isDark ? darkColors.textPrimary : colors.textPrimary}
      />
      <Text style={[styles.actionButtonText, isDark && styles.actionButtonTextDark]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
    ...shadows.none,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSm,
  },
  actionButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  actionButtonText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  actionButtonTextDark: {
    color: darkColors.textPrimary,
  },
  tipToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  tipToggleText: {
    ...typography.caption,
    fontWeight: '500',
    flex: 1,
  },
  sponsorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSm,
  },
  sponsorButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  sponsorText: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sponsorTextDark: {
    color: darkColors.textPrimary,
  },
  dismissRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  dismissText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dismissSeparator: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.sm,
  },
  dismissTextDark: {
    color: darkColors.textSecondary,
  },
});
