import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '@/hooks';
import { useSupportStore } from '@/providers';
import { useDonation } from '@/hooks/useDonation';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';

const FORUM_URL =
  'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/evanjt';
const GITHUB_ISSUES_URL = 'https://github.com/evanjt/veloq/issues/new';

export function SupportCard() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const shouldShow = useSupportStore((s) => s.shouldShow);
  const isLegacyPurchaser = useSupportStore((s) => s.isLegacyPurchaser);
  const remindLater = useSupportStore((s) => s.remindLater);
  const neverShowAgain = useSupportStore((s) => s.neverShowAgain);
  const recordAction = useSupportStore((s) => s.recordAction);
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  // Snapshot visibility on mount so card stays visible for this session
  // even after we mark it as shown (which resets the 30-day timer)
  const [visible, setVisible] = useState(false);
  const hasMarkedShown = useRef(false);
  useEffect(() => {
    if (shouldShow() && !hasMarkedShown.current) {
      hasMarkedShown.current = true;
      setVisible(true);
      remindLater();
    }
  }, [shouldShow, remindLater]);

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

  if (isLegacyPurchaser) {
    return (
      <LegacyCard
        isDark={isDark}
        t={t}
        neverShowAgain={handleNeverShow}
        products={products}
        isAvailable={isAvailable}
        isPurchasing={isPurchasing}
        onTip={handleTip}
        onSponsor={handleSponsor}
      />
    );
  }

  return (
    <TipCard
      isDark={isDark}
      t={t}
      neverShowAgain={handleNeverShow}
      products={products}
      isAvailable={isAvailable}
      isPurchasing={isPurchasing}
      onTip={handleTip}
      onSponsor={handleSponsor}
    />
  );
}

// ── Tip card ────────────────────────────────────────────────────────

interface TipCardProps {
  isDark: boolean;
  t: TFunction;
  neverShowAgain: () => void;
  products: { id: string; displayPrice: string }[];
  isAvailable: boolean;
  isPurchasing: boolean;
  onTip: (productId: string) => void;
  onSponsor: () => void;
}

function TipCard({
  isDark,
  t,
  neverShowAgain,
  products,
  isAvailable,
  isPurchasing,
  onTip,
  onSponsor,
}: TipCardProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={[styles.card, isDark && styles.cardDark]}
    >
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="heart-outline"
          size={22}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />
        <Text style={[styles.title, isDark && styles.titleDark]}>{t('support.tipTitle')}</Text>
      </View>
      <Text style={[styles.description, isDark && styles.descriptionDark]}>
        {t('support.tipDescription')}
      </Text>
      {isAvailable ? (
        <TipButtons products={products} isPurchasing={isPurchasing} onTip={onTip} isDark={isDark} />
      ) : (
        <Pressable
          onPress={onSponsor}
          style={[styles.sponsorButton, isDark && styles.sponsorButtonDark]}
        >
          <MaterialCommunityIcons
            name="github"
            size={18}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.sponsorText, isDark && styles.sponsorTextDark]}>
            {t('support.sponsorGitHub')}
          </Text>
        </Pressable>
      )}
      <DismissRow isDark={isDark} t={t} neverShowAgain={neverShowAgain} />
    </Animated.View>
  );
}

// ── Legacy purchaser card ───────────────────────────────────────────

interface LegacyCardProps extends TipCardProps {}

function LegacyCard({
  isDark,
  t,
  neverShowAgain,
  products,
  isAvailable,
  isPurchasing,
  onTip,
  onSponsor,
}: LegacyCardProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={[styles.card, isDark && styles.cardDark]}
    >
      <View style={styles.header}>
        <MaterialCommunityIcons name="heart" size={22} color={colors.primary} />
        <Text style={[styles.title, isDark && styles.titleDark]}>{t('support.legacyTitle')}</Text>
      </View>
      <Text style={[styles.description, isDark && styles.descriptionDark]}>
        {t('support.legacyDescription')}
      </Text>
      <View style={styles.linkRow}>
        <LinkButton
          icon="forum-outline"
          label={t('support.forum')}
          onPress={() => WebBrowser.openBrowserAsync(FORUM_URL)}
          isDark={isDark}
        />
        <LinkButton
          icon="lightbulb-outline"
          label={t('support.idea')}
          onPress={() => WebBrowser.openBrowserAsync(`${GITHUB_ISSUES_URL}?labels=enhancement`)}
          isDark={isDark}
        />
        <LinkButton
          icon="bug-outline"
          label={t('support.bug')}
          onPress={() => WebBrowser.openBrowserAsync(`${GITHUB_ISSUES_URL}?labels=bug`)}
          isDark={isDark}
        />
      </View>
      {isAvailable ? (
        <View style={styles.secondaryTipRow}>
          <Text style={[styles.secondaryTipLabel, isDark && styles.descriptionDark]}>
            {t('support.tipAgain')}
          </Text>
          <TipButtons
            products={products}
            isPurchasing={isPurchasing}
            onTip={onTip}
            isDark={isDark}
            small
          />
        </View>
      ) : (
        <Pressable
          onPress={onSponsor}
          style={[styles.sponsorButton, isDark && styles.sponsorButtonDark]}
        >
          <MaterialCommunityIcons
            name="github"
            size={18}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.sponsorText, isDark && styles.sponsorTextDark]}>
            {t('support.sponsorGitHub')}
          </Text>
        </Pressable>
      )}
      <DismissRow isDark={isDark} t={t} neverShowAgain={neverShowAgain} />
    </Animated.View>
  );
}

// ── Shared sub-components ───────────────────────────────────────────

function TipButtons({
  products,
  isPurchasing,
  onTip,
  isDark,
  small,
}: {
  products: { id: string; displayPrice: string }[];
  isPurchasing: boolean;
  onTip: (id: string) => void;
  isDark: boolean;
  small?: boolean;
}) {
  const sorted = [...products].sort((a, b) => {
    const order = ['tip_small', 'tip_medium', 'tip_large'];
    return order.indexOf(a.id) - order.indexOf(b.id);
  });

  return (
    <View style={[styles.tipRow, small && styles.tipRowSmall]}>
      {sorted.map((product) => (
        <Pressable
          key={product.id}
          onPress={() => onTip(product.id)}
          disabled={isPurchasing}
          style={[
            small ? styles.tipButtonSmall : styles.tipButton,
            isDark && styles.tipButtonDark,
            isPurchasing && styles.tipButtonDisabled,
          ]}
        >
          <Text
            style={[
              small ? styles.tipButtonTextSmall : styles.tipButtonText,
              isDark && styles.tipButtonTextDark,
            ]}
          >
            {product.displayPrice}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function LinkButton({
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
    <Pressable onPress={onPress} style={[styles.linkButton, isDark && styles.linkButtonDark]}>
      <MaterialCommunityIcons
        name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
        size={20}
        color={isDark ? darkColors.textPrimary : colors.textPrimary}
      />
      <Text style={[styles.linkButtonText, isDark && styles.linkButtonTextDark]}>{label}</Text>
    </Pressable>
  );
}

function DismissRow({
  isDark,
  t,
  neverShowAgain,
}: {
  isDark: boolean;
  t: TFunction;
  neverShowAgain: () => void;
}) {
  return (
    <View style={styles.dismissRow}>
      <Pressable onPress={neverShowAgain} hitSlop={8}>
        <Text style={[styles.dismissText, isDark && styles.dismissTextDark]}>
          {t('support.neverShow')}
        </Text>
      </Pressable>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

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
  tipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tipRowSmall: {
    gap: spacing.xs,
  },
  tipButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    alignItems: 'center',
  },
  tipButtonSmall: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusSm,
    alignItems: 'center',
  },
  tipButtonDark: {
    backgroundColor: colors.primary,
  },
  tipButtonDisabled: {
    opacity: 0.5,
  },
  tipButtonText: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tipButtonTextSmall: {
    ...typography.caption,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tipButtonTextDark: {
    color: '#FFFFFF',
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
  linkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSm,
  },
  linkButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  linkButtonText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  linkButtonTextDark: {
    color: darkColors.textPrimary,
  },
  secondaryTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  secondaryTipLabel: {
    ...typography.caption,
    color: colors.textSecondary,
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
  dismissTextDark: {
    color: darkColors.textSecondary,
  },
});
