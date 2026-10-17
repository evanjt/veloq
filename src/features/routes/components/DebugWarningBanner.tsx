import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, iconSize, layout, spacing, stroke, typography } from '@/theme';

interface DebugWarning {
  level: 'warn' | 'error';
  message: string;
}

interface DebugWarningBannerProps {
  warnings: DebugWarning[];
}

// A debug build's own strip, drawn light in both themes on the status tints.
const WARN_BG = colors.warningBg;
const WARN_INK = colors.warningAmber;
const ERROR_BG = colors.errorBg;
const ERROR_INK = colors.errorDeep;

export function DebugWarningBanner({ warnings }: DebugWarningBannerProps) {
  if (warnings.length === 0) return null;

  return (
    <View style={styles.container}>
      {warnings.map((w, i) => {
        const isError = w.level === 'error';
        return (
          <View
            key={i}
            style={[
              styles.banner,
              {
                backgroundColor: isError ? ERROR_BG : WARN_BG,
                borderLeftColor: isError ? ERROR_INK : WARN_INK,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isError ? 'alert-circle' : 'alert'}
              size={iconSize.sm}
              color={isError ? ERROR_INK : WARN_INK}
            />
            <Text style={[styles.text, { color: isError ? ERROR_INK : WARN_INK }]}>
              {w.message}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xsPlus,
    paddingHorizontal: spacing.smPlus,
    borderRadius: layout.borderRadiusSm,
    borderLeftWidth: stroke.three,
  },
  text: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.code.fontFamily,
    flex: 1,
  },
});
