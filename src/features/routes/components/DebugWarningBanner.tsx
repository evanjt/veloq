import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { amberBanner, redBanner, spacing } from '@/theme';

interface DebugWarning {
  level: 'warn' | 'error';
  message: string;
}

interface DebugWarningBannerProps {
  warnings: DebugWarning[];
}

const WARN_BG = amberBanner.light.bg;
const WARN_BORDER = amberBanner.light.border;
const ERROR_BG = redBanner.bg;
const ERROR_BORDER = redBanner.border;

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
                borderLeftColor: isError ? ERROR_BORDER : WARN_BORDER,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isError ? 'alert-circle' : 'alert'}
              size={16}
              color={isError ? ERROR_BORDER : WARN_BORDER}
            />
            <Text
              style={[styles.text, { color: isError ? redBanner.text : amberBanner.light.text }]}
            >
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
    gap: 4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
  },
  text: {
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
});
