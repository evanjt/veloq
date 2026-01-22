import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { ScreenSafeAreaView } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import { useTheme } from '@/hooks';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface LicenseEntry {
  name: string;
  version?: string;
  license: string;
  repository?: string;
  description?: string;
}

interface LicenseSection {
  title: string;
  description?: string;
  entries: LicenseEntry[];
}

// License data structured for display
const LICENSE_DATA: LicenseSection[] = [
  {
    title: 'Core Framework',
    entries: [
      { name: 'React', license: 'MIT', repository: 'https://github.com/facebook/react' },
      {
        name: 'React Native',
        license: 'MIT',
        repository: 'https://github.com/facebook/react-native',
      },
      { name: 'Expo', license: 'MIT', repository: 'https://github.com/expo/expo' },
    ],
  },
  {
    title: 'Maps & Graphics',
    entries: [
      {
        name: 'MapLibre React Native',
        license: 'MIT',
        repository: 'https://github.com/maplibre/maplibre-react-native',
      },
      {
        name: '@mapbox/polyline',
        license: 'BSD-3-Clause',
        repository: 'https://github.com/mapbox/polyline',
      },
      {
        name: 'React Native Skia',
        license: 'MIT',
        repository: 'https://github.com/Shopify/react-native-skia',
      },
      {
        name: 'React Native SVG',
        license: 'MIT',
        repository: 'https://github.com/software-mansion/react-native-svg',
      },
      {
        name: 'Victory Native',
        license: 'MIT',
        repository: 'https://github.com/FormidableLabs/victory',
      },
    ],
  },
  {
    title: 'State Management',
    entries: [
      { name: 'TanStack Query', license: 'MIT', repository: 'https://github.com/TanStack/query' },
      { name: 'Zustand', license: 'MIT', repository: 'https://github.com/pmndrs/zustand' },
      { name: 'Zod', license: 'MIT', repository: 'https://github.com/colinhacks/zod' },
    ],
  },
  {
    title: 'UI Components',
    entries: [
      {
        name: 'React Native Paper',
        license: 'MIT',
        repository: 'https://github.com/callstack/react-native-paper',
      },
      {
        name: 'React Native Gesture Handler',
        license: 'MIT',
        repository: 'https://github.com/software-mansion/react-native-gesture-handler',
      },
      {
        name: 'React Native Reanimated',
        license: 'MIT',
        repository: 'https://github.com/software-mansion/react-native-reanimated',
      },
      {
        name: 'React Native Screens',
        license: 'MIT',
        repository: 'https://github.com/software-mansion/react-native-screens',
      },
    ],
  },
  {
    title: 'Networking & Utilities',
    entries: [
      { name: 'Axios', license: 'MIT', repository: 'https://github.com/axios/axios' },
      { name: 'i18next', license: 'MIT', repository: 'https://github.com/i18next/i18next' },
    ],
  },
  {
    title: 'Native Engine (tracematch)',
    description: 'Rust dependencies compiled into the native route matching engine.',
    entries: [
      {
        name: 'UniFFI',
        license: 'MPL-2.0',
        repository: 'https://github.com/mozilla/uniffi-rs',
        description: 'FFI bindings generator. Source available at repository.',
      },
      {
        name: 'geo / geo-types',
        license: 'MIT OR Apache-2.0',
        repository: 'https://github.com/georust/geo',
      },
      {
        name: 'rstar',
        license: 'MIT OR Apache-2.0',
        repository: 'https://github.com/georust/rstar',
      },
      { name: 'tokio', license: 'MIT', repository: 'https://github.com/tokio-rs/tokio' },
      {
        name: 'serde',
        license: 'MIT OR Apache-2.0',
        repository: 'https://github.com/serde-rs/serde',
      },
      {
        name: 'rayon',
        license: 'MIT OR Apache-2.0',
        repository: 'https://github.com/rayon-rs/rayon',
      },
      {
        name: 'rustls',
        license: 'Apache-2.0 OR ISC OR MIT',
        repository: 'https://github.com/rustls/rustls',
      },
      {
        name: 'ring',
        license: 'Apache-2.0 AND ISC',
        repository: 'https://github.com/briansmith/ring',
      },
      {
        name: 'reqwest',
        license: 'MIT OR Apache-2.0',
        repository: 'https://github.com/seanmonstar/reqwest',
      },
      { name: 'rusqlite', license: 'MIT', repository: 'https://github.com/rusqlite/rusqlite' },
    ],
  },
  {
    title: 'Special Licenses',
    description: 'Dependencies with non-MIT/Apache licenses.',
    entries: [
      {
        name: 'ICU4X (icu_* crates)',
        license: 'Unicode-3.0',
        repository: 'https://github.com/unicode-org/icu4x',
        description: 'Unicode internationalization library.',
      },
      {
        name: 'earcutr',
        license: 'ISC',
        repository: 'https://github.com/nicolo-ribaudo/earcutr',
        description: 'Polygon triangulation.',
      },
      {
        name: 'webpki-roots',
        license: 'CDLA-Permissive-2.0',
        repository: 'https://github.com/rustls/webpki-roots',
        description: 'Mozilla CA certificate bundle.',
      },
      {
        name: 'subtle',
        license: 'BSD-3-Clause',
        repository: 'https://github.com/dalek-cryptography/subtle',
        description: 'Constant-time operations.',
      },
      {
        name: 'zerocopy',
        license: 'BSD-2-Clause OR Apache-2.0 OR MIT',
        repository: 'https://github.com/google/zerocopy',
      },
      {
        name: 'foldhash',
        license: 'Zlib',
        repository: 'https://github.com/orlp/foldhash',
      },
    ],
  },
  {
    title: 'Map Data',
    description: 'Map tiles and geographic data providers.',
    entries: [
      {
        name: 'OpenStreetMap',
        license: 'ODbL',
        repository: 'https://www.openstreetmap.org/copyright',
        description: 'Map data © OpenStreetMap contributors.',
      },
      {
        name: 'OpenFreeMap',
        license: 'ODbL',
        repository: 'https://openfreemap.org',
        description: 'Free map tile hosting.',
      },
      {
        name: 'OpenMapTiles',
        license: 'ODbL',
        repository: 'https://openmaptiles.org',
        description: 'Vector tile schema.',
      },
      {
        name: 'EOX Sentinel-2',
        license: 'CC-BY-NC-SA 4.0',
        repository: 'https://s2maps.eu',
        description: 'Satellite imagery © EOX / Copernicus.',
      },
      {
        name: 'AWS Terrain Tiles',
        license: 'Public Domain',
        repository: 'https://registry.opendata.aws/terrain-tiles/',
        description: '3D elevation data.',
      },
    ],
  },
];

const LICENSE_TEXTS: Record<string, string> = {
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.`,

  'Apache-2.0': `Licensed under the Apache License, Version 2.0. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0`,

  ISC: `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.`,

  'BSD-3-Clause': `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the conditions in the license are met.`,

  'BSD-2-Clause': `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the conditions in the license are met.`,

  'MPL-2.0': `This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. Source code is available at the linked repository.`,

  'Unicode-3.0': `Licensed under the Unicode License Agreement. See https://www.unicode.org/license.txt`,

  Zlib: `This software is provided 'as-is', without any express or implied warranty. Permission is granted to use this software for any purpose.`,

  'CDLA-Permissive-2.0': `Community Data License Agreement - Permissive, Version 2.0. Permits use, modification, and sharing of data.`,

  ODbL: `Open Database License. You are free to share, create, and adapt, as long as you attribute and share-alike.`,

  'CC-BY-NC-SA 4.0': `Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.`,

  'Public Domain': `This data is in the public domain and free to use without restriction.`,
};

interface CollapsibleSectionProps {
  section: LicenseSection;
  isDark: boolean;
}

function CollapsibleSection({ section, isDark }: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const themeColors = isDark ? darkColors : colors;

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <View style={styles.sectionContainer(isDark)}>
      <TouchableOpacity style={styles.sectionHeader} onPress={toggleExpanded} activeOpacity={0.7}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
            {section.title}
          </Text>
          <Text style={[styles.entryCount, { color: themeColors.textSecondary }]}>
            {section.entries.length}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={24}
          color={themeColors.textSecondary}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.sectionContent}>
          {section.description && (
            <Text style={[styles.sectionDescription, { color: themeColors.textSecondary }]}>
              {section.description}
            </Text>
          )}
          {section.entries.map((entry, index) => (
            <LicenseEntryRow
              key={entry.name}
              entry={entry}
              isDark={isDark}
              isLast={index === section.entries.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

interface LicenseEntryRowProps {
  entry: LicenseEntry;
  isDark: boolean;
  isLast: boolean;
}

function LicenseEntryRow({ entry, isDark, isLast }: LicenseEntryRowProps) {
  const [showLicense, setShowLicense] = useState(false);
  const themeColors = isDark ? darkColors : colors;

  const handlePress = () => {
    if (entry.repository) {
      Linking.openURL(entry.repository);
    }
  };

  const toggleLicense = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLicense(!showLicense);
  };

  // Get the primary license for displaying license text
  const primaryLicense = entry.license.split(' OR ')[0].split(' AND ')[0];
  const licenseText = LICENSE_TEXTS[primaryLicense];

  return (
    <View style={[styles.entryContainer, !isLast && styles.entryBorder(isDark)]}>
      <View style={styles.entryRow}>
        <View style={styles.entryInfo}>
          <Text style={[styles.entryName, { color: themeColors.textPrimary }]}>{entry.name}</Text>
          <TouchableOpacity onPress={toggleLicense}>
            <Text style={[styles.entryLicense, { color: colors.primary }]}>{entry.license}</Text>
          </TouchableOpacity>
        </View>
        {entry.repository && (
          <TouchableOpacity
            onPress={handlePress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons
              name="open-in-new"
              size={18}
              color={themeColors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>
      {entry.description && (
        <Text style={[styles.entryDescription, { color: themeColors.textSecondary }]}>
          {entry.description}
        </Text>
      )}
      {showLicense && licenseText && (
        <View style={styles.licenseTextContainer(isDark)}>
          <Text style={[styles.licenseText, { color: themeColors.textSecondary }]}>
            {licenseText}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function LicensesScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);

  return (
    <ScreenSafeAreaView testID="licenses-screen" style={shared.container}>
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
          <Text style={shared.headerTitle}>{t('licenses.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Intro text */}
        <View style={styles.introContainer}>
          <Text style={[styles.introText, { color: themeColors.textSecondary }]}>
            {t('licenses.intro')}
          </Text>
        </View>

        {/* License sections */}
        {LICENSE_DATA.map((section) => (
          <CollapsibleSection key={section.title} section={section} isDark={isDark} />
        ))}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: themeColors.textSecondary }]}>
            {t('licenses.footer')}
          </Text>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = {
  content: {
    paddingBottom: spacing.xl,
  },
  headerSpacer: {
    width: 32,
  },
  introContainer: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.md,
  },
  introText: {
    ...typography.bodySmall,
    lineHeight: 20,
  },
  sectionContainer: (isDark: boolean) => ({
    backgroundColor: isDark ? darkColors.surface : colors.surface,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    borderRadius: layout.borderRadius,
    overflow: 'hidden' as const,
  }),
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.body,
    fontWeight: '600' as const,
  },
  entryCount: {
    ...typography.caption,
    backgroundColor: 'rgba(128, 128, 128, 0.2)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  sectionContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionDescription: {
    ...typography.bodySmall,
    marginBottom: spacing.sm,
    fontStyle: 'italic' as const,
  },
  entryContainer: {
    paddingVertical: spacing.sm,
  },
  entryBorder: (isDark: boolean) => ({
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: isDark ? darkColors.border : colors.border,
  }),
  entryRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
  },
  entryInfo: {
    flex: 1,
  },
  entryName: {
    ...typography.body,
    fontWeight: '500' as const,
  },
  entryLicense: {
    ...typography.caption,
    marginTop: 2,
  },
  entryDescription: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  licenseTextContainer: (isDark: boolean) => ({
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)',
    borderRadius: 4,
  }),
  licenseText: {
    ...typography.micro,
    lineHeight: 16,
  },
  footer: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  footerText: {
    ...typography.caption,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
};
