/**
 * Scenario: a restore list offers a backup between an account line and a
 * "no backups" line, both plain text.
 *
 * Expected behaviour: the backup row is marked as the thing to tap, by a
 * leading restore glyph and a title in the action colour, in both themes,
 * and it keeps that marking while greyed by another restore.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { BackupEntryRow } from '@/features/settings/components/BackupEntryRow';
import { colors, darkColors } from '@/theme';
import { initialiseI18n } from '@/i18n';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

const ENTRY = {
  id: 'veloq-2026-03-14T06-30-00-000Z.zip',
  timestamp: '2026-03-14T06:30:00.000Z',
  sizeBytes: 2_400_000,
  appVersion: '0.4.0',
};

beforeAll(async () => {
  await initialiseI18n();
});

afterEach(() => {
  mockIsDark = false;
});

async function renderRow(props: { busy?: boolean; disabled?: boolean } = {}) {
  await render(
    <BackupEntryRow
      entry={ENTRY}
      testID="entry"
      onPress={() => {}}
      busy={props.busy ?? false}
      disabled={props.disabled ?? false}
    />
  );
}

function titleColour() {
  return StyleSheet.flatten(screen.getByTestId('entry-title').props.style).color;
}

it('leads with the restore glyph in the action colour', async () => {
  await renderRow();
  const glyph = screen.UNSAFE_getByProps({ testID: 'entry-icon' });
  expect(glyph.props.name).toBe('backup-restore');
  expect(glyph.props.color).toBe(colors.actionLink);
});

it('draws the title in the action colour, not as body text', async () => {
  await renderRow();
  expect(titleColour()).toBe(colors.actionLink);
  expect(titleColour()).not.toBe(colors.textPrimary);
});

it('uses the dark action colour in the dark theme', async () => {
  mockIsDark = true;
  await renderRow();
  expect(titleColour()).toBe(darkColors.actionLink);
});

it('keeps the marking on a row another restore has greyed', async () => {
  await renderRow({ disabled: true });
  expect(screen.getByTestId('entry-icon', { includeHiddenElements: true })).toBeTruthy();
  expect(titleColour()).toBe(colors.actionLink);
});
